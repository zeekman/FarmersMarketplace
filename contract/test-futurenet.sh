#!/usr/bin/env bash
# =============================================================================
# contract/test-futurenet.sh — E2E integration test on Stellar Futurenet
# Issue #861
#
# Validates that the Soroban escrow contract behaves correctly when deployed
# to a real Soroban-enabled network with actual XLM transfers.
#
# Tests covered:
#   1. Happy path  — deposit 1 XLM → release → verify farmer balance increased
#   2. Dispute flow — deposit → open_dispute → resolve_dispute → verify balances
#
# Prerequisites:
#   • stellar CLI   — https://developers.stellar.org/docs/tools/stellar-cli
#   • curl          — used to hit Friendbot
#   • Built WASM    — run `cargo build --target wasm32-unknown-unknown --release`
#                     before this script, or set WASM_PATH explicitly.
#
# Usage:
#   ./contract/test-futurenet.sh
#
# Optional environment overrides:
#   NETWORK           stellar network alias (default: futurenet)
#   WASM_PATH         path to compiled .wasm (default: auto-detected)
#   FEE_BPS           platform fee in bps (default: 250)
#   DEPOSIT_XLM       deposit amount in XLM (default: 1)
#   TIMEOUT_SECS      escrow timeout offset in seconds (default: 7200 = 2 h)
#   SKIP_BUILD        set to 1 to skip `cargo build`
# =============================================================================

set -euo pipefail

# ── colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }
pass()  { echo -e "${GREEN}[PASS]${NC}  $*"; }

# ── configuration ─────────────────────────────────────────────────────────────
NETWORK="${NETWORK:-futurenet}"
FEE_BPS="${FEE_BPS:-250}"
DEPOSIT_XLM="${DEPOSIT_XLM:-1}"
TIMEOUT_SECS="${TIMEOUT_SECS:-7200}"
SKIP_BUILD="${SKIP_BUILD:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_PATH="${WASM_PATH:-${SCRIPT_DIR}/target/wasm32-unknown-unknown/release/escrow.wasm}"

FRIENDBOT_URL="https://friendbot-futurenet.stellar.org"
HORIZON_URL="https://horizon-futurenet.stellar.org"

# ── dependency checks ─────────────────────────────────────────────────────────
for cmd in stellar curl jq; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: $cmd"
done

# ── build ─────────────────────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" != "1" ]]; then
  info "Building escrow WASM (release)…"
  (cd "$SCRIPT_DIR" && cargo build --target wasm32-unknown-unknown --release --quiet)
fi

[[ -f "$WASM_PATH" ]] || fail "WASM not found at $WASM_PATH — build first or set WASM_PATH"
info "WASM: $WASM_PATH"

# ── key generation ────────────────────────────────────────────────────────────
# Generate fresh ephemeral key names for this run so parallel runs don't clash.
RUN_ID="$(date +%s)"
KEY_ADMIN="e2e-admin-${RUN_ID}"
KEY_BUYER="e2e-buyer-${RUN_ID}"
KEY_FARMER="e2e-farmer-${RUN_ID}"
KEY_ARBITRATOR="e2e-arb-${RUN_ID}"
KEY_FEE_DEST="e2e-feedest-${RUN_ID}"

cleanup() {
  info "Cleaning up ephemeral keys…"
  for k in "$KEY_ADMIN" "$KEY_BUYER" "$KEY_FARMER" "$KEY_ARBITRATOR" "$KEY_FEE_DEST"; do
    stellar keys rm "$k" 2>/dev/null || true
  done
}
trap cleanup EXIT

info "Generating ephemeral keypairs…"
stellar keys generate "$KEY_ADMIN"       --no-fund
stellar keys generate "$KEY_BUYER"       --no-fund
stellar keys generate "$KEY_FARMER"      --no-fund
stellar keys generate "$KEY_ARBITRATOR"  --no-fund
stellar keys generate "$KEY_FEE_DEST"    --no-fund

ADDR_ADMIN="$(stellar keys address "$KEY_ADMIN")"
ADDR_BUYER="$(stellar keys address "$KEY_BUYER")"
ADDR_FARMER="$(stellar keys address "$KEY_FARMER")"
ADDR_ARBITRATOR="$(stellar keys address "$KEY_ARBITRATOR")"
ADDR_FEE_DEST="$(stellar keys address "$KEY_FEE_DEST")"

