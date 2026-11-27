# Soroban Contract Security Audit Checklist

Pre-mainnet gate (see the `STELLAR_MAINNET_CONFIRMED` check in `backend/src/utils/stellar-config.js`)
and scope document for the external audit. Covers **every** deployable contract:

| Crate | Path | SDK | Purpose |
|---|---|---|---|
| `escrow` (legacy) | `contract/src/lib.rs` | 21.x | Role-based escrow with pause / unpause votes |
| `reward-token` | `contract/reward-token/src/lib.rs` | 21.x | FRT token: minting, vesting, redemption, transfer fee |
| `carbon-offset` | `contract/carbon-offset/src/lib.rs` | 21.x | Verifier-approved carbon offset certificates |
| `soroban-escrow` | `contracts/escrow/src/lib.rs` (+ `stream.rs`) | 23.0.0 | Order escrow: disputes, evidence, streams, coop multisig, migration, reward minting |
| `creator-earnings` | `contracts/creator-earnings/src/lib.rs` | 23.0.0 | Creator balance ledger, credit/claim, pause |
| `test-utils` | `contracts/test-utils` | 23.0.0 | Test-only helpers; not deployed, out of audit scope |

Complements the dependency audit in [`SECURITY-AUDIT.md`](../docs/implementation-notes/SECURITY-AUDIT.md).

## 0. Threat model

### Roles

| Role | Contracts | Capabilities | Trust assumption | Impact of key compromise |
|---|---|---|---|---|
| **Buyer** | escrow (both), reward-token | Deposit, release own escrow, open dispute, submit evidence, redeem FRT | Untrusted; may act adversarially against the farmer | Loses own escrowed funds / FRT; can release or dispute only their own escrows |
| **Farmer** | escrow (both) | Receive payouts, submit evidence, request timeout/auto-release | Untrusted; may act adversarially against the buyer | Payouts redirected only where a farmer-controlled call chooses the recipient; cannot touch other escrows |
| **Admin / platform** | all | `initialize`, fee/min-deposit/auto-release/reward config, `resolve_dispute`, `set_coop`, `pause`, `upgrade`, admin transfer | Trusted, should be a multisig account | **Critical.** Can upgrade WASM (arbitrary code → drain every escrow and balance), resolve any dispute to any party, change fees to the max (`MAX_FEE_BPS`), redirect fee destination |
| **Minter** | reward-token | `mint`, `mint_for_order` | Trusted; normally the escrow contract address | Unbounded FRT inflation up to `max_supply` (uncapped when 0); dilutes holders, enables redemption abuse |
| **Verifier** | carbon-offset | Authorises a specific `(order_id, kg_co2)` before admin records it | Semi-trusted third party | Can co-sign false offsets, but still needs admin to record them |
| **Coop member** | contracts/escrow | Signs `multisig_release` payloads | Semi-trusted; threshold of members must collude | Threshold-many compromised keys can release any escrow of that cooperative; payload replay limits are CT-05 |
| **Authorised caller** | creator-earnings | `credit` / `batch_credit` (normally the escrow contract) | Trusted contract | Arbitrary credited balances → platform funds drained via `claim`; caller-supplied `fee_bps` (CT-07) |

### Trust assumptions

- Token contracts are standard Stellar Asset Contracts (SAC); non-standard tokens with transfer hooks are out of scope (see §4 reentrancy).
- Admin keys are held in a multisig / HSM; a single-key admin is a deployment finding, not a contract finding.
- Ledger timestamps are trusted for auto-release / timeout windows (validators can skew by seconds, not days).
- Persistent storage TTL is maintained by the backend; see CT-08 for lifetimes exceeding TTL.

## Known issues (must be fixed or accepted before audit)

