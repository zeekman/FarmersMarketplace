#!/usr/bin/env bash
# CT-30: single deployment entry point for all Soroban contracts.
#
#   contracts/scripts/deploy.sh <testnet|futurenet|mainnet>
#
# Builds, optimises, uploads and deploys every contract, initialises each with
# arguments from contracts/deploy.<network>.toml, wires escrow -> reward-token
# minter and creator-earnings authorised caller, and writes
# deployments/<network>.json. Re-running with an unchanged WASM hash skips
# redeploying that contract.
#
# Env: STELLAR_SECRET_KEY (required) — deployer secret / stellar-cli identity.
set -euo pipefail

NETWORK="${1:?usage: deploy.sh <testnet|futurenet|mainnet>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$ROOT/contracts/deploy.$NETWORK.toml"
OUT="$ROOT/deployments/$NETWORK.json"
: "${STELLAR_SECRET_KEY:?STELLAR_SECRET_KEY is required}"
[ -f "$CONFIG" ] || { echo "missing $CONFIG" >&2; exit 1; }
mkdir -p "$ROOT/deployments"
[ -f "$OUT" ] || echo '[]' > "$OUT"

DEPLOYER="$(stellar keys public-key --secret-key "$STELLAR_SECRET_KEY" 2>/dev/null || stellar keys address "$STELLAR_SECRET_KEY")"
GIT_SHA="$(git -C "$ROOT" rev-parse HEAD)"
[ "$NETWORK" = mainnet ] || curl -sf "https://friendbot.stellar.org/?addr=$DEPLOYER" >/dev/null || true

# name|cargo dir|package|wasm file
CONTRACTS=(
  "escrow|contracts|soroban-escrow|soroban_escrow"
  "creator-earnings|contracts|creator-earnings|creator_earnings"
  "reward-token|contracts|reward-token|reward_token"
)

# Print `--key value` init args for a contract from the TOML config.
init_args() {
  python3 - "$CONFIG" "$1" "$DEPLOYER" <<'PY'
import sys, tomllib
cfg = tomllib.load(open(sys.argv[1], "rb")).get(sys.argv[2], {})
for k, v in cfg.items():
    v = str(v).replace("$DEPLOYER", sys.argv[3])
    if "REPLACE_WITH" in v:
        sys.exit(f"{sys.argv[2]}.{k} is not configured in {sys.argv[1]}")
    print(f"--{k}\n{v}")
PY
}

# Read a field of an existing registry entry.
registry_get() {
  python3 -c 'import json,sys
for e in json.load(open(sys.argv[1])):
    if e["contract"]==sys.argv[2]: print(e.get(sys.argv[3],"")); break' "$OUT" "$1" "$2"
}

registry_put() {
  python3 - "$OUT" "$@" <<'PY'
import json, sys, datetime
out, contract, cid, wasm_hash, sdk, sha = sys.argv[1:]
entries = [e for e in json.load(open(out)) if e["contract"] != contract]
entries.append({"contract": contract, "id": cid, "wasm_hash": wasm_hash, "sdk_version": sdk,
                "git_sha": sha,
                "deployed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")})
json.dump(sorted(entries, key=lambda e: e["contract"]), open(out, "w"), indent=2)
open(out, "a").write("\n")
PY
}

invoke() {
  local id="$1"; shift
  stellar contract invoke --id "$id" --network "$NETWORK" --source-account "$STELLAR_SECRET_KEY" -- "$@"
}

declare -A IDS FRESH
for entry in "${CONTRACTS[@]}"; do
  IFS='|' read -r name dir pkg wasm <<<"$entry"
  echo "==> $name"
  (cd "$ROOT/$dir" && cargo build -p "$pkg" --target wasm32-unknown-unknown --release)
  raw="$ROOT/$dir/target/wasm32-unknown-unknown/release/$wasm.wasm"
  opt="${raw%.wasm}.optimized.wasm"
  stellar contract optimize --wasm "$raw" --wasm-out "$opt"
  hash="$(sha256sum "$opt" | cut -d' ' -f1)"
  sdk="$(grep -m1 -oP 'soroban-sdk\s*=\s*(\{\s*version\s*=\s*)?"=?\K[0-9.]+' "$ROOT/$dir/Cargo.toml" 2>/dev/null || grep -m1 -oP 'soroban-sdk\s*=\s*(\{\s*version\s*=\s*)?"=?\K[0-9.]+' "$ROOT/$dir/$name/Cargo.toml")"

  if [ "$(registry_get "$name" wasm_hash)" = "$hash" ]; then
    IDS[$name]="$(registry_get "$name" id)"
    echo "    unchanged wasm ($hash) — keeping ${IDS[$name]}"
    continue
  fi

  stellar contract upload --wasm "$opt" --network "$NETWORK" --source-account "$STELLAR_SECRET_KEY" >/dev/null
  IDS[$name]="$(stellar contract deploy --wasm "$opt" --network "$NETWORK" --source-account "$STELLAR_SECRET_KEY")"
  FRESH[$name]=1
  echo "    deployed ${IDS[$name]}"
  registry_put "$name" "${IDS[$name]}" "$hash" "$sdk" "$GIT_SHA"
done

# Initialise freshly deployed contracts.
if [ -n "${FRESH[escrow]:-}" ]; then
  mapfile -t args < <(init_args escrow); invoke "${IDS[escrow]}" initialize "${args[@]}"
fi
if [ -n "${FRESH[creator-earnings]:-}" ]; then
  mapfile -t args < <(init_args creator-earnings); invoke "${IDS[creator-earnings]}" init "${args[@]}"
fi
if [ -n "${FRESH[reward-token]:-}" ]; then
  mapfile -t args < <(init_args reward-token)
  invoke "${IDS[reward-token]}" initialize "${args[@]}" --minter "${IDS[escrow]}"
fi

# Wiring (CT-16): escrow mints rewards and is the creator-earnings authorised caller.
if [ ${#FRESH[@]} -gt 0 ]; then
  invoke "${IDS[escrow]}" set_reward_token --reward_token_address "${IDS[reward-token]}"
  invoke "${IDS[creator-earnings]}" set_authorized_caller --authorized_caller "${IDS[escrow]}"
fi

echo "Registry written to $OUT"
cat "$OUT"
