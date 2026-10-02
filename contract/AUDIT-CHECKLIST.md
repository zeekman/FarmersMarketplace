# Soroban Contract Security Audit Checklist

Pre-mainnet gate for the marketplace's Soroban contracts. Covers `contract/src/lib.rs`
(freelancer-style singleton escrow), `contracts/escrow/src/lib.rs` (order-keyed
marketplace escrow), `contract/reward-token/src/lib.rs` (FRT token), and
`contract/carbon-offset/src/lib.rs` (carbon offset certificates).

Complements the dependency audit in [`SECURITY-AUDIT.md`](../docs/implementation-notes/SECURITY-AUDIT.md), which
covers `npm audit` findings only, not contract logic.

## 1. Integer overflow / underflow

| Check | Status | Notes |
|---|---|---|
| Fee arithmetic (`amount * fee_bps / 10000`) uses `checked_mul`/`checked_div` | N/A | No fee-splitting arithmetic exists in either escrow contract today — `deposit`/`create` transfer the full `amount` with no platform cut computed on-chain. If a fee split is added later, it **must** use `checked_mul`/`checked_div` (or `i128::checked_*`) and reject on `None`, since both contracts build with `overflow-checks = true` (`contract/Cargo.toml`, `contracts/escrow/Cargo.toml`) which only makes debug/test builds panic on overflow — release Wasm still wraps unless checked ops are used explicitly. |
| Reward token balance math (`balance + amount`, `from_balance - amount`) | PASS | `contract/reward-token/src/lib.rs:46,68,76,79` — amounts are validated `> 0` and transfers check `from_balance < amount` before subtracting, so underflow can't be reached via the public API. No multiplication is performed. |
| Carbon offset `kg_co2: u64` | PASS | Stored as-is, no arithmetic performed on it in `contract/carbon-offset/src/lib.rs`. |

## 2. Auth required on all state-changing functions

| Function | Status | Notes |
|---|---|---|
| `contracts/escrow::deposit` | PASS | `buyer.require_auth()` — `contracts/escrow/src/lib.rs:51` |
| `contracts/escrow::release` | PASS | `escrow.buyer.require_auth()` — `contracts/escrow/src/lib.rs:95` |
| `contracts/escrow::refund` | PASS | `escrow.buyer.require_auth()` — `contracts/escrow/src/lib.rs:122` |
| `contracts/escrow::dispute` | PASS | `caller.require_auth()` — `contracts/escrow/src/lib.rs:140` |
| `contract::create` | PASS | `payer.require_auth()` — `contract/src/lib.rs:46` |
| `contract::submit_work` | PASS | `data.freelancer.require_auth()` — `contract/src/lib.rs:83` |
| `contract::approve` | PASS | `data.payer.require_auth()` — `contract/src/lib.rs:106` |
| `contract::cancel` | PASS | `data.payer.require_auth()` — `contract/src/lib.rs:136` |
| `contract::expire` | PASS | `data.payer.require_auth()` — `contract/src/lib.rs:166` |
| `reward-token::mint` | PASS | stored `minter.require_auth()` — `contract/reward-token/src/lib.rs` |
| `reward-token::transfer` | PASS | `from.require_auth()` — `contract/reward-token/src/lib.rs:61` |
| `carbon-offset::record_offset` | PASS | stored admin requires auth, and the named verifier must first authorize the exact order/amount — `contract/carbon-offset/src/lib.rs` |
| `grant_role` / `upgrade` / `pause` / `set_fee_rate` | N/A | None of these functions exist in the current contracts. If access control roles, upgradability, pausability, or a configurable fee rate are added later, each must gate on a stored admin/role address with `require_auth()` before this checklist item can be marked PASS. |

## 3. TTL expiry risk

| Contract | Status (before fix) | Fix applied |
|---|---|---|
| `contracts/escrow` | **FAIL** — persistent storage entries (`DataKey::Escrow(order_id)`) were never bumped after the initial write; a long-lived escrow (e.g. a preorder with a distant deadline) could be archived before `release`/`refund`/`dispute` is called, making the entry unreadable. | Added `env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT)` after every write in `deposit`, `release`, `refund`, `dispute` — `contracts/escrow/src/lib.rs`. |
| `contract` (freelancer escrow) | **FAIL** — same issue on instance storage. | Added `env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT)` after every write in `create`, `submit_work`, `approve`, `cancel`, `expire` — `contract/src/lib.rs`. |
| `contract/carbon-offset` | PASS | Offset, verifier-approval, void marker, and instance storage TTLs are refreshed after writes — `contract/carbon-offset/src/lib.rs`. |
| `reward-token` | PASS | Balance entries now use a shared write helper that extends persistent TTL on every balance change — `contract/reward-token/src/lib.rs`. |

