# Branch protection for `main`

Required status checks (Settings → Branches → `main`):

- `Contracts (fmt, clippy, test, wasm) (contracts-workspace)`
- `Contracts (fmt, clippy, test, wasm) (contract-escrow)`
- `Contracts (fmt, clippy, test, wasm) (contract-reward-token)`
- `Contracts (fmt, clippy, test, wasm) (contract-carbon-offset)`
- `WASM size diff`
- `actionlint`

Equivalent `gh` command:

```sh
gh api -X PUT repos/zeekman/FarmersMarketplace/branches/main/protection/required_status_checks \
  -f strict=true \
  -f 'contexts[]=Contracts (fmt, clippy, test, wasm) (contracts-workspace)' \
  -f 'contexts[]=Contracts (fmt, clippy, test, wasm) (contract-escrow)' \
  -f 'contexts[]=Contracts (fmt, clippy, test, wasm) (contract-reward-token)' \
  -f 'contexts[]=Contracts (fmt, clippy, test, wasm) (contract-carbon-offset)' \
  -f 'contexts[]=WASM size diff' \
  -f 'contexts[]=actionlint'
```
