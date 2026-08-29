# ADR 0001: Soroban Contract Crate Boundaries and Shared Conventions

## Status

Accepted.

## Context

FarmersMarketplace currently has Soroban contracts in two top-level layouts:

- `contract/`: the legacy escrow crate used by the backend integration harness,
  Futurenet E2E script, CLI helper, and legacy WASM size profile.
- `contract/reward-token/`: a legacy-adjacent reward token crate using the same
  `soroban-sdk = 21.0.0` generation as `contract/`.
- `contracts/`: the newer Cargo workspace that contains `contracts/escrow/`
  and `contracts/creator-earnings/`, both using `soroban-sdk = 22.0.0`.

These crates define their own `#[contracterror]` enums, storage key enums, event
topics, admin flows, pause flows, and basis-points arithmetic conventions. That
keeps each contract easy to deploy independently, but it also makes hardening
easy to apply in one crate and forget in another.

## Decision

Both layouts are intentionally maintained for now:

- Keep `contract/` as the legacy escrow surface for backend integration tests,
  Futurenet E2E, and compatibility work.
- Keep `contract/reward-token/` as the reward-token contract paired with the
  legacy integration surface.
- Treat `contracts/` as the current workspace for new Rust-only contract work
  and CI coverage.
- Do not introduce a shared contract crate yet. The current crates span SDK
  versions and deployment boundaries, so a shared crate would create migration
  and release coupling before the interfaces have stabilized.

Until a shared crate is introduced, common hardening must follow a
copy-with-tests-per-crate convention: if a pattern is needed in more than one
contract, copy the small implementation locally and add crate-local tests that
prove the behavior in that contract's SDK/runtime context.

## Shared Pattern Candidates

The following patterns should be kept consistent across crates and are
candidates for a future `contracts/common` crate once the repo converges on one
Soroban SDK generation:

| Pattern | Current examples | Convention |
|---|---|---|
| Two-step admin transfer | `contracts/escrow` uses `AdminTransfer`; `contract/reward-token` has `propose_admin` and `accept_admin` keys | Admin changes should be proposed by the current admin and accepted by the pending admin. Single-step admin replacement should be avoided for new state-changing admin paths. |
| Pause/circuit breaker | `contract/` has pause/unpause coverage | New state-changing entrypoints should define whether they are blocked while paused. Read-only views should remain available. |
| Basis-points arithmetic | `contract/`, `contract/reward-token/`, `contracts/escrow`, and `contracts/creator-earnings` all compute fee rates | Validate the maximum basis-points value before multiplication. Prefer `checked_mul`/`checked_div` or explicit bounded inputs when amounts can approach `i128::MAX`. Add boundary tests for `0`, max allowed bps, over-max bps, and large amount values. |
| Storage keys | Every crate defines a `DataKey`-style enum | Keep key names stable after deployment. Document whether keys are instance, persistent, or temporary storage. Migration code must be idempotent and include preview/dry-run behavior when rewriting existing records. |
| Event topics | Escrow crates emit overlapping topic names with different tuple shapes | Document event topic tuple shapes next to the emitting function. New subscribers should treat legacy `contract/` and workspace `contracts/escrow` events as separate schemas unless an explicit compatibility note says otherwise. |
| WASM size/profile policy | `contract/wasm-profile.sh` covers legacy contracts; workspace contracts are tested through the newer workspace CI path | Each deployable crate should have a release build path, a size budget, and an artifact/report produced by CI. |

## README Contract Documentation Rules

Top-level documentation must not describe `contract/` and `contracts/` as if
they are the same contract.

- Use `contract/` when documenting backend integration tests, Futurenet E2E, or
  legacy CLI workflows.
- Use `contracts/` when documenting workspace Rust tests, current escrow
  hardening work, creator earnings, or workspace WASM profiling.
- Link this ADR from the README whenever contract ownership or shared
  conventions are discussed.

## Consequences

This preserves existing deployment/test workflows while making the split
explicit. The tradeoff is that common logic is still duplicated, but new
duplication must be deliberate and covered by crate-local tests. A future ADR
can replace this convention with a shared crate after the legacy and workspace
contracts converge on one SDK version and release process.
