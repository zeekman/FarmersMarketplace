# Legacy Escrow Contract (Deprecated)

> **⚠️ DEPRECATED — DO NOT DEVELOP HERE.**
>
> This crate (`contract/`) is the **legacy** escrow contract. It is no longer
> actively developed and is retained only for historical reference. See
> [ADR 0002: Contract Architecture](../docs/adr/0002-contract-architecture.md#legacy-contract-deprecation)
> for the decision record.
>
> The actively developed escrow contract lives in
> [`contracts/escrow/`](../contracts/escrow/). All new features, bug fixes, and
> security patches must target that crate. It uses typed errors and a newer
> `soroban-sdk` version, whereas this legacy crate still uses `panic!` strings
> for authorisation failures.

## Status

- **Deployed:** No. This crate is not deployed to any network and its contract
  address has been removed from configuration.
- **CI:** Built, linted and tested in the `soroban-contracts` CI matrix; no
  longer the default target for new tests.
- **Maintenance:** Frozen. No further changes are accepted here.
- **Removal milestone:** v2.0 (target 2026-12-31), after the backend harness and
  Futurenet E2E move to `contracts/escrow`. Backend legacy ABI calls are gated
  by `ENABLE_LEGACY_ESCROW_ABI` (default off).

## Consumer inventory (legacy ABI)

- `backend/src/__tests__/helpers/soroban.js` — sandbox integration harness
  (default WASM now comes from `contracts/escrow`).
- `contract/test-futurenet.sh`, `contract/cli.sh`, `contract/wasm-profile.sh` —
  legacy E2E/CLI/profile scripts; kept for compatibility only.
- `backend/src/services/escrowErrors.js` — `LEGACY_ESCROW_ERRORS` table
  (used only when the config flag is enabled).
- `.env.example`, `backend/.env.example` — `LEGACY_ESCROW_CONTRACT_ID` /
  `ENABLE_LEGACY_ESCROW_ABI` settings.
- `deployments/*.json` — no legacy contract IDs are registered (testnet
  registry is currently empty).

## What this crate contained

For reference, the legacy crate implemented:

- Role management: `grant_role`, `revoke_role`
- Fee configuration: `set_fee_rate`
- Circuit breaking: `pause` / `unpause`
- Dispute handling: `open_dispute` / `resolve_dispute`
- Product hashing: `compute_product_hash`

Any of these behaviours still required by the product must be ported to
`contracts/escrow/` (see ADR 0002 for the migration plan using the existing
`migrate_preview` / `migrate` functions).

## Do not

- Do not fix bugs in this crate.
- Do not add features here.
- Do not point the backend at a contract ID built from this crate.
