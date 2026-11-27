#!/usr/bin/env bash
# Builds and optimises every deployed Soroban contract, then reports {crate: bytes}
# for the optimised WASM (`stellar contract optimize`). Replaces contract/wasm-profile.sh.
#
# Usage:
#   contracts/wasm-profile.sh                    # print {crate: bytes} JSON
#   contracts/wasm-profile.sh --check BASELINE   # print markdown table; exit 1 on budget breach
#
# Budgets: a crate fails if it grows more than WASM_MAX_GROWTH_PCT over BASELINE, or if its
# optimised size exceeds SOROBAN_CONTRACT_WASM_LIMIT_BYTES minus the safety margin.
# Raising the baseline is done in the PR that justifies the growth.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="wasm32-unknown-unknown"
LIMIT_BYTES="${SOROBAN_CONTRACT_WASM_LIMIT_BYTES:-131072}"
SAFETY_MARGIN_BYTES="${SOROBAN_CONTRACT_WASM_SAFETY_MARGIN_BYTES:-16384}"
BUDGET_BYTES=$((LIMIT_BYTES - SAFETY_MARGIN_BYTES))
MAX_GROWTH_PCT="${WASM_MAX_GROWTH_PCT:-5}"

# key | manifest (repo-relative) | package | wasm file stem | target dir (repo-relative)
CRATES=(
  "escrow|contract/Cargo.toml|escrow|escrow|contract/target"
  "reward-token|contract/reward-token/Cargo.toml|reward-token|reward_token|contract/reward-token/target"
  "soroban-escrow|contracts/Cargo.toml|soroban-escrow|soroban_escrow|contracts/target"
  "creator-earnings|contracts/Cargo.toml|creator-earnings|creator_earnings|contracts/target"
)

for tool in cargo stellar python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: $tool not found." >&2; exit 1; }
done
rustup target list --installed 2>/dev/null | grep -q "$TARGET" || {
  echo "ERROR: $TARGET target not installed. Run: rustup target add $TARGET" >&2
  exit 1
}

BASELINE=""
if [ "${1:-}" = "--check" ]; then
  BASELINE="${2:?usage: wasm-profile.sh --check BASELINE_JSON}"
fi

profile_contract "soroban-escrow" "soroban_escrow" "SOROBAN_ESCROW"
profile_contract "creator-earnings" "creator_earnings" "CREATOR_EARNINGS"
profile_contract "reward-token" "reward_token" "REWARD_TOKEN"

# fm-math is an rlib (no WASM output of its own). Its code is inlined into each
# consumer contract at link time. Expected net size change from this refactor:
# neutral-to-slightly-smaller — one copy of the BPS multiply/divide replaces
# three slightly different hand-rolled copies, and lto=true + opt-level="z"
# deduplicates the inlined code across call sites within each WASM binary.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
: > "$TMP/sizes"

for spec in "${CRATES[@]}"; do
  IFS='|' read -r key manifest package stem target_dir <<< "$spec"
  cargo build --manifest-path "$ROOT/$manifest" -p "$package" \
    --target "$TARGET" --release --quiet >&2
  raw="$ROOT/$target_dir/$TARGET/release/$stem.wasm"
  [ -f "$raw" ] || { echo "ERROR: WASM not found at $raw" >&2; exit 1; }
  stellar contract optimize --wasm "$raw" --wasm-out "$TMP/$key.wasm" >&2
  echo "$key $(wc -c < "$TMP/$key.wasm" | tr -d '[:space:]')" >> "$TMP/sizes"
done

python3 - "$TMP/sizes" "$BASELINE" "$BUDGET_BYTES" "$MAX_GROWTH_PCT" <<'PY'
import json, sys

sizes_path, baseline_path, budget, max_growth = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
sizes = {}
with open(sizes_path) as f:
    for line in f:
        key, size = line.split()
        sizes[key] = int(size)

if not baseline_path:
    print(json.dumps(sizes, indent=2, sort_keys=True))
    sys.exit(0)

with open(baseline_path) as f:
    baseline = json.load(f)

rows = ["| Crate | Baseline (bytes) | Current (bytes) | Delta |", "|---|---:|---:|---:|"]
failures = []
for key in sorted(sizes):
    cur = sizes[key]
    if key not in baseline:
        rows.append(f"| {key} | _new_ | {cur:,} | n/a |")
        failures.append(f"`{key}` is not in `contracts/wasm-sizes.json`; add its size with justification.")
    else:
        old = baseline[key]
        pct = (cur - old) * 100.0 / old
        rows.append(f"| {key} | {old:,} | {cur:,} | {cur - old:+,} ({pct:+.2f}%) |")
        if cur * 100 > old * (100 + max_growth):
            failures.append(f"`{key}` grew {pct:.2f}% (limit {max_growth}%).")
    if cur > budget:
        failures.append(f"`{key}` is {cur:,} bytes, over the budget of {budget:,} bytes.")
for key in sorted(set(baseline) - set(sizes)):
    failures.append(f"`{key}` is in the baseline but was not built; remove it from `contracts/wasm-sizes.json`.")

print("### Soroban WASM sizes (optimised)")
print("")
print("\n".join(rows))
print("")
if failures:
    print("**Budget check failed:**")
    print("")
    for failure in failures:
        print(f"- {failure}")
    sys.exit(1)
print("Budget check passed.")
PY
