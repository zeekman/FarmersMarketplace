#!/usr/bin/env bash
# CT-30: single deployment entry point for all Soroban contracts.
#
#   contracts/scripts/deploy.sh <testnet|futurenet|mainnet>
#
# Builds, optimises, uploads and deploys every contract, initialises each with
# arguments from contracts/deploy.<network>.toml, wires escrow -> reward-token
# minter and creator-earnings authorised caller, verifies on-chain config against
# the TOML, and only then writes deployments/<network>.json. Re-running with an
# unchanged WASM hash skips redeploying that contract (it is still verified).
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
# Pins escrow's admin into the WASM so initialize() can't be front-run with an attacker admin (#1733).
export ESCROW_ADMIN="$DEPLOYER"
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
                "git_sha": sha, "initialized": True,
                "deployed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")})
json.dump(sorted(entries, key=lambda e: e["contract"]), open(out, "w"), indent=2)
open(out, "a").write("\n")
PY
}

invoke() {
  local id="$1"; shift
  stellar contract invoke --id "$id" --network "$NETWORK" --source-account "$STELLAR_SECRET_KEY" -- "$@"
}

# Read-only call: simulates only, submits nothing.
view() {
  local id="$1"; shift
  stellar contract invoke --id "$id" --network "$NETWORK" --source-account "$STELLAR_SECRET_KEY" --send no -- "$@"
}

# Print one field of a JSON object on stdin ("" when null).
jget() {
  python3 -c 'import json,sys; v=json.load(sys.stdin).get(sys.argv[1]); print("" if v is None else v)' "$1"
}

# Print a value from the TOML config with $DEPLOYER substituted.
toml_get() {
  python3 -c 'import sys,tomllib; v=tomllib.load(open(sys.argv[1],"rb"))[sys.argv[2]][sys.argv[3]]; print(str(v).replace("$DEPLOYER", sys.argv[4]))' "$CONFIG" "$1" "$2" "$DEPLOYER"
}

declare -A IDS FRESH HASHES SDKS
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
  HASHES[$name]="$hash"
  SDKS[$name]="$sdk"
  echo "    deployed ${IDS[$name]}"
done

# Initialise freshly deployed contracts. Registry entries are written only after
# init, wiring and verification pass, so a failed run is retried from scratch
# instead of being recorded as "unchanged".
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

# Verify on-chain config against deploy.<network>.toml for every contract, including
# unchanged ones: an uninitialised or foreign-admin contract fails the run here.
expect() { [ "$2" = "$3" ] || { echo "verify failed: $1 is '$2', expected '$3'" >&2; exit 1; }; }
echo "==> verifying config"
esc="$(view "${IDS[escrow]}" get_config)"
expect "escrow.admin" "$(jget admin <<<"$esc")" "$(toml_get escrow admin)"
expect "escrow.fee_bps" "$(jget fee_bps <<<"$esc")" "$(toml_get escrow fee_bps)"
expect "escrow.fee_destination" "$(jget fee_destination <<<"$esc")" "$(toml_get escrow fee_destination)"
expect "escrow.reward_token" "$(jget reward_token <<<"$esc")" "${IDS[reward-token]}"
ce="$(view "${IDS[creator-earnings]}" get_config)"
expect "creator-earnings.admin" "$(jget admin <<<"$ce")" "$(toml_get creator-earnings platform)"
expect "creator-earnings.authorized_caller" "$(jget authorized_caller <<<"$ce")" "${IDS[escrow]}"

for name in "${!FRESH[@]}"; do
  registry_put "$name" "${IDS[$name]}" "${HASHES[$name]}" "${SDKS[$name]}" "$GIT_SHA"
done

echo "Registry written to $OUT"
cat "$OUT"
