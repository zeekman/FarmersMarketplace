#!/usr/bin/env bash
# Profiles compiled WASM binary sizes for the escrow and reward-token contracts.
#
# Builds each contract in both debug (unoptimized) and release (optimized) modes,
# then reports sizes and the reduction achieved by the release profile settings:
#   opt-level = "z", lto = true, codegen-units = 1, strip = "symbols", panic = "abort"
#
# Usage:
#   ./contract/wasm-profile.sh
#
# Requirements:
#   cargo + wasm32-unknown-unknown target  (rustup target add wasm32-unknown-unknown)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── helpers ──────────────────────────────────────────────────────────────────

fmt_bytes() {
  local b=$1
  if [ "$b" -ge 1048576 ]; then
    printf "%.2f MiB (%d bytes)" "$(echo "scale=2; $b / 1048576" | bc)" "$b"
  elif [ "$b" -ge 1024 ]; then
    printf "%.2f KiB (%d bytes)" "$(echo "scale=2; $b / 1024" | bc)" "$b"
  else
    printf "%d bytes" "$b"
  fi
}

pct_reduction() {
  local before=$1 after=$2
  echo "scale=1; 100 - ($after * 100 / $before)" | bc
}

build_wasm() {
  local dir="$1" profile="$2"
  local cargo_flag=""
  [ "$profile" = "release" ] && cargo_flag="--release"
  cargo build --manifest-path "$dir/Cargo.toml" \
    --target wasm32-unknown-unknown $cargo_flag \
    --quiet 2>/dev/null
}

wasm_size() {
  local dir="$1" pkg="$2" profile="$3"
  # Cargo converts hyphens to underscores in output file names
  local name="${pkg//-/_}"
  local wasm="$dir/target/wasm32-unknown-unknown/$profile/${name}.wasm"
  if [ ! -f "$wasm" ]; then
    echo "ERROR: WASM not found at $wasm" >&2
    return 1
  fi
  wc -c < "$wasm"
}

profile_contract() {
  local dir="$1" pkg="$2"

  echo "┌─ $pkg"
  echo "│  dir: $dir"

  printf "│  Building debug  … "
  build_wasm "$dir" "debug"
  local dbg
  dbg=$(wasm_size "$dir" "$pkg" "debug")
  printf "done\n"

  printf "│  Building release … "
  build_wasm "$dir" "release"
  local rel
  rel=$(wasm_size "$dir" "$pkg" "release")
  printf "done\n"

  local pct
  pct=$(pct_reduction "$dbg" "$rel")

  echo "│"
  echo "│  debug   : $(fmt_bytes "$dbg")"
  echo "│  release : $(fmt_bytes "$rel")"
  echo "│  reduction: ${pct}%"
  echo "└──────────────────────────────────────────"
  echo ""

  # Emit structured output for CI job summaries
  echo "WASM_PROFILE_${pkg//-/_}_DEBUG_BYTES=$dbg"
  echo "WASM_PROFILE_${pkg//-/_}_RELEASE_BYTES=$rel"
  echo "WASM_PROFILE_${pkg//-/_}_REDUCTION_PCT=$pct"
}

# ── preflight ────────────────────────────────────────────────────────────────

if ! command -v cargo &>/dev/null; then
  echo "ERROR: cargo not found. Install Rust: https://rustup.rs" >&2
  exit 1
fi

if ! rustup target list --installed 2>/dev/null | grep -q wasm32-unknown-unknown; then
  echo "ERROR: wasm32-unknown-unknown target not installed." >&2
  echo "       Run: rustup target add wasm32-unknown-unknown" >&2
  exit 1
fi

# ── profile ──────────────────────────────────────────────────────────────────

echo ""
echo "========================================"
echo "  WASM Binary Size Profile"
echo "  Stellar / Soroban Contracts"
echo "========================================"
echo ""
echo "Release profile optimizations:"
echo "  opt-level      = \"z\"      (optimize for size)"
echo "  lto            = true     (link-time optimization)"
echo "  codegen-units  = 1        (single codegen unit for better LTO)"
echo "  strip          = \"symbols\" (strip debug symbols)"
echo "  panic          = \"abort\"   (no unwind tables)"
echo ""

profile_contract "$SCRIPT_DIR"              "escrow"
profile_contract "$SCRIPT_DIR/reward-token" "reward-token"