info "Admin:       $ADDR_ADMIN"
info "Buyer:       $ADDR_BUYER"
info "Farmer:      $ADDR_FARMER"
info "Arbitrator:  $ADDR_ARBITRATOR"
info "Fee dest:    $ADDR_FEE_DEST"

# ── fund via Friendbot ────────────────────────────────────────────────────────
fund_account() {
  local addr="$1" label="$2"
  info "Funding $label ($addr) via Friendbot…"
  local http_code
  http_code=$(curl -sf -o /dev/null -w "%{http_code}" \
    "${FRIENDBOT_URL}?addr=${addr}" || true)
  if [[ "$http_code" != "200" ]]; then
    # Some Friendbot endpoints return 400 when already funded — treat as OK
    warn "Friendbot returned HTTP $http_code for $label (may already be funded)"
  fi
  # Wait for the account to appear on the network
  local retries=10
  while (( retries-- > 0 )); do
    if curl -sf "${HORIZON_URL}/accounts/${addr}" >/dev/null 2>&1; then
      info "$label funded."
      return 0
    fi
    sleep 3
  done
  fail "Timed out waiting for $label account to appear on Futurenet"
}

fund_account "$ADDR_ADMIN"      "admin"
fund_account "$ADDR_BUYER"      "buyer"
fund_account "$ADDR_FARMER"     "farmer"
fund_account "$ADDR_ARBITRATOR" "arbitrator"
fund_account "$ADDR_FEE_DEST"   "fee-destination"

# ── helper: get XLM balance in stroops (integer) ──────────────────────────────
get_balance_stroops() {
  local addr="$1"
  curl -sf "${HORIZON_URL}/accounts/${addr}" \
    | jq -r '.balances[] | select(.asset_type=="native") | .balance' \
    | awk '{printf "%d", $1 * 10000000}'
}

# ── helper: invoke contract ───────────────────────────────────────────────────
invoke() {
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    --source "$1" \
    -- "${@:2}"
}

# ── deploy ────────────────────────────────────────────────────────────────────
info "Deploying escrow contract to $NETWORK…"
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --network "$NETWORK" \
  --source "$KEY_ADMIN")
info "Contract deployed: $CONTRACT_ID"

# ── initialize ────────────────────────────────────────────────────────────────
info "Initializing contract (fee_bps=$FEE_BPS)…"
invoke "$KEY_ADMIN" initialize \
  --admin     "$ADDR_ADMIN" \
  --fee_bps   "$FEE_BPS" \
  --fee_destination "$ADDR_FEE_DEST"

# ── grant Arbitrator role ─────────────────────────────────────────────────────
info "Granting Arbitrator role to $ADDR_ARBITRATOR…"
invoke "$KEY_ADMIN" grant_role \
  --caller  "$ADDR_ADMIN" \
  --account "$ADDR_ARBITRATOR" \
  --role    Arbitrator

# =============================================================================
# TEST 1 — Happy path: deposit → release → verify farmer balance increased
# =============================================================================
echo ""
info "═══════════════════════════════════════════════════════"
info "TEST 1 — deposit → release → farmer balance check"
info "═══════════════════════════════════════════════════════"

ORDER_ID_1=1001
DEPOSIT_STROOPS=$(( DEPOSIT_XLM * 10000000 ))
TIMEOUT_UNIX_1=$(( $(date +%s) + TIMEOUT_SECS ))

FARMER_BALANCE_BEFORE=$(get_balance_stroops "$ADDR_FARMER")
info "Farmer balance before deposit: $FARMER_BALANCE_BEFORE stroops"

info "Depositing ${DEPOSIT_XLM} XLM (order_id=$ORDER_ID_1)…"
invoke "$KEY_BUYER" deposit \
  --order_id      "$ORDER_ID_1" \
  --buyer         "$ADDR_BUYER" \
  --farmer        "$ADDR_FARMER" \
  --amount        "$DEPOSIT_STROOPS" \
  --timeout_unix  "$TIMEOUT_UNIX_1" \
  --product_name  "$(echo -n 'TestProduct' | xxd -p)" \
  --price_stroops "$DEPOSIT_STROOPS"

info "Verifying escrow is Active…"
STATUS=$(invoke "$KEY_BUYER" get_escrow --order_id "$ORDER_ID_1" | jq -r '.status')
[[ "$STATUS" == "Active" ]] || fail "TEST 1: expected status=Active, got $STATUS"
pass "Escrow status is Active"

