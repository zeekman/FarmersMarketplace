#!/usr/bin/env bash
# Escrow contract CLI — wraps `stellar contract invoke`
# Usage: ./cli.sh <subcommand> [args] [--secret-key S...]
#
# Required env vars:
#   CONTRACT_ID   — deployed contract address
#   NETWORK       — testnet | mainnet | standalone (default: testnet)
#   SOURCE        — Stellar account key name (from `stellar keys`)
#
# Non-interactive signing (CI):
#   Pass --secret-key S... as a flag, or set STELLAR_SECRET_KEY in the
#   environment. When supplied, the raw secret key signs the transaction
#   instead of a named `stellar keys` identity. (#859)

set -euo pipefail

CONTRACT_ID="${CONTRACT_ID:?Set CONTRACT_ID}"
NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-default}"
SECRET_KEY="${STELLAR_SECRET_KEY:-}"

# Pre-scan argv for --secret-key so it can appear anywhere (CI convenience). (#859)
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --secret-key)
      SECRET_KEY="${2:?--secret-key requires a value}"
      shift 2
      ;;
    --secret-key=*)
      SECRET_KEY="${1#*=}"
      shift
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done
set -- "${ARGS[@]:-}"

invoke() {
  if [ -n "$SECRET_KEY" ]; then
    stellar contract invoke \
      --id "$CONTRACT_ID" \
      --network "$NETWORK" \
      --source-account "$SECRET_KEY" \
      -- "$@"
  else
    stellar contract invoke \
      --id "$CONTRACT_ID" \
      --network "$NETWORK" \
      --source "$SOURCE" \
      -- "$@"
  fi
}

