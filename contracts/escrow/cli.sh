#!/usr/bin/env bash
# Marketplace escrow contract CLI — wraps `stellar contract invoke`
# Usage: ./cli.sh <subcommand> [args]
#
# Required env vars:
#   CONTRACT_ID   — deployed contract address (not required for `deploy`/`smoke-test`)
#   NETWORK       — testnet | mainnet | standalone (default: testnet)
#   SOURCE        — Stellar account key name (from `stellar keys`, default: ci-runner)
#
# Manual smoke test:
#   The CI job `smoke-test-testnet` (.github/workflows/ci.yml) runs this script's
#   `smoke-test` subcommand on every merge to main. To run it yourself locally:
#
#     export STELLAR_SECRET_KEY=S...          # a funded (or fundable) testnet key
#     export ORDER_ID=$(date +%s)             # any unused u64; must be unique per run
#     ./contracts/escrow/cli.sh smoke-test
#
#   The smoke test builds the contract, deploys a fresh instance to testnet, funds
#   the source account via Friendbot if needed, deposits 0.5 XLM, releases it, then
#   polls Soroban RPC (fronted by Horizon on testnet) for the resulting "release"
#   event, failing if it does not appear within 30 seconds.

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-ci-runner}"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
FRIENDBOT_URL="${FRIENDBOT_URL:-https://friendbot.stellar.org}"

invoke() {
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    --source "$SOURCE" \
    -- "$@"
}

# Import STELLAR_SECRET_KEY (if set) as $SOURCE, and fund it via Friendbot if the
# account does not exist yet. Safe to call repeatedly — Friendbot is only invoked
# when the account is missing, so it never collides with an already-funded key.
ensure_funded_source() {
  if [ -n "${STELLAR_SECRET_KEY:-}" ]; then
    stellar keys add "$SOURCE" --secret-key <<<"$STELLAR_SECRET_KEY" --overwrite
  elif ! stellar keys address "$SOURCE" >/dev/null 2>&1; then
    stellar keys generate "$SOURCE" --network "$NETWORK"
  fi

  local address
  address="$(stellar keys address "$SOURCE")"
  if ! curl -sf "https://horizon-testnet.stellar.org/accounts/$address" >/dev/null; then
    curl -sf "${FRIENDBOT_URL}?addr=${address}" >/dev/null
  fi
}

# Fetch the native XLM Stellar Asset Contract id for the given network.
native_xlm_token() {
  stellar contract asset id --asset native --network "$NETWORK" --source "$SOURCE"
}

# Poll for a ("release", order_id) event on $CONTRACT_ID, starting from
# $start_ledger, for up to 30 seconds. Exits non-zero if not found.
wait_for_release_event() {
  local start_ledger="$1" order_id="$2"
  local deadline=$(( $(date +%s) + 30 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if stellar events \
        --network "$NETWORK" \
        --start-ledger "$start_ledger" \
        --contract-ids "$CONTRACT_ID" \
        --output json 2>/dev/null | grep -q "\"release\".*\"${order_id}\""; then
      echo "release event found for order_id=${order_id}"
      return 0
    fi
    sleep 3
  done
  echo "ERROR: no release event for order_id=${order_id} within 30s" >&2
  return 1
}

case "${1:-help}" in

  build)
    stellar contract build
    ;;

  deploy)
    stellar contract build
    stellar contract deploy \
      --wasm target/wasm32-unknown-unknown/release/soroban_escrow.wasm \
      --network "$NETWORK" \
      --source "$SOURCE"
    ;;

  deposit)
    # ./cli.sh deposit <xlm_token> <order_id> <buyer> <farmer> <amount> <timeout_unix>
    CONTRACT_ID="${CONTRACT_ID:?Set CONTRACT_ID}"
    invoke deposit --xlm_token "$2" --order_id "$3" --buyer "$4" \
      --farmer "$5" --amount "$6" --timeout_unix "$7"
    ;;

  release)
    # ./cli.sh release <xlm_token> <order_id>
    CONTRACT_ID="${CONTRACT_ID:?Set CONTRACT_ID}"
    invoke release --xlm_token "$2" --order_id "$3"
    ;;

  refund)
    # ./cli.sh refund <xlm_token> <order_id>
    CONTRACT_ID="${CONTRACT_ID:?Set CONTRACT_ID}"
    invoke refund --xlm_token "$2" --order_id "$3"
    ;;

  dispute)
    # ./cli.sh dispute <order_id> <caller>
    CONTRACT_ID="${CONTRACT_ID:?Set CONTRACT_ID}"
    invoke dispute --order_id "$2" --caller "$3"
    ;;

  get)
    # ./cli.sh get <order_id>
    CONTRACT_ID="${CONTRACT_ID:?Set CONTRACT_ID}"
    invoke get --order_id "$2"
    ;;

  smoke-test)
    # Idempotent end-to-end testnet check: deposit 0.5 XLM, release it, verify the
    # release event lands in Soroban RPC. order_id is derived from $ORDER_ID (CI
    # passes github.run_id) so re-runs never collide with prior escrow state.
    ORDER_ID="${ORDER_ID:?Set ORDER_ID (e.g. github.run_id) for idempotency}"

    ensure_funded_source
    ADDRESS="$(stellar keys address "$SOURCE")"

    stellar contract build
    CONTRACT_ID="$(stellar contract deploy \
      --wasm target/wasm32-unknown-unknown/release/soroban_escrow.wasm \
      --network "$NETWORK" \
      --source "$SOURCE")"
    echo "deployed escrow contract: $CONTRACT_ID"

    XLM_TOKEN="$(native_xlm_token)"
    AMOUNT=5000000            # 0.5 XLM (7 decimals)
    TIMEOUT_UNIX=$(( $(date +%s) + 3600 ))
    START_LEDGER="$(curl -sf https://horizon-testnet.stellar.org/ | \
      python3 -c 'import sys,json; print(json.load(sys.stdin)["history_latest_ledger"])')"

    invoke deposit --xlm_token "$XLM_TOKEN" --order_id "$ORDER_ID" \
      --buyer "$ADDRESS" --farmer "$ADDRESS" --amount "$AMOUNT" \
      --timeout_unix "$TIMEOUT_UNIX"
    invoke release --xlm_token "$XLM_TOKEN" --order_id "$ORDER_ID"

    wait_for_release_event "$START_LEDGER" "$ORDER_ID"
    ;;

  help|*)
    echo "Usage: ./cli.sh <subcommand>"
    echo ""
    echo "Subcommands:"
    echo "  build                                                — compile the wasm"
    echo "  deploy                                                — build + deploy to \$NETWORK"
    echo "  deposit <xlm_token> <order_id> <buyer> <farmer> <amount> <timeout_unix>"
    echo "  release <xlm_token> <order_id>"
    echo "  refund  <xlm_token> <order_id>"
    echo "  dispute <order_id> <caller>"
    echo "  get     <order_id>                                    — print full Escrow"
    echo "  smoke-test                                            — deploy+deposit+release+verify (see header docs)"
    ;;

esac
