#!/usr/bin/env bash
# Build and enforce release WASM size budgets for the Soroban contracts workspace.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="wasm32-unknown-unknown"
LIMIT_BYTES="${SOROBAN_CONTRACT_WASM_LIMIT_BYTES:-131072}"
SAFETY_MARGIN_BYTES="${SOROBAN_CONTRACT_WASM_SAFETY_MARGIN_BYTES:-16384}"
MAX_RELEASE_BYTES=$((LIMIT_BYTES - SAFETY_MARGIN_BYTES))

if [ "$MAX_RELEASE_BYTES" -le 0 ]; then
  echo "ERROR: safety margin must be smaller than the contract WASM limit." >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "ERROR: cargo not found. Install Rust: https://rustup.rs" >&2
  exit 1
fi

if ! rustup target list --installed 2>/dev/null | grep -q "$TARGET"; then
  echo "ERROR: $TARGET target not installed." >&2
  echo "       Run: rustup target add $TARGET" >&2
  exit 1
fi

fmt_bytes() {
  local bytes="$1"
  awk -v bytes="$bytes" '
    BEGIN {
      if (bytes >= 1048576) {
        printf "%.2f MiB (%d bytes)", bytes / 1048576, bytes
      } else if (bytes >= 1024) {
        printf "%.2f KiB (%d bytes)", bytes / 1024, bytes
      } else {
        printf "%d bytes", bytes
      }
    }
  '
}

profile_contract() {
  local package="$1"
  local wasm_name="$2"
  local var_name="$3"
  local wasm_path="$SCRIPT_DIR/target/$TARGET/release/$wasm_name.wasm"

  echo "Building $package release WASM..."
  cargo build \
    --manifest-path "$SCRIPT_DIR/Cargo.toml" \
    -p "$package" \
    --target "$TARGET" \
    --release \
    --quiet

  if [ ! -f "$wasm_path" ]; then
    echo "ERROR: WASM not found at $wasm_path" >&2
    exit 1
  fi

  local size
  size="$(wc -c < "$wasm_path" | tr -d '[:space:]')"
  local margin_remaining=$((MAX_RELEASE_BYTES - size))

  echo "$package release size: $(fmt_bytes "$size")"
  echo "$package safety-budget remaining: $(fmt_bytes "$margin_remaining")"
  echo "CONTRACT_WASM_PROFILE_${var_name}_BYTES=$size"
  echo "CONTRACT_WASM_PROFILE_${var_name}_LIMIT_BYTES=$LIMIT_BYTES"
  echo "CONTRACT_WASM_PROFILE_${var_name}_SAFETY_MARGIN_BYTES=$SAFETY_MARGIN_BYTES"
  echo "CONTRACT_WASM_PROFILE_${var_name}_MAX_RELEASE_BYTES=$MAX_RELEASE_BYTES"

  if [ "$size" -gt "$LIMIT_BYTES" ]; then
    echo "ERROR: $package release WASM exceeds Soroban contractMaxSizeBytes ($LIMIT_BYTES)." >&2
    exit 1
  fi

  if [ "$size" -gt "$MAX_RELEASE_BYTES" ]; then
    echo "ERROR: $package release WASM exceeds safety budget ($MAX_RELEASE_BYTES)." >&2
    exit 1
  fi

  echo "CONTRACT_WASM_PROFILE_${var_name}_STATUS=ok"
  echo ""
}

echo "Contracts WASM Size Profile"
echo "target=$TARGET"
echo "contractMaxSizeBytes=$LIMIT_BYTES"
echo "safetyMarginBytes=$SAFETY_MARGIN_BYTES"
echo "maxReleaseBytes=$MAX_RELEASE_BYTES"
echo ""

profile_contract "soroban-escrow" "soroban_escrow" "SOROBAN_ESCROW"
profile_contract "creator-earnings" "creator_earnings" "CREATOR_EARNINGS"
