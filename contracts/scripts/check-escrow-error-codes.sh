#!/usr/bin/env bash
# check-escrow-error-codes.sh
#
# Verifies that every EscrowError variant in contracts/escrow/src/lib.rs
# has a matching row in the README "Error Codes" table, and vice-versa.
#
# Run from the repo root or from contracts/:
#   bash contracts/scripts/check-escrow-error-codes.sh
#
# Exit codes:
#   0 — enum and README table are in sync
#   1 — mismatch found (CI fails)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$REPO_ROOT/contracts/escrow/src/lib.rs"
README="$REPO_ROOT/README.md"

# ---------------------------------------------------------------------------
# Extract "VariantName = N" pairs from the EscrowError enum in lib.rs.
# We grab lines between the #[repr(u32)] enum declaration and its closing '}'.
# ---------------------------------------------------------------------------
enum_codes() {
  awk '
    /^pub enum EscrowError/  { in_enum=1; next }
    in_enum && /^\}/ { in_enum=0; next }
    in_enum {
      # match lines like:  SomeName = 42,
      if (match($0, /([A-Za-z]+)[[:space:]]*=[[:space:]]*([0-9]+)/, arr))
        print arr[2] " " arr[1]
    }
  ' "$LIB" | sort -n
}

# ---------------------------------------------------------------------------
# Extract "| N | `VariantName` | ..." rows from the README Error Codes table.
# ---------------------------------------------------------------------------
readme_codes() {
  grep -E '^\| *[0-9]+ *\| *`[A-Za-z]+`' "$README" \
    | sed -E 's/^\| *([0-9]+) *\| *`([A-Za-z]+)`.*/\1 \2/' \
    | sort -n
}

ENUM=$(enum_codes)
README_TABLE=$(readme_codes)

if [ "$ENUM" = "$README_TABLE" ]; then
  echo "✓ EscrowError codes match README table."
  exit 0
fi

echo "✗ EscrowError codes do not match the README 'Error Codes' table."
echo ""
echo "--- enum (contracts/escrow/src/lib.rs)"
echo "+++ README.md Error Codes table"
diff <(echo "$ENUM") <(echo "$README_TABLE") || true
echo ""
echo "Update README.md to match the enum, or vice-versa, then re-run."
exit 1
