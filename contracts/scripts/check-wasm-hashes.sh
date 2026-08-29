#!/usr/bin/env bash
# Compare freshly built contract WASM hashes with contracts_registry records.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
network="${NETWORK:-testnet}"
: "${DATABASE_URL:?Set DATABASE_URL to the deployment registry database}"
command -v cargo >/dev/null; command -v psql >/dev/null; command -v shasum >/dev/null

# registry name | Cargo manifest | release WASM path relative to its manifest directory
contracts=(
  "escrow|contract/Cargo.toml|target/wasm32-unknown-unknown/release/escrow.wasm"
  "reward-token|contract/reward-token/Cargo.toml|target/wasm32-unknown-unknown/release/reward_token.wasm"
  "soroban-escrow|contracts/escrow/Cargo.toml|target/wasm32-unknown-unknown/release/soroban_escrow.wasm"
  "creator-earnings|contracts/creator-earnings/Cargo.toml|target/wasm32-unknown-unknown/release/creator_earnings.wasm"
)

for spec in "${contracts[@]}"; do
  IFS='|' read -r name manifest wasm <<<"$spec"
  manifest_dir="$root/$(dirname "$manifest")"
  cargo build --manifest-path "$root/$manifest" --release --target wasm32-unknown-unknown
  actual="$(shasum -a 256 "$manifest_dir/$wasm" | awk '{print $1}')"
  expected="$(psql "$DATABASE_URL" -Atqc "SELECT wasm_hash FROM contracts_registry WHERE name='$name' AND network='$network' LIMIT 1")"
  expected="${expected#0x}"
  [[ -n "$expected" ]] || { echo "Missing registered WASM hash: $name ($network)" >&2; exit 1; }
  [[ "${actual,,}" == "${expected,,}" ]] || { echo "WASM hash mismatch: $name" >&2; exit 1; }
  echo "OK: $name"
done