case "${1:-help}" in

  # ── #852 - Wasm binary optimisation ────────────────────────────────────────
  # Build a size-optimised Wasm binary, then run wasm-opt for further reduction.
  # Requires: cargo, wasm-opt (from binaryen: https://github.com/WebAssembly/binaryen)
  #
  # Example:
  #   ./cli.sh build
  build)
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    echo "==> cargo build --release (opt-level=z, strip=symbols, lto=true)"
    cargo build \
      --manifest-path "${SCRIPT_DIR}/Cargo.toml" \
      --target wasm32-unknown-unknown \
      --release

    RAW_WASM="${SCRIPT_DIR}/target/wasm32-unknown-unknown/release/escrow.wasm"
    OPT_WASM="${SCRIPT_DIR}/target/wasm32-unknown-unknown/release/escrow.optimized.wasm"

    if command -v wasm-opt &>/dev/null; then
      echo "==> wasm-opt -Oz --strip-debug --strip-producers -o ${OPT_WASM} ${RAW_WASM}"
      wasm-opt -Oz \
        --strip-debug \
        --strip-producers \
        -o "${OPT_WASM}" \
        "${RAW_WASM}"
      echo "Raw size   : $(wc -c < "${RAW_WASM}") bytes"
      echo "Optimised  : $(wc -c < "${OPT_WASM}") bytes"
      echo "Deploy with: CONTRACT_WASM=${OPT_WASM}"
    else
      echo "wasm-opt not found — skipping post-processing step."
      echo "Install binaryen: https://github.com/WebAssembly/binaryen#releases"
      echo "Raw Wasm   : ${RAW_WASM}"
    fi
    ;;

  # ── #837 ─────────────────────────────────────────────────────────────────
  # Call once immediately after deployment to set admin, fee_bps, fee_destination.
  # Example:
  #   CONTRACT_ID=C... SOURCE=mykey \
  #   ./cli.sh initialize GADMIN... 250 GFEEDEST...
  initialize)
    ADMIN="${2:?Provide admin address}"
    FEE_BPS="${3:?Provide fee_bps (e.g. 250 for 2.5%; max 500)}"
    FEE_DESTINATION="${4:?Provide fee_destination address}"
    invoke initialize \
      --admin "$ADMIN" \
      --fee_bps "$FEE_BPS" \
      --fee_destination "$FEE_DESTINATION"
    echo "Contract initialized. Admin=$ADMIN fee_bps=$FEE_BPS fee_destination=$FEE_DESTINATION"
    ;;

  # ── #855 - Fee rate update ────────────────────────────────────────────────
  # Admin-only. new_fee_bps must be <= 500 (MAX_FEE_BPS).
  # Example:
  #   CONTRACT_ID=C... SOURCE=admin_key \
  #   ./cli.sh set-fee-rate 300
  set-fee-rate)
    NEW_FEE_BPS="${2:?Provide new_fee_bps (max 500)}"
    invoke set_fee_rate --new_fee_bps "$NEW_FEE_BPS"
    echo "Fee rate updated to ${NEW_FEE_BPS} bps"
    ;;

  # ── #853 - Contract upgrade ───────────────────────────────────────────────
  # Admin-only. Replaces the WASM binary; all persistent escrow state is preserved.
  # Example:
  #   NEW_WASM_HASH=$(stellar contract install --wasm escrow.optimized.wasm ...)
  #   CONTRACT_ID=C... SOURCE=admin_key \
  #   ./cli.sh upgrade "$NEW_WASM_HASH"
  upgrade)
    NEW_WASM_HASH="${2:?Provide new_wasm_hash (hex or base64)}"
    invoke upgrade --new_wasm_hash "$NEW_WASM_HASH"
    echo "Contract upgraded to WASM hash: ${NEW_WASM_HASH}"
    ;;

  # ── #854 - Circuit breaker ────────────────────────────────────────────────
  # pause: admin-only; blocks all state-changing calls immediately.
  # Example:
  #   CONTRACT_ID=C... SOURCE=admin_key ./cli.sh pause
  pause)
    invoke pause
    echo "Contract paused. All state-changing operations are now blocked."
    ;;

  # unpause: requires 2-of-3 Platform holders to vote.
  # Each Platform key must call this independently.
  # Example:
  #   CONTRACT_ID=C... SOURCE=platform_key1 ./cli.sh unpause GPLATFORM1...
  #   CONTRACT_ID=C... SOURCE=platform_key2 ./cli.sh unpause GPLATFORM2...
  unpause)
    CALLER="${2:?Provide caller address (must hold Platform role)}"
    invoke unpause --caller "$CALLER"
    echo "Unpause vote cast by ${CALLER}."
    ;;

  # ── Deposit / release / refund / dispute ─────────────────────────────────

  deposit)
    ORDER_ID="${2:?Provide order_id}"
    BUYER="${3:?Provide buyer address}"
    FARMER="${4:?Provide farmer address}"
    AMOUNT="${5:?Provide amount}"
    TIMEOUT="${6:?Provide timeout_unix}"
    PRODUCT_NAME="${7:?Provide product_name}"
    PRICE_STROOPS="${8:?Provide price_stroops}"
    invoke deposit \
      --order_id "$ORDER_ID" \
      --buyer "$BUYER" \
      --farmer "$FARMER" \
      --amount "$AMOUNT" \
      --timeout_unix "$TIMEOUT" \
      --product_name "$PRODUCT_NAME" \
      --price_stroops "$PRICE_STROOPS"
    ;;

  release)
    ORDER_ID="${2:?Provide order_id}"
    PRODUCT_NAME="${3:?Provide product_name}"
    PRICE_STROOPS="${4:?Provide price_stroops}"
    invoke release \
      --order_id "$ORDER_ID" \
      --product_name "$PRODUCT_NAME" \
      --price_stroops "$PRICE_STROOPS"
    ;;

  refund)
    ORDER_ID="${2:?Provide order_id}"
    AMOUNT="${3:-}"
    if [ -n "$AMOUNT" ]; then
      invoke refund --order_id "$ORDER_ID" --amount "$AMOUNT"
    else
      invoke refund --order_id "$ORDER_ID"
    fi
    ;;

  status)
    ORDER_ID="${2:?Provide order_id}"
    invoke get_escrow --order_id "$ORDER_ID"
    ;;

  is-paused)
    invoke is_paused
    ;;

  help|*)
    echo "Usage: ./cli.sh <subcommand>"
    echo ""
    echo "Build:"
    echo "  build                                          — #852: cargo build + wasm-opt"
    echo ""
    echo "Admin:"
    echo "  initialize <admin> <fee_bps> <fee_destination> — #837: call once after deploy"
    echo "  set-fee-rate <new_fee_bps>                     — #855: update fee (max 500 bps)"
    echo "  upgrade <new_wasm_hash>                        — #853: upgrade WASM, preserve state"
    echo "  pause                                          — #854: activate circuit breaker"
    echo "  unpause <caller_address>                       — #854: cast unpause vote (2-of-3)"
    echo ""
    echo "Escrow:"
    echo "  deposit <order_id> <buyer> <farmer> <amount> <timeout> <product_name> <price>"
    echo "  release <order_id> <product_name> <price_stroops>"
    echo "  refund  <order_id> [amount]"
    echo "  status  <order_id>"
    echo "  is-paused"
    ;;

esac