## 4. Reentrancy via cross-contract calls

Neither contract uses `try_call`/`try_invoke` (which would swallow a callee panic and
let execution continue with stale assumptions); both use the token client's plain
`transfer`, which propagates a callee panic and aborts the whole transaction. The real
risk here is **state-after-interaction**: if the token contract itself makes an
external call back into this contract during `transfer` (e.g. a non-standard/malicious
token implementing a transfer hook), a reentrant call could read pre-transfer state and
double-spend the escrow before the original call's storage write lands.

| Contract | Status (before fix) | Fix applied |
|---|---|---|
| `contracts/escrow::deposit` | **FAIL** — `has(&key)` was checked, then the transfer ran, then the record was written; a reentrant `deposit()` for the same `order_id` during the transfer would pass the `has()` check twice. | Storage write + TTL bump now happen **before** the token transfer — `contracts/escrow/src/lib.rs`. |
| `contracts/escrow::release` / `refund` | **FAIL** — `released`/`refunded` flags were set *after* the transfer; a reentrant call during the transfer would still see `released == false` and could double-release. | Flags are now set and persisted **before** the transfer — `contracts/escrow/src/lib.rs`. |
| `contract::create` / `approve` / `cancel` / `expire` | **FAIL** — same pattern (status set after transfer). | Status is now set and persisted **before** the transfer in all four functions — `contract/src/lib.rs`. |
| `contract::submit_work` | PASS | No external call in this function. |
| `carbon-offset::record_offset` | PASS | No external call in this function. |

## 5. Storage key collisions

| Contract | Status | Notes |
|---|---|---|
| `contracts/escrow` | PASS | Keyed by `DataKey::Escrow(order_id)` — one entry per order, no collision across orders. |
| `contract` (freelancer escrow) | PASS | Single `symbol_short!("escrow")` instance key — by design, one escrow per deployed contract instance, so there is nothing else in instance storage to collide with. |
| `reward-token` | PASS | `ADMIN`/`METADATA` are instance keys; `(BALANCE, address)` tuple keys are persistent — distinct namespaces, no overlap. |
| `carbon-offset` | PASS | Offset, verification, and void status use distinct `DataKey` variants; `ADMIN` and `PENDING_ADMIN` are instance symbols. |

## Summary

All FAIL items directly in escrow-contract scope (`contract/src/lib.rs`,
`contracts/escrow/src/lib.rs`) were remediated in this pass: checks-effects-interactions
ordering fixed in every state-changing function, and TTL bumps added to every write.
The reward-token TTL gap is logged as a known follow-up (not an escrow contract, out of
scope for this issue's remediation). Fee-arithmetic and role/pause/upgrade auth items
are marked N/A because those features don't exist yet — this checklist should be
re-run against them before they ship.

## Cooperative multisig invariants (`contracts/escrow`, #1296–#1298)

- `set_coop(coop, members, threshold)` **must** enforce `1 <= threshold <= members.len()` and reject
  duplicate member keys (`InvalidCoopConfig`). `multisig_release` has no `require_auth`; the
  signature count is its only protection, so a zero threshold would let anyone release any escrow.
  `multisig_release` re-checks `threshold != 0` to guard against legacy stored configs.
- Config is keyed per cooperative (`DataKey::CoopConfig(Address)`) and `multisig_release` loads the
  config for `escrow.cooperative_address`; escrows without a cooperative cannot use it.
- Signed payload: `sha256(contract_address_xdr || order_id_be_u64)` (`Address::to_xdr`, then 8 big-endian
  bytes). Signers (backend/CLI) must build this exact message per deployment.
- Settlement applies the same token check, `release_after_unix` lock, platform fee, cooperative royalty,
  events and buyer rewards as `release()`.
- **Migration:** the old single `DataKey::CoopConfig` entry is no longer read. After upgrading, the admin
  must call `set_coop` once per cooperative address, and signers must re-sign with the new payload.
This checklist now reflects the additional reward-token and carbon-offset hardening:
balance TTL bumps, minter authorization, supply/fee bounds, verifier approval, and
record amendment/void paths. Re-run the checklist when contract behavior changes.