| ID | Issue | Contract |
|---|---|---|
| CT-01 | [#1520](https://github.com/zeekman/FarmersMarketplace/issues/1520) `contracts/escrow` does not compile — duplicate `EscrowError` variants/discriminants | contracts/escrow |
| CT-02 | [#1521](https://github.com/zeekman/FarmersMarketplace/issues/1521) `deposit()` transfers buyer tokens three times and indexes twice | contracts/escrow |
| CT-03 | [#1522](https://github.com/zeekman/FarmersMarketplace/issues/1522) Truncated/duplicated signatures: `resolve_dispute`, `set_coop`, `multisig_release` | contracts/escrow |
| CT-04 | [#1523](https://github.com/zeekman/FarmersMarketplace/issues/1523) `multisig_release` signature counting vs `ed25519_verify` abort semantics | contracts/escrow |
| CT-05 | [#1524](https://github.com/zeekman/FarmersMarketplace/issues/1524) Multisig payload does not bind action and network | contracts/escrow |
| CT-06 | [#1525](https://github.com/zeekman/FarmersMarketplace/issues/1525) `claim` accepts any token but balances aren't per-token | creator-earnings |
| CT-07 | [#1526](https://github.com/zeekman/FarmersMarketplace/issues/1526) `credit` takes `fee_bps` from the caller | creator-earnings |
| CT-08 | [#1527](https://github.com/zeekman/FarmersMarketplace/issues/1527) Persistent TTL (≈5.8–11.6 days) shorter than possible escrow lifetimes | contracts/escrow |

Additional findings from this pass:

- `reward-token::initialize` has **no `require_auth`** — the first caller after deploy chooses admin and minter. Deploy and initialise in the same transaction, or add `admin.require_auth()`.
- `contracts/escrow::multisig_release` has no `require_auth` by design; its only protection is the signature threshold (see CT-04/CT-05 and the coop section below).

## Public function inventory

Generated from the `#[contractimpl]` blocks. Columns:
**Auth** — addresses on which `require_auth()` is called (or an admin helper);
**State** — whether storage is written;
**Token movement** — token `transfer`/`mint`/`burn` or cross-contract invoke;
**Events** — publishes events;
**Error cases** — typed errors returned (`panics` = `panic!`/`expect`/`unwrap` paths);
**Tests** — ✅ the function is called from the crate's tests, ❌ no direct test (coverage gap to close before audit).
Rows marked **none — review** mutate state without `require_auth` and must be justified.
Re-generate whenever a contract's public API changes.

### `contract (legacy escrow)` — `contract/src/lib.rs`

| Function | Auth | State | Token movement | Events | Error cases | Tests |
|---|---|---|---|---|---|---|
| [`initialize`](src/lib.rs#L187) | `admin` | writes | — | — | AlreadyInitialized, InvalidFeeRate | ✅ |
| [`set_fee_rate`](src/lib.rs#L220) | `admin` | writes | — | yes | InvalidFeeRate | ✅ |
| [`upgrade`](src/lib.rs#L253) | `admin` | writes | — | — | — | ✅ |
| [`pause`](src/lib.rs#L266) | `admin` | writes | — | yes | — | ✅ |
| [`unpause`](src/lib.rs#L286) | `caller` | writes | — | yes | Unauthorized | ✅ |
| [`deposit`](src/lib.rs#L334) | `buyer` | writes | — | yes | AlreadyExists, InvalidAmount, InvalidParties, panics | ✅ |
| [`release`](src/lib.rs#L390) | `record.buyer` | writes | — | yes | AlreadySettled, SnapshotNotFound | ✅ |
| [`refund`](src/lib.rs#L439) | `record.buyer` | writes | — | yes | AlreadySettled, InvalidAmount, NotTimedOut | ✅ |
| [`open_dispute`](src/lib.rs#L490) | `caller` | writes | — | yes | AlreadySettled, Unauthorized | ✅ |
| [`resolve_dispute`](src/lib.rs#L530) | `caller` | writes | — | yes | AlreadySettled, Unauthorized | ✅ |
| [`grant_role`](src/lib.rs#L589) | `caller` | writes | — | — | panics | ✅ |
| [`revoke_role`](src/lib.rs#L635) | `caller` | writes | — | — | panics | ✅ |
| [`get_role_members`](src/lib.rs#L665) | none (view) | read-only | — | — | — | ❌ |
| [`has_role`](src/lib.rs#L674) | none (view) | read-only | — | — | — | ✅ |
| [`get_escrow`](src/lib.rs#L680) | none (view) | read-only | — | — | — | ✅ |
| [`refunded_amount`](src/lib.rs#L690) | none (view) | read-only | — | — | NotFound | ✅ |
| [`is_paused`](src/lib.rs#L702) | none (view) | read-only | — | — | — | ✅ |
| [`get_config`](src/lib.rs#L710) | none (view) | read-only | — | — | — | ❌ |
| [`version`](src/lib.rs#L722) | none (view) | read-only | — | — | — | ❌ |

### `contract/reward-token` — `contract/reward-token/src/lib.rs`

| Function | Auth | State | Token movement | Events | Error cases | Tests |
|---|---|---|---|---|---|---|
| [`initialize`](reward-token/src/lib.rs#L123) | **none — review** | writes | — | — | panics | ✅ |
| [`set_transfer_fee`](reward-token/src/lib.rs#L229) | `admin` | writes | — | yes | panics | ✅ |
| [`transfer_fee_bps`](reward-token/src/lib.rs#L240) | none (view) | read-only | — | — | — | ✅ |
| [`set_reward_rate`](reward-token/src/lib.rs#L245) | `admin` | writes | — | yes | panics | ✅ |
| [`reward_rate_bps`](reward-token/src/lib.rs#L253) | none (view) | read-only | — | — | — | ✅ |
| [`mint_for_order`](reward-token/src/lib.rs#L269) | `minter` | read-only | — | — | panics | ✅ |
| [`mint`](reward-token/src/lib.rs#L286) | `minter` | writes | yes | yes | panics | ✅ |
| [`set_vesting_period`](reward-token/src/lib.rs#L352) | `admin` | writes | — | yes | panics | ✅ |
| [`vesting_period`](reward-token/src/lib.rs#L360) | none (view) | read-only | — | — | — | ❌ |
| [`vested_balance`](reward-token/src/lib.rs#L421) | none (view) | read-only | — | — | — | ✅ |
| [`burn`](reward-token/src/lib.rs#L441) | `from` | read-only | — | yes | panics | ✅ |
| [`burn_reward`](reward-token/src/lib.rs#L460) | `admin` | read-only | — | yes | panics | ✅ |
| [`set_max_redemption_bps`](reward-token/src/lib.rs#L476) | `admin` | writes | — | yes | panics | ❌ |
| [`max_redemption_bps`](reward-token/src/lib.rs#L487) | none (view) | read-only | — | — | — | ❌ |
| [`redeem`](reward-token/src/lib.rs#L501) | `buyer` | writes | — | yes | panics | ✅ |
| [`reissue_redeemed`](reward-token/src/lib.rs#L539) | `admin` | writes | — | yes | panics | ✅ |
| [`burn_from`](reward-token/src/lib.rs#L576) | `spender` | writes | — | yes | panics | ✅ |
| [`transfer`](reward-token/src/lib.rs#L609) | `from` | writes | — | yes | panics | ✅ |
| [`transfer_from`](reward-token/src/lib.rs#L638) | `spender` | writes | — | yes | panics | ✅ |
| [`transfer_vested`](reward-token/src/lib.rs#L686) | `from` | read-only | — | yes | panics | ❌ |
| [`update_metadata`](reward-token/src/lib.rs#L714) | `admin` | writes | — | yes | panics | ✅ |
| [`approve`](reward-token/src/lib.rs#L728) | `from` | writes | — | yes | panics | ✅ |
| [`allowance`](reward-token/src/lib.rs#L748) | none (view) | read-only | — | — | — | ✅ |
| [`balance`](reward-token/src/lib.rs#L757) | none (view) | read-only | — | — | — | ✅ |
| [`total_supply`](reward-token/src/lib.rs#L761) | none (view) | read-only | — | — | — | ✅ |
| [`decimals`](reward-token/src/lib.rs#L765) | none (view) | read-only | — | — | panics | ✅ |
| [`name`](reward-token/src/lib.rs#L770) | none (view) | read-only | — | — | panics | ✅ |
| [`symbol`](reward-token/src/lib.rs#L775) | none (view) | read-only | — | — | panics | ✅ |
| [`max_supply`](reward-token/src/lib.rs#L781) | none (view) | read-only | — | — | — | ✅ |
| [`remaining_supply`](reward-token/src/lib.rs#L787) | none (view) | read-only | — | — | — | ✅ |
| [`set_max_supply`](reward-token/src/lib.rs#L798) | `admin` | writes | — | yes | panics | ✅ |
| [`set_minter`](reward-token/src/lib.rs#L814) | `admin` | writes | — | yes | panics | ✅ |
| [`propose_admin`](reward-token/src/lib.rs#L821) | `admin` | writes | — | — | panics | ✅ |
| [`accept_admin`](reward-token/src/lib.rs#L827) | `pending` | writes | — | — | panics | ✅ |
| [`get_config`](reward-token/src/lib.rs#L836) | none (view) | read-only | — | — | — | ❌ |
| [`version`](reward-token/src/lib.rs#L852) | none (view) | read-only | — | — | — | ❌ |

### `contract/carbon-offset` — `contract/carbon-offset/src/lib.rs`

| Function | Auth | State | Token movement | Events | Error cases | Tests |
|---|---|---|---|---|---|---|
| [`initialize`](carbon-offset/src/lib.rs#L81) | `admin` | writes | — | — | panics | ✅ |
| [`authorize_offset`](carbon-offset/src/lib.rs#L91) | `verifier` | writes | — | yes | — | ✅ |
| [`record_offset`](carbon-offset/src/lib.rs#L114) | `admin` | writes | — | yes | panics | ✅ |
| [`get_offset`](carbon-offset/src/lib.rs#L178) | none (view) | read-only | — | — | — | ✅ |
| [`amend_offset`](carbon-offset/src/lib.rs#L191) | `admin`, `verifier` | writes | — | yes | panics | ✅ |
| [`void_offset`](carbon-offset/src/lib.rs#L226) | `admin` | writes | — | yes | panics | ✅ |
| [`propose_admin`](carbon-offset/src/lib.rs#L253) | `admin` | writes | — | yes | panics | ❌ |
| [`accept_admin`](carbon-offset/src/lib.rs#L270) | `pending` | writes | — | yes | panics | ❌ |
| [`upgrade`](carbon-offset/src/lib.rs#L288) | `admin` | writes | — | yes | panics | ✅ |
| [`get_config`](carbon-offset/src/lib.rs#L311) | none (view) | read-only | — | — | — | ❌ |
| [`version`](carbon-offset/src/lib.rs#L321) | none (view) | read-only | — | — | — | ❌ |

### `contracts/escrow` — `contracts/escrow/src/lib.rs`

| Function | Auth | State | Token movement | Events | Error cases | Tests |
|---|---|---|---|---|---|---|
| [`initialize`](../contracts/escrow/src/lib.rs#L318) | `admin` | writes | — | — | AlreadyInitialized, InvalidAmount | ✅ |
| [`init`](../contracts/escrow/src/lib.rs#L352) | `admin_transfer.current_admin` | writes | — | — | — | ❌ |
| [`set_reward_token`](../contracts/escrow/src/lib.rs#L367) | `admin_transfer.current_admin` | writes | — | yes | — | ✅ |
| [`deposit`](../contracts/escrow/src/lib.rs#L448) | `buyer` | writes | yes | yes | — | ✅ |
| [`batch_deposit`](../contracts/escrow/src/lib.rs#L597) | `buyer` | writes | yes | — | AlreadyExists, BatchTooLarge, InvalidAmount | ✅ |
| [`release`](../contracts/escrow/src/lib.rs#L692) | `caller` | read-only | — | — | Unauthorized | ✅ |
| [`release_to_stream`](../contracts/escrow/src/lib.rs#L972) | `escrow.buyer` | writes | yes | yes | AlreadySettled, InDispute, InvalidAmount, InvalidToken, NotYetReleasable | ✅ |
| [`set_admin`](../contracts/escrow/src/lib.rs#L1124) | `existing_admin.current_admin` | writes | — | — | — | ❌ |
| [`set_min_deposit`](../contracts/escrow/src/lib.rs#L1142) | `admin_transfer.current_admin` | writes | — | yes | InvalidAmount | ❌ |
| [`get_min_deposit`](../contracts/escrow/src/lib.rs#L1161) | none (view) | read-only | — | — | — | ❌ |
| [`set_reward_bps`](../contracts/escrow/src/lib.rs#L1170) | `admin_transfer.current_admin` | writes | — | yes | InvalidAmount | ❌ |
| [`get_reward_bps`](../contracts/escrow/src/lib.rs#L1197) | none (view) | read-only | — | — | — | ❌ |
| [`batch_release`](../contracts/escrow/src/lib.rs#L1215) | `platform` | read-only | — | yes | BatchTooLarge | ✅ |
| [`take_snapshot`](../contracts/escrow/src/lib.rs#L1340) | `caller` | read-only | — | — | Unauthorized | ❌ |
| [`get_snapshot`](../contracts/escrow/src/lib.rs#L1367) | none (view) | read-only | — | — | — | ❌ |
| [`refund`](../contracts/escrow/src/lib.rs#L1382) | none (view) | read-only | — | — | — | ✅ |
| [`claim_timeout_refund`](../contracts/escrow/src/lib.rs#L1391) | none (view) | read-only | — | — | — | ✅ |
| [`set_auto_release_days`](../contracts/escrow/src/lib.rs#L1463) | `admin_transfer.current_admin` | writes | — | yes | — | ❌ |
| [`auto_release`](../contracts/escrow/src/lib.rs#L1483) | none (view) | read-only | — | yes | AlreadySettled, AutoReleaseNotReached, InDispute | ✅ |
| [`submit_evidence`](../contracts/escrow/src/lib.rs#L1523) | `caller` | writes | — | yes | EvidenceLimitReached, NotDisputed, SubmissionWindowClosed, Unauthorized | ❌ |
| [`get_evidence`](../contracts/escrow/src/lib.rs#L1599) | none (view) | read-only | — | — | — | ❌ |
| [`dispute`](../contracts/escrow/src/lib.rs#L1622) | `caller` | writes | — | yes | AlreadySettled, InDispute, Unauthorized | ✅ |
| [`resolve_dispute`](../contracts/escrow/src/lib.rs#L1665) | none (view) | read-only | — | — | — | ✅ |
| [`resolve_dispute`](../contracts/escrow/src/lib.rs#L1687) | `admin_transfer.current_admin` | writes | yes | yes | InvalidAmount, InvalidToken, NotDisputed, NotInDispute | ✅ |
| [`propose_admin`](../contracts/escrow/src/lib.rs#L1766) | `transfer.current_admin` | writes | — | yes | — | ❌ |
| [`accept_admin`](../contracts/escrow/src/lib.rs#L1780) | `pending` | writes | — | yes | — | ❌ |
| [`upgrade`](../contracts/escrow/src/lib.rs#L1800) | `transfer.current_admin` | writes | — | yes | InvalidWasmHash | ❌ |
| [`get`](../contracts/escrow/src/lib.rs#L1818) | none (view) | read-only | — | — | — | ✅ |
| [`get_escrow`](../contracts/escrow/src/lib.rs#L1827) | none (view) | read-only | — | — | — | ❌ |
| [`is_settled`](../contracts/escrow/src/lib.rs#L1834) | none (view) | read-only | — | — | — | ❌ |
| [`get_buyer_escrows`](../contracts/escrow/src/lib.rs#L1851) | none (view) | read-only | — | — | panics | ✅ |
| [`get_farmer_escrows`](../contracts/escrow/src/lib.rs#L1887) | none (view) | read-only | — | — | panics | ✅ |
| [`migrate_preview`](../contracts/escrow/src/lib.rs#L1959) | none (view) | read-only | — | — | — | ❌ |
| [`migrate`](../contracts/escrow/src/lib.rs#L1974) | `transfer.current_admin` | writes | — | yes | MigrationFailed | ❌ |
| [`set_coop`](../contracts/escrow/src/lib.rs#L2064) | none (view) | read-only | — | — | — | ✅ |
| [`set_coop`](../contracts/escrow/src/lib.rs#L2070) | `transfer.current_admin` | writes | — | — | InvalidAmount, InvalidCoopConfig, TooManyCoopSigners | ✅ |
| [`multisig_release`](../contracts/escrow/src/lib.rs#L2129) | **none — review** | writes | yes | yes | AlreadySettled, InDispute, InvalidCoopConfig, InvalidToken, NotEnoughSignatures … | ✅ |
| [`get_config`](../contracts/escrow/src/lib.rs#L2302) | none (view) | read-only | — | — | — | ❌ |
| [`version`](../contracts/escrow/src/lib.rs#L2324) | none (view) | read-only | — | — | — | ❌ |

### `contracts/creator-earnings` — `contracts/creator-earnings/src/lib.rs`

| Function | Auth | State | Token movement | Events | Error cases | Tests |
|---|---|---|---|---|---|---|
| [`init`](../contracts/creator-earnings/src/lib.rs#L136) | `current_platform` | writes | — | — | panics | ✅ |
| [`set_authorized_caller`](../contracts/creator-earnings/src/lib.rs#L155) | `platform` | writes | — | — | — | ❌ |
| [`set_paused`](../contracts/creator-earnings/src/lib.rs#L171) | `platform` | writes | — | — | — | ✅ |
| [`credit`](../contracts/creator-earnings/src/lib.rs#L189) | `authorized_caller` | writes | — | yes | CreatorIsPlatform, InvalidAmount, InvalidFeeBps, Paused | ✅ |
| [`batch_credit`](../contracts/creator-earnings/src/lib.rs#L265) | none (view) | read-only | — | yes | BatchTooLarge | ✅ |
| [`claim`](../contracts/creator-earnings/src/lib.rs#L296) | `creator` | writes | yes | yes | Paused, ZeroBalance | ✅ |
| [`balance`](../contracts/creator-earnings/src/lib.rs#L340) | none (view) | read-only | — | — | — | ✅ |
| [`lifetime_earned`](../contracts/creator-earnings/src/lib.rs#L350) | none (view) | read-only | — | — | — | ✅ |
| [`platform_balance`](../contracts/creator-earnings/src/lib.rs#L358) | none (view) | read-only | — | — | — | ✅ |
| [`platform`](../contracts/creator-earnings/src/lib.rs#L371) | none (view) | read-only | — | — | — | ✅ |
| [`upgrade`](../contracts/creator-earnings/src/lib.rs#L381) | `platform` | writes | — | yes | InvalidWasmHash | ✅ |
| [`get_config`](../contracts/creator-earnings/src/lib.rs#L406) | none (view) | read-only | — | — | — | ❌ |
| [`version`](../contracts/creator-earnings/src/lib.rs#L417) | none (view) | read-only | — | — | — | ❌ |


## Coverage

Required before handing to auditors: **≥ 90 % line coverage** for `contracts/escrow` and `contracts/creator-earnings`.

```sh
cargo install cargo-llvm-cov
cd contracts
cargo llvm-cov -p soroban-escrow --lib --html --output-dir ../coverage/escrow
cargo llvm-cov -p creator-earnings --features testutils --html --output-dir ../coverage/creator-earnings
cargo llvm-cov -p soroban-escrow -p creator-earnings --features creator-earnings/testutils --lcov --output-path ../coverage/lcov.info
```

Attach `coverage/lcov.info` and the HTML reports to the audit package. Coverage cannot be measured until CT-01–CT-03 are fixed
(the escrow crate does not compile); record the measured figures here once they are:

| Crate | Line coverage | Target | Status |
|---|---|---|---|
| contracts/escrow | _pending CT-01–CT-03_ | ≥ 90 % | ☐ |
| contracts/creator-earnings | _to be measured_ | ≥ 90 % | ☐ |

---

# Historical findings (pre-`contracts/` workspace audit pass)

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
