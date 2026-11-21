#!/usr/bin/env bash
# Verifies that the escrow contract's error codes are unique and contiguous.
# The canonical EscrowError enum lives in contracts/escrow/src/lib.rs.
set -euo pipefail

ERRORS_FILE="contracts/escrow/src/lib.rs"

if [[ ! -f "$ERRORS_FILE" ]]; then
  echo "error: canonical error file not found: $ERRORS_FILE" >&2
  exit 1
fi

# Extract the numeric discriminants from the EscrowError enum.
codes=$(grep -oE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=[[:space:]]*[0-9]+' "$ERRORS_FILE" \
  | grep -oE '[0-9]+$' | sort -n)

if [[ -z "$codes" ]]; then
  echo "error: no error codes found in $ERRORS_FILE" >&2
  exit 1
fi

# Check for duplicates.
duplicates=$(echo "$codes" | uniq -d)
if [[ -n "$duplicates" ]]; then
  echo "error: duplicate error codes found in $ERRORS_FILE: $duplicates" >&2
  exit 1
fi

# Check that codes are contiguous starting at 1.
expected=1
while IFS= read -r code; do
  if [[ "$code" -ne "$expected" ]]; then
    echo "error: non-contiguous error codes in $ERRORS_FILE: expected $expected, found $code" >&2
    exit 1
  fi
  expected=$((expected + 1))
done <<< "$codes"

echo "OK: escrow error codes in $ERRORS_FILE are unique and contiguous"
