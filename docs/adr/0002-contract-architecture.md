# ADR 0002: Contract Architecture

- **Status:** Accepted
- **Date:** 2026-11-24
- **Supersedes:** [ADR 0001: Soroban Contract Crate Boundaries](0001-soroban-contract-boundaries.md) and [ADR 0001: Contract Architecture](0001-contract-architecture.md)
- **Backlog IDs:** 110 (#1721), 112 (#1723), 113 (#1724)

## Context

When ADR 0001 was written, the crates spanned two SDK generations and it was
unclear whether a shared crate was safe. That split no longer describes the
codebase: the active crates (`contract/`, `contracts/escrow`,
`contracts/creator-earnings` and the `contracts/` workspace) now all pin
`soroban-sdk = "=22.0.0"`, with the `contracts/` workspace declaring it once in
`[workspace.dependencies]`. The two top-level layouts still exist, but only
`contracts/` is actively developed; `contract/`, `contract/reward-token/` and
`contract/carbon-offset` are the legacy surface and are being retired (see
[Legacy contract deprecation](#legacy-contract-deprecation)).

The `contracts/fm-math/` package was reserved as the home for shared pure math
helpers but is currently empty: `compute_fee` is still copied into each crate.
A shared crate is therefore a future decision, not a current fact. The fee cap
likewise had two values (10% in `contracts/escrow`, 5% in `contract/`), while
the backend's fee preview used an environment variable instead of chain state.

## Decision

1. **Single SDK version.** All contract crates pin `soroban-sdk = "=22.0.0"`
   exactly; `contracts/` declares it in `[workspace.dependencies]` so it cannot
   drift between workspace members.
2. **One fee cap: 500 bps (5%).** This is the product-facing maximum platform
   fee. Both escrow implementations use `MAX_FEE_BPS = 500`; `initialize` and
   admin fee updates reject larger values with a dedicated `InvalidFeeBps`
   error. The backend reads the deployed contract's `get_config().fee_bps`
   (cached) so `/api/orders/fee-preview` matches the chain.
3. **Shared crate deferred.** `contracts/fm-math/` stays reserved but empty
   until the fee helper is actually moved there. Until then each crate keeps a
   tested local copy; this ADR, not the superseded ADR 0001, is the reference
   for that convention.
4. **Legacy contract deprecation.** `contract/` and its sibling legacy crates
   are frozen and no longer a target for features. See below.

## Legacy contract deprecation

The legacy `contract/` escrow, `contract/reward-token/` and
`contract/carbon-offset/` are retained only for compatibility work. Removal is
planned for the **v2.0 release (target 2026-12-31)**, after the backend
integration harness and Futurenet E2E have moved to `contracts/escrow`. The
backend's legacy ABI path is gated behind `ENABLE_LEGACY_ESCROW_ABI` (default
off). See [contract/README.md](../../contract/README.md) for the consumer
inventory.

## Consequences

- One SDK generation across all crates, so CI can use a single toolchain and
  cache layout while still building each crate separately.
- One documented fee number for farmers, the backend and both contracts.
- The legacy ABI remains callable only by explicit opt-in and disappears at
  the v2.0 milestone.
- Moving `compute_fee` into `fm-math` remains a separate, deliberate change.