info "Releasing escrow to farmer…"
invoke "$KEY_BUYER" release \
  --order_id      "$ORDER_ID_1" \
  --product_name  "$(echo -n 'TestProduct' | xxd -p)" \
  --price_stroops "$DEPOSIT_STROOPS"

info "Verifying escrow is Released…"
STATUS=$(invoke "$KEY_BUYER" get_escrow --order_id "$ORDER_ID_1" | jq -r '.status')
[[ "$STATUS" == "Released" ]] || fail "TEST 1: expected status=Released, got $STATUS"
pass "Escrow status is Released"

FARMER_BALANCE_AFTER=$(get_balance_stroops "$ADDR_FARMER")
info "Farmer balance after release: $FARMER_BALANCE_AFTER stroops"

# Expected farmer amount = deposit - platform_fee
# fee = deposit_stroops * fee_bps / 10000
FEE_STROOPS=$(( DEPOSIT_STROOPS * FEE_BPS / 10000 ))
EXPECTED_FARMER_AMOUNT=$(( DEPOSIT_STROOPS - FEE_STROOPS ))
ACTUAL_INCREASE=$(( FARMER_BALANCE_AFTER - FARMER_BALANCE_BEFORE ))

info "Platform fee:       $FEE_STROOPS stroops"
info "Expected increase:  $EXPECTED_FARMER_AMOUNT stroops"
info "Actual increase:    $ACTUAL_INCREASE stroops"

# Allow ±100 stroops for network transaction fees on the farmer account
TOLERANCE=100
DIFF=$(( ACTUAL_INCREASE - EXPECTED_FARMER_AMOUNT ))
ABS_DIFF=$(( DIFF < 0 ? -DIFF : DIFF ))
(( ABS_DIFF <= TOLERANCE )) || \
  fail "TEST 1: farmer balance increase ($ACTUAL_INCREASE) differs from expected ($EXPECTED_FARMER_AMOUNT) by more than $TOLERANCE stroops"

pass "TEST 1 PASSED — farmer balance increased by the correct amount after release"

# =============================================================================
# TEST 2 — Dispute flow: deposit → open_dispute → resolve_dispute → balances
# =============================================================================
echo ""
info "═══════════════════════════════════════════════════════"
info "TEST 2 — deposit → open_dispute → resolve_dispute(buyer) → balance check"
info "═══════════════════════════════════════════════════════"

ORDER_ID_2=1002
TIMEOUT_UNIX_2=$(( $(date +%s) + TIMEOUT_SECS ))

BUYER_BALANCE_BEFORE=$(get_balance_stroops "$ADDR_BUYER")
info "Buyer balance before dispute deposit: $BUYER_BALANCE_BEFORE stroops"

info "Depositing ${DEPOSIT_XLM} XLM (order_id=$ORDER_ID_2)…"
invoke "$KEY_BUYER" deposit \
  --order_id      "$ORDER_ID_2" \
  --buyer         "$ADDR_BUYER" \
  --farmer        "$ADDR_FARMER" \
  --amount        "$DEPOSIT_STROOPS" \
  --timeout_unix  "$TIMEOUT_UNIX_2" \
  --product_name  "$(echo -n 'TestProduct2' | xxd -p)" \
  --price_stroops "$DEPOSIT_STROOPS"

info "Opening dispute as buyer…"
invoke "$KEY_BUYER" open_dispute \
  --order_id   "$ORDER_ID_2" \
  --caller     "$ADDR_BUYER" \
  --arbitrator "null"

info "Verifying escrow is Disputed…"
STATUS=$(invoke "$KEY_BUYER" get_escrow --order_id "$ORDER_ID_2" | jq -r '.status')
[[ "$STATUS" == "Disputed" ]] || fail "TEST 2: expected status=Disputed, got $STATUS"
pass "Escrow status is Disputed"

BUYER_BALANCE_AFTER_DEPOSIT=$(get_balance_stroops "$ADDR_BUYER")
info "Buyer balance after deposit (dispute test): $BUYER_BALANCE_AFTER_DEPOSIT stroops"

info "Arbitrator resolves dispute — refund to buyer (release_to_buyer=true)…"
invoke "$KEY_ARBITRATOR" resolve_dispute \
  --order_id       "$ORDER_ID_2" \
  --caller         "$ADDR_ARBITRATOR" \
  --release_to_buyer true

info "Verifying escrow is Refunded…"
STATUS=$(invoke "$KEY_BUYER" get_escrow --order_id "$ORDER_ID_2" | jq -r '.status')
[[ "$STATUS" == "Refunded" ]] || fail "TEST 2: expected status=Refunded, got $STATUS"
pass "Escrow status is Refunded after dispute resolution"

