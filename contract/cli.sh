#!/usr/bin/env bash
# Escrow contract CLI — wraps `stellar contract invoke`
# Usage: ./cli.sh <subcommand> [args]
#
# Required env vars:
#   CONTRACT_ID   — deployed contract address
#   NETWORK       — testnet | mainnet | standalone (default: testnet)
#   SOURCE        — Stellar account key name (from `stellar keys`)

set -euo pipefail

CONTRACT_ID="${CONTRACT_ID:?Set CONTRACT_ID}"
NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-default}"

invoke() {
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    --source "$SOURCE" \
    -- "$@"
}

case "${1:-help}" in

  create)
    # ./cli.sh create <payer> <freelancer> <token> <amount> [deadline]
    PAYER="$2" FREELANCER="$3" TOKEN="$4" AMOUNT="$5"
    DEADLINE="${6:-}"
    if [ -n "$DEADLINE" ]; then
      invoke create --payer "$PAYER" --freelancer "$FREELANCER" \
        --token "$TOKEN" --amount "$AMOUNT" --deadline "$DEADLINE"
    else
      invoke create --payer "$PAYER" --freelancer "$FREELANCER" \
        --token "$TOKEN" --amount "$AMOUNT"
    fi
    ;;

  submit)
    invoke submit_work
    ;;

  approve)
    # Token no longer required — read from contract storage
    invoke approve
    ;;

  cancel)
    # Token no longer required — read from contract storage
    invoke cancel
    ;;

  expire)
    invoke expire
    ;;

  status)
    # Lightweight — uses get_status, not get_escrow
    invoke get_status
    ;;

  get)
    invoke get_escrow
    ;;

  help|*)
    echo "Usage: ./cli.sh <subcommand>"
    echo ""
    echo "Subcommands:"
    echo "  create <payer> <freelancer> <token> <amount> [deadline]"
    echo "  submit    — freelancer submits work"
    echo "  approve   — payer approves and releases funds"
    echo "  cancel    — payer cancels and reclaims funds"
    echo "  expire    — payer reclaims funds after deadline"
    echo "  status    — print current EscrowStatus"
    echo "  get       — print full EscrowData"
    ;;

esac
