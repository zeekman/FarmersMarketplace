#!/usr/bin/env bash
# check-escrow-error-codes.sh
#
# Verifies that every EscrowError variant in contracts/escrow/src/lib.rs
# has a matching row in the README "Error Codes" table, and vice-versa, that
# the "// NEXT_CODE: N" comment equals the highest discriminant + 1, and that
# no discriminant is duplicated or reused against the append-only history in
# contracts/escrow/error-codes.txt (#1238).
#
# Codes are on-chain ABI values and must stay stable and append-only:
#   - variants are numbered 1..N in declaration order (no gaps, no reuse);
#   - the `// NEXT_CODE: N` comment above the enum equals the last code + 1.
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
HISTORY="$REPO_ROOT/contracts/escrow/error-codes.txt"

# ---------------------------------------------------------------------------
# Extract "VariantName = N" pairs from the EscrowError enum in lib.rs.
# We grab lines between the enum declaration and its closing '}' (POSIX sed,
# so it runs without gawk).
# ---------------------------------------------------------------------------
enum_codes() {
  sed -n '/^pub enum EscrowError/,/^}/p' "$LIB" \
    | sed -nE 's/^[[:space:]]*([A-Za-z]+)[[:space:]]*=[[:space:]]*([0-9]+).*/\2 \1/p'
  # Portable (no gawk-only match(..., arr)): matches lines like  SomeName = 42,
  sed -n '/^pub enum EscrowError/,/^}/p' "$LIB" \
    | sed -nE 's/^[[:space:]]*([A-Za-z]+)[[:space:]]*=[[:space:]]*([0-9]+).*/\2 \1/p' \
    | sort -n
}

# ---------------------------------------------------------------------------
# Extract "| N | `VariantName` | ..." rows from the README Error Codes table.
# ---------------------------------------------------------------------------
readme_codes() {
  grep -E '^\| *[0-9]+ *\| *`[A-Za-z]+`' "$README" \
    | sed -E 's/^\| *([0-9]+) *\| *`([A-Za-z]+)`.*/\1 \2/' \
    | sort -n
}

DECLARED=$(enum_codes)
ENUM=$(echo "$DECLARED" | sort -n)
README_TABLE=$(readme_codes)
FAIL=0

# ---------------------------------------------------------------------------
# #1238 — NEXT_CODE comment must equal (highest discriminant + 1), no code may
# appear twice, and no code may be reused against the append-only history in
# contracts/escrow/error-codes.txt.
# ---------------------------------------------------------------------------
NEXT_CODE=$(sed -nE 's|^// NEXT_CODE:[[:space:]]*([0-9]+).*|\1|p' "$LIB" | head -n1)
MAX_CODE=$(echo "$ENUM" | awk 'END { print $1 + 0 }')
HISTORY_TABLE=$(grep -vE '^[[:space:]]*(#|$)' "$HISTORY" | sort -n)
HISTORY_MAX=$(echo "$HISTORY_TABLE" | awk 'END { print $1 + 0 }')

if [ -z "$NEXT_CODE" ]; then
  echo "✗ '// NEXT_CODE: N' comment not found in $LIB"
  FAIL=1
elif [ "$NEXT_CODE" -ne $((MAX_CODE + 1)) ] || [ "$NEXT_CODE" -le "$HISTORY_MAX" ]; then
  echo "✗ NEXT_CODE is $NEXT_CODE but must be $(( (MAX_CODE > HISTORY_MAX ? MAX_CODE : HISTORY_MAX) + 1 ))" \
       "(highest enum discriminant: $MAX_CODE, highest historical code: $HISTORY_MAX)."
  FAIL=1
fi

DUPES=$(echo "$ENUM" | awk '{ print $1 }' | uniq -d)
if [ -n "$DUPES" ]; then
  echo "✗ Duplicate EscrowError discriminant(s): $DUPES"
  FAIL=1
fi

while read -r code name; do
  [ -z "$code" ] && continue
  prev=$(echo "$HISTORY_TABLE" | awk -v c="$code" '$1 == c { print $2 }')
  if [ -z "$prev" ]; then
    echo "✗ Code $code ($name) is missing from $HISTORY — append '$code $name' to it."
    FAIL=1
  elif [ "$prev" != "$name" ]; then
    echo "✗ Code $code is reused: now '$name', previously '$prev'. Codes must never be reused."
    FAIL=1
  fi
done <<< "$ENUM"

[ "$FAIL" -eq 0 ] && echo "✓ NEXT_CODE ($NEXT_CODE) and discriminant history are consistent."

# Append-only: codes must read 1, 2, ..., N in declaration order.
COUNT=$(echo "$DECLARED" | wc -l)
if [ "$(echo "$DECLARED" | awk '{print $1}')" != "$(seq 1 "$COUNT")" ]; then
  echo "✗ EscrowError codes must be numbered 1..$COUNT in declaration order (append-only, no gaps or reuse)."
  echo "$DECLARED"
  exit 1
fi

NEXT_CODE=$(sed -nE 's|^// NEXT_CODE: ([0-9]+).*|\1|p' "$LIB")
if [ "$NEXT_CODE" != "$((COUNT + 1))" ]; then
  echo "✗ NEXT_CODE comment in lib.rs is '${NEXT_CODE}', expected $((COUNT + 1))."
  exit 1
fi

if [ "$ENUM" = "$README_TABLE" ]; then
  echo "✓ EscrowError codes match README table."
  exit "$FAIL"
fi

echo "✗ EscrowError codes do not match the README 'Error Codes' table."
echo ""
echo "--- enum (contracts/escrow/src/lib.rs)"
echo "+++ README.md Error Codes table"
diff <(echo "$ENUM") <(echo "$README_TABLE") || true
echo ""
echo "Update README.md to match the enum, or vice-versa, then re-run."
exit 1