BUYER_BALANCE_FINAL=$(get_balance_stroops "$ADDR_BUYER")
info "Buyer balance after dispute resolution: $BUYER_BALANCE_FINAL stroops"

BUYER_NET=$(( BUYER_BALANCE_FINAL - BUYER_BALANCE_AFTER_DEPOSIT ))
info "Buyer net change after refund: $BUYER_NET stroops (expected ~+$DEPOSIT_STROOPS)"

# Buyer should have recovered approximately the deposit amount.
# Allow a generous tolerance for Stellar transaction fees.
DISPUTE_TOLERANCE=1000
BUYER_DIFF=$(( BUYER_NET - DEPOSIT_STROOPS ))
ABS_BUYER_DIFF=$(( BUYER_DIFF < 0 ? -BUYER_DIFF : BUYER_DIFF ))
(( ABS_BUYER_DIFF <= DISPUTE_TOLERANCE )) || \
  fail "TEST 2: buyer balance increase after refund ($BUYER_NET) differs from deposit ($DEPOSIT_STROOPS) by more than $DISPUTE_TOLERANCE stroops"

pass "TEST 2 PASSED — buyer balance recovered after dispute resolution"

# =============================================================================
# TEST 3 — Dispute resolved to farmer
# =============================================================================
echo ""
info "═══════════════════════════════════════════════════════"
info "TEST 3 — deposit → open_dispute → resolve_dispute(farmer) → farmer balance"
info "═══════════════════════════════════════════════════════"

ORDER_ID_3=1003
TIMEOUT_UNIX_3=$(( $(date +%s) + TIMEOUT_SECS ))

FARMER_BALANCE_BEFORE_T3=$(get_balance_stroops "$ADDR_FARMER")
info "Farmer balance before test 3: $FARMER_BALANCE_BEFORE_T3 stroops"

info "Depositing ${DEPOSIT_XLM} XLM (order_id=$ORDER_ID_3)…"
invoke "$KEY_BUYER" deposit \
  --order_id      "$ORDER_ID_3" \
  --buyer         "$ADDR_BUYER" \
  --farmer        "$ADDR_FARMER" \
  --amount        "$DEPOSIT_STROOPS" \
  --timeout_unix  "$TIMEOUT_UNIX_3" \
  --product_name  "$(echo -n 'TestProduct3' | xxd -p)" \
  --price_stroops "$DEPOSIT_STROOPS"

info "Opening dispute as farmer…"
invoke "$KEY_FARMER" open_dispute \
  --order_id   "$ORDER_ID_3" \
  --caller     "$ADDR_FARMER" \
  --arbitrator "null"

STATUS=$(invoke "$KEY_BUYER" get_escrow --order_id "$ORDER_ID_3" | jq -r '.status')
[[ "$STATUS" == "Disputed" ]] || fail "TEST 3: expected status=Disputed, got $STATUS"
pass "Escrow status is Disputed"

info "Arbitrator resolves dispute — release to farmer (release_to_buyer=false)…"
invoke "$KEY_ARBITRATOR" resolve_dispute \
  --order_id        "$ORDER_ID_3" \
  --caller          "$ADDR_ARBITRATOR" \
  --release_to_buyer false

STATUS=$(invoke "$KEY_BUYER" get_escrow --order_id "$ORDER_ID_3" | jq -r '.status')
[[ "$STATUS" == "Released" ]] || fail "TEST 3: expected status=Released, got $STATUS"
pass "Escrow status is Released after dispute resolution to farmer"

FARMER_BALANCE_AFTER_T3=$(get_balance_stroops "$ADDR_FARMER")
FARMER_NET_T3=$(( FARMER_BALANCE_AFTER_T3 - FARMER_BALANCE_BEFORE_T3 ))
info "Farmer net change after dispute-to-farmer: $FARMER_NET_T3 stroops"

(( FARMER_NET_T3 > 0 )) || \
  fail "TEST 3: farmer balance should have increased after dispute resolved to farmer"

pass "TEST 3 PASSED — farmer balance increased after dispute resolved in farmer's favour"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  All Futurenet E2E integration tests PASSED ✓      ${NC}"
echo -e "${GREEN}  Contract: $CONTRACT_ID  ${NC}"
echo -e "${GREEN}  Network:  $NETWORK                                  ${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
