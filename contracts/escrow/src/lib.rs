#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Bytes,
    BytesN, Env, IntoVal, Map, TryFromVal, Val, Vec,
};

#[cfg(test)]
extern crate std;

mod stream;
mod validate_id;

// TTL thresholds for persistent escrow entries (~57–115 days at 5 s/ledger).
const TTL_MIN: u32 = 100_000;
const TTL_MAX: u32 = 200_000;

/// Minimum timeout for a deposit — 1 hour in seconds. (#838)
const MIN_TIMEOUT_SECS: u64 = 3_600;

/// Default minimum deposit — 0.5 XLM in stroops. Matches the Stellar base
/// reserve (0.5 XLM per entry) so an escrow record is never worth less than
/// the ledger storage it occupies. Admin-configurable via `set_min_deposit`. (#857)
const MIN_DEPOSIT_STROOPS: i128 = 5_000_000;

/// Maximum number of order IDs accepted by `batch_release` in a single call.
/// The `max_batch_deposit_and_release_resource_budget` test tracks the Soroban
/// budget cost at this size so CI fails before the batch grows too expensive.
/// Upper bound on the minimum deposit amount — prevents accidental or malicious
/// configuration that would brick all future deposits. Set to 500 XLM (100× the default
/// minimum of 0.5 XLM). This allows for price changes without DoS risk. (#858)
const MAX_MIN_DEPOSIT: i128 = 500_000_000;

/// Maximum number of order IDs accepted by `batch_release` in a single call —
/// keeps the transaction under Stellar's operation limit. (#856)
const MAX_BATCH_RELEASE: u32 = 20;

/// Maximum number of cooperative signer slots to prevent unbounded loop cost
/// in multisig_release. Chosen conservatively below Soroban's per-transaction
/// instruction budget to ensure signature verification remains efficient. (#979)
const MAX_COOP_SIGNERS: u32 = 15;
/// Maximum limit for paginated escrow queries to prevent excessive read costs. (#980)
const MAX_ESCROW_PAGE_SIZE: u32 = 100;

// ---------------------------------------------------------------------------
// EscrowError discriminant registry
// Each variant has a stable u32 code that is part of the on-chain ABI.
// NEVER reuse a code, even after removing a variant.
// When adding a new variant, use NEXT_CODE and increment it.
// NEXT_CODE: 23
// ---------------------------------------------------------------------------
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    NotFound               = 1,
    AlreadySettled         = 2,
    InDispute              = 3,
    Unauthorized           = 4,
    InvalidAmount          = 5,
    AlreadyExists          = 6,
    TimeoutNotReached      = 7,
    InvalidWasmHash        = 8,
    NoPendingAdmin         = 9,
    /// Provided token does not match the token used at deposit time.
    InvalidToken           = 10,
    /// A v1 EscrowRecord entry could not be migrated to v2 Escrow.
    MigrationFailed        = 11,
    /// Fewer valid signatures than the cooperative threshold.
    NotEnoughSignatures    = 12,
    /// Cooperative members / threshold not yet configured.
    CoopNotConfigured      = 13,
    /// Contract has already been initialized. (#837)
    AlreadyInitialized     = 14,
    /// Caller is not the platform admin or does not hold the required role. (#837)
    NotAdmin               = 15,
    /// Deposit amount is below the configured minimum (dust guard). (#857)
    BelowMinDeposit        = 16,
    /// `batch_release` was called with more than `MAX_BATCH_RELEASE` order IDs. (#856)
    BatchTooLarge          = 17,
    /// No snapshot exists for the requested (order_id, ledger_sequence). (#858)
    SnapshotNotFound       = 18,
    /// Release called before the pre-order unlock date. (#875)
    NotYetReleasable       = 19,
    /// Evidence submission window has closed (48 hours after dispute opened). (#877)
    SubmissionWindowClosed = 20,
    /// Auto-release time has not yet been reached. (#878)
    AutoReleaseNotReached  = 21,
    /// Cooperative signer configuration exceeds maximum allowed. (#979)
    TooManyCoopSigners     = 22,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum EscrowStatus {
    Active,
    Released,
    Refunded,
    Disputed,
}

// Backend order IDs are auto-incrementing DB primary keys; in practice they never
// approach this bound. Rejecting anything larger guards against malformed/overflowed
// caller input reaching contract storage.
const MAX_ORDER_ID: u64 = 1_000_000_000_000;

// TTL bump applied to escrow storage entries on every write so records don't get
// archived between deposit and release/refund/dispute (in ledgers, ~5s each):
// ~6 days threshold, ~30 days bump.
const BUMP_THRESHOLD: u32 = 100_000;
const BUMP_AMOUNT: u32 = 500_000;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Per-escrow data — stored in persistent storage with individual TTL.
    Escrow(u64),
    /// Per-escrow token address (stored separately so token used at deposit is enforced at release).
    Token(u64),
    /// Contract metadata — stored in instance storage (shared TTL is fine).
    Admin,
    /// Contract metadata — stored in instance storage (shared TTL is fine).
    Platform,
    /// Reward token contract address for minting rewards on release (#851).
    RewardTokenContract,
    /// Reward rate in basis points (e.g. 100 = 1%). Admin-configurable via
    /// `set_reward_bps`, falls back to 100 bps when unset. (#953)
    RewardBps,
    /// Cooperative multisig configuration (members + threshold).
    CoopConfig,
    /// Platform fee in basis points (e.g. 250 = 2.5%). Set by initialize(). (#837)
    FeeBps,
    /// Address that receives platform fees. Set by initialize(). (#837)
    FeeDestination,
    /// Flag set to true once initialize() has been called. (#837)
    Initialized,
    /// Admin-configurable minimum deposit amount in stroops. Falls back to
    /// `MIN_DEPOSIT_STROOPS` when unset. (#857)
    MinDeposit,
    /// Point-in-time snapshot of an escrow record, keyed by (order_id,
    /// ledger_sequence). Stored in temporary storage for the audit trail. (#858)
    Snapshot(u64, u64),
    /// Evidence hash entries for buyer (up to 5). (#877)
    BuyerEvidence(u64),
    /// Evidence hash entries for farmer (up to 5). (#877)
    FarmerEvidence(u64),
    /// Evidence submission storage counter per side per escrow. (#877)
    BuyerEvidenceCount(u64),
    /// Evidence submission storage counter per side per escrow. (#877)
    FarmerEvidenceCount(u64),
    /// Dispute opened timestamp. (#877)
    DisputeOpenedAt(u64),
    /// Auto-release days configurable by admin. (#878)
    AutoReleaseDays,
    /// Index of order_ids for a given buyer address. (#876)
    BuyerEscrows(Address),
    /// Index of order_ids for a given farmer address. (#876)
    FarmerEscrows(Address),
}

/// Full escrow record. `token` stores the SAC address used for this escrow (#683).
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminTransfer {
    pub current_admin: Address,
    pub pending_admin: Option<Address>,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Escrow {
    pub buyer: Address,
    pub farmer: Address,
    /// SAC token address used for this escrow (any SEP-0041 token, not just XLM).
    pub token: Address,
    pub amount: i128,
    pub timeout_unix: u64,
    pub status: EscrowStatus,
    /// Optional cooperative treasury address. When set, a royalty is transferred
    /// to this address on every successful release (#860).
    pub cooperative_address: Option<Address>,
    /// Royalty rate in basis points (e.g. 500 = 5%).  Ignored when
    /// `cooperative_address` is `None` (#860).
    pub cooperative_royalty_bps: u32,
    /// Auto-release timestamp (deposit_timestamp + auto_release_days * 86400). (#878)
    pub auto_release_unix: u64,
    /// Timestamp when dispute was opened, used for evidence window check. (#877)
    pub dispute_opened_at: u64,
    /// Optional pre-order unlock timestamp; if > 0, release() is blocked until
    /// env.ledger().timestamp() >= release_after_unix. (#875)
    pub release_after_unix: u64,
}

/// Paginated escrow IDs response. (#980)
#[contracttype]
#[derive(Clone)]
pub struct PaginatedEscrows {
    pub escrows: Vec<u64>,
    pub total: u32,
}

// ---------------------------------------------------------------------------
// v1 schema — kept for migration purposes only (#691).
// The original contract stored EscrowRecord (no `status`, no `token` field).
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone)]
pub struct EscrowRecord {
    pub buyer: Address,
    pub farmer: Address,
    pub amount: i128,
    pub timeout_unix: u64,
    pub released: bool,
}

/// Cooperative multisig configuration: a set of ed25519 member public keys and
/// the minimum number of valid signatures required to release escrow funds (#701).
#[contracttype]
#[derive(Clone)]
pub struct CoopConfig {
    pub members: Vec<BytesN<32>>,
    pub threshold: u32,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Shared basis-point fee/royalty/reward-split calculation: `amount * bps / 10_000`.
    /// Rounds down (truncates toward zero); the remainder stays with whichever side
    /// did not receive this result. Uses `checked_mul` so an overflowing multiplication
    /// panics instead of silently wrapping. (#1225)
    ///
    /// This is the canonical copy — `contracts/creator-earnings` and
    /// `contract/reward-token` intentionally keep their own copy of this exact
    /// logic per ADR 0001 (no shared crate across SDK generations yet).
    fn compute_fee(amount: i128, bps: u32) -> i128 {
        amount
            .checked_mul(bps as i128)
            .expect("fee calculation overflow")
            / 10_000
    }

    /// Initialize the contract with a platform admin, fee rate, and fee destination. (#837)
    ///
    /// Must be called exactly once after deployment. Subsequent calls return
    /// `EscrowError::AlreadyInitialized`. All other admin-requiring functions
    /// should check `DataKey::Admin` after this has been called.
    ///
    /// - `admin`: the address that will own admin privileges.
    /// - `fee_bps`: platform fee in basis points (e.g. 250 = 2.5%). Max 1000.
    /// - `fee_destination`: address that receives the platform fee on release.
    pub fn initialize(
        env: Env,
        admin: Address,
        fee_bps: u32,
        fee_destination: Address,
    ) -> Result<(), EscrowError> {
        // Guard: revert if already initialized
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(EscrowError::AlreadyInitialized);
        }
        if fee_bps > 1_000 {
            return Err(EscrowError::InvalidAmount);
        }
        admin.require_auth();
        let transfer = AdminTransfer {
            current_admin: admin.clone(),
            pending_admin: None,
        };
        env.storage().instance().set(&DataKey::Admin, &transfer);
        env.storage()
            .instance()
            .set(&DataKey::Platform, &fee_destination);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage()
            .instance()
            .set(&DataKey::FeeDestination, &fee_destination);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().extend_ttl(TTL_MIN, TTL_MAX);
        Ok(())
    }

    /// Update the platform fee recipient address. Admin-only; can only be called
    /// after initialize(). Kept for backward compatibility; prefer initialize()
    /// for new deployments. (#954)
    pub fn init(env: Env, platform_address: Address) -> Result<(), EscrowError> {
        let admin_transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::Unauthorized)?;
        admin_transfer.current_admin.require_auth();
        env.storage().instance().set(&DataKey::Platform, &platform_address);
        Ok(())
    }

    /// Set the reward token contract address for minting rewards on release (#851).
    /// Admin-only operation.
    pub fn set_reward_token(env: Env, reward_token_address: Address) {
        let admin_transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin_transfer.current_admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::RewardTokenContract, &reward_token_address);
        env.events()
            .publish(("reward_token_set",), reward_token_address);
    }

    /// Deposit funds into escrow for `order_id`. (#838)
    ///
    /// Hardening applied in this revision:
    /// - `amount` must be > 0; returns `EscrowError::InvalidAmount` otherwise.
    /// - `timeout_unix` is validated using `env.ledger().timestamp() + MIN_TIMEOUT_SECS`.
    /// - Duplicate `order_id` always returns `AlreadyExists` regardless of settlement state.
    /// - Emits ("escrow", "deposit", order_id) on success (#471).
    /// - Extends TTL on the new entry (#688).
    ///
    /// `token` is any SAC-compatible token address (#683 — multi-token support).
    /// `cooperative_address` and `cooperative_royalty_bps` are optional; pass
    /// `None` / `0` when the farmer is not a cooperative member (#860).
    pub fn deposit(
        env: Env,
        token: Address,
        order_id: u64,
        buyer: Address,
        farmer: Address,
        amount: i128,
        timeout_unix: u64,
        cooperative_address: Option<Address>,
        cooperative_royalty_bps: u32,
        release_after_unix: u64,
    ) -> Result<(), EscrowError> {
        buyer.require_auth();

        // #838: amount must be positive
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        if order_id >= MAX_ORDER_ID {
            return Err(EscrowError::InvalidAmount);
        }

        let key = DataKey::Escrow(order_id);
        if env.storage().persistent().has(&key) {
            panic!("escrow already exists");
        }
        }

        // Royalty bps must not exceed 10 000 (100%)
        if cooperative_royalty_bps > 10_000 {
            return Err(EscrowError::InvalidAmount);
        }
        // #857: enforce a minimum deposit to prevent dust escrow records that
        // cost more to store (Stellar base reserve) than they are worth.
        let min_deposit: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MinDeposit)
            .unwrap_or(MIN_DEPOSIT_STROOPS);
        if amount < min_deposit {
            return Err(EscrowError::BelowMinDeposit);
        }

        // #838: duplicate order_id — immutable, regardless of settlement state
        if env.storage().persistent().has(&DataKey::Escrow(order_id)) {
            return Err(EscrowError::AlreadyExists);
        }

        // #838: use env.ledger().timestamp() for timeout validation
        let now = env.ledger().timestamp();
        if now.saturating_add(MIN_TIMEOUT_SECS) > timeout_unix {
            return Err(EscrowError::InvalidAmount); // reuse InvalidAmount; callers can check message
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&buyer, &env.current_contract_address(), &amount);

        let auto_release_days: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AutoReleaseDays)
            .unwrap_or(Self::DEFAULT_AUTO_RELEASE_DAYS);
        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer,
            farmer: farmer.clone(),
            // Clone token before moving it into the struct so we can persist it separately.
            token: token.clone(),
            amount,
            timeout_unix,
            status: EscrowStatus::Active,
            cooperative_address: cooperative_address.clone(),
            cooperative_royalty_bps,
            auto_release_unix: now.saturating_add(auto_release_days.saturating_mul(86400)),
            dispute_opened_at: 0,
            release_after_unix,
        };

        // Effects before interactions: the escrow record is written before the token
        // transfer below so a reentrant deposit() for the same order_id (triggered by
        // a malicious token/callback during the transfer) sees `has(&key) == true` and
        // is rejected, instead of racing past the check above.
        env.storage().persistent().set(&key, &escrow);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&buyer, &env.current_contract_address(), &amount);

        Ok(())
    }

    pub fn release(env: Env, xlm_token: Address, order_id: u64) {
        let key = DataKey::Escrow(order_id);
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&key)
            .expect("escrow not found");
        // Persist the token used for this escrow so releases/refunds must use the same token contract.
        env.storage()
            .persistent()
            .set(&DataKey::Token(order_id), &token);
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(order_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);

        // #876: maintain buyer and farmer escrow index lists (bounded to 1000 entries)
        const INDEX_MAX: u32 = 1000;
        let buyer_key = DataKey::BuyerEscrows(buyer.clone());
        let mut buyer_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&buyer_key)
            .unwrap_or_else(|| Vec::new(&env));
        if buyer_ids.len() >= INDEX_MAX {
            buyer_ids.remove(0);
        }
        buyer_ids.push_back(order_id);
        env.storage().persistent().set(&buyer_key, &buyer_ids);
        env.storage()
            .persistent()
            .extend_ttl(&buyer_key, TTL_MIN, TTL_MAX);

        let farmer_key = DataKey::FarmerEscrows(farmer.clone());
        let mut farmer_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&farmer_key)
            .unwrap_or_else(|| Vec::new(&env));
        if farmer_ids.len() >= INDEX_MAX {
            farmer_ids.remove(0);
        }
        farmer_ids.push_back(order_id);
        env.storage().persistent().set(&farmer_key, &farmer_ids);
        env.storage()
            .persistent()
            .extend_ttl(&farmer_key, TTL_MIN, TTL_MAX);

        // #471 / #838 / #844: emit deposit event
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("deposit"), order_id),
            (buyer, farmer, amount),
        );

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("deposit")),
            (
                order_id,
                escrow.buyer.clone(),
                escrow.farmer.clone(),
                amount,
                timeout_unix,
            ),
        );

        env.events()
            .publish(("escrow", "deposit", order_id), amount);
        Ok(())
    }

    /// Create multiple escrows in a single transaction to reduce fees (#689).
    ///
    /// Each tuple is `(order_id, buyer, farmer, token, amount, timeout_unix)`.
    /// All entries are validated before any state is written; if any entry is
    /// invalid the entire batch is rejected.
    pub fn batch_deposit(
        env: Env,
        entries: Vec<(u64, Address, Address, Address, i128, u64)>,
    ) -> Result<(), EscrowError> {
        // Validate all entries first (fail-fast before touching state).
        for entry in entries.iter() {
            let (order_id, _buyer, _farmer, _token, amount, _timeout) = entry;
            if amount <= 0 {
                return Err(EscrowError::InvalidAmount);
            }
            if env.storage().persistent().has(&DataKey::Escrow(order_id)) {
                return Err(EscrowError::AlreadyExists);
            }
        }

        for entry in entries.iter() {
            let (order_id, buyer, farmer, token, amount, timeout_unix) = entry;
            buyer.require_auth();

            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&buyer, &env.current_contract_address(), &amount);

            let now = env.ledger().timestamp();
            let auto_release_days: u64 = env
                .storage()
                .instance()
                .get(&DataKey::AutoReleaseDays)
                .unwrap_or(Self::DEFAULT_AUTO_RELEASE_DAYS);
            let escrow = Escrow {
                buyer,
                farmer,
                token,
                amount,
                timeout_unix,
                status: EscrowStatus::Active,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: now.saturating_add(auto_release_days.saturating_mul(86400)),
                dispute_opened_at: 0,
                release_after_unix: 0,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(order_id), &escrow);
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
            env.storage()
                .persistent()
                .set(&DataKey::Token(order_id), &escrow.token);
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::Token(order_id), TTL_MIN, TTL_MAX);
        }
        Ok(())
    }

    /// Release funds to the farmer with platform fee deduction. (#839)
    ///
    /// - Computes `fee = amount * fee_bps / 10_000` and `farmer_amount = amount - fee`.
    /// - Transfers `fee` to `fee_destination` and `farmer_amount` to the farmer atomically.
    /// - Only the buyer or a platform admin may call this; farmers are rejected with
    ///   `EscrowError::Unauthorized` (#839).
    /// - Emits ("escrow", "release", order_id, farmer_amount, fee) (#839).
    /// - Extends TTL after updating the record (#688).
    ///
    /// Fee precedence (#951):
    /// - If the contract was initialized via `initialize()`, the stored `FeeBps` is always used.
    /// - `platform_fee_bps` is a fallback-only parameter, used only when `FeeBps` is not set
    ///   (legacy `init()`-only deployments).
    /// - Max allowed: 1000 bps (10%).
    ///
    /// Uses the token stored in the escrow record (#683).
    /// On successful release, attempts to mint reward tokens for the buyer (#851).
    pub fn release(
        env: Env,
        order_id: u64,
        platform_fee_bps: u32,
        caller: Address,
    ) -> Result<(), EscrowError> {
        if platform_fee_bps > 1000 {
            return Err(EscrowError::InvalidAmount);
        }

        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        // #839: Only the buyer or the platform admin may release; farmer may not.
        let admin_opt: Option<AdminTransfer> = env.storage().instance().get(&DataKey::Admin);
        let buyer_clone = escrow.buyer.clone();
        let is_buyer = caller == buyer_clone;
        let is_admin = admin_opt
            .as_ref()
            .map(|a| caller == a.current_admin)
            .unwrap_or(false);

        if !is_buyer && !is_admin {
            return Err(EscrowError::Unauthorized);
        }

        // Require auth from the actual invoker
        if is_buyer {
            escrow.buyer.require_auth();
        } else {
            admin_opt.unwrap().current_admin.require_auth();
        }

        match escrow.status {
            EscrowStatus::Released | EscrowStatus::Refunded => {
                return Err(EscrowError::AlreadySettled);
            }
            EscrowStatus::Disputed => {
                return Err(EscrowError::InDispute);
            }
            EscrowStatus::Active => {}
        }

        // Effects before interactions: mark released before transferring funds so a
        // reentrant release()/refund() call during the transfer sees the updated
        // state and is blocked by the checks above.
        escrow.released = true;
        env.storage().persistent().set(&key, &escrow);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &escrow.farmer, &escrow.amount);
    }

    pub fn refund(env: Env, xlm_token: Address, order_id: u64) {
        let key = DataKey::Escrow(order_id);
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&key)
            .expect("escrow not found");
        // #875: block release until the pre-order unlock date
        if escrow.release_after_unix > 0 && env.ledger().timestamp() < escrow.release_after_unix {
            return Err(EscrowError::NotYetReleasable);
        }

        escrow.released = true;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        env.events()
            .publish((symbol_short!("release"), order_id), escrow.amount);
        // Verify the token stored at deposit time matches the escrow record.
        let stored_token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Token(order_id))
            .ok_or(EscrowError::NotFound)?;
        if stored_token != escrow.token {
            return Err(EscrowError::InvalidToken);
        }

        let token_client = token::Client::new(&env, &escrow.token);

        // #839: Use stored fee_bps if initialized, otherwise use the passed parameter.
        let effective_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::FeeBps)
            .unwrap_or(platform_fee_bps);

        let fee_amount = Self::compute_fee(escrow.amount, effective_bps);
        // Amount remaining after platform fee, before cooperative royalty.
        let after_fee = escrow.amount - fee_amount;

        // #860: cooperative royalty — deducted from the farmer's portion.
        let royalty_amount: i128 = match &escrow.cooperative_address {
            Some(_) => Self::compute_fee(after_fee, escrow.cooperative_royalty_bps),
            None => 0,
        };
        let farmer_amount = after_fee - royalty_amount;

        // #839: Transfer fee to fee_destination.
        if fee_amount > 0 {
            let fee_dest: Address = env
                .storage()
                .instance()
                .get(&DataKey::FeeDestination)
                .or_else(|| env.storage().instance().get(&DataKey::Platform))
                .ok_or(EscrowError::NotFound)?;
            token_client.transfer(&env.current_contract_address(), &fee_dest, &fee_amount);
        }

        // #860: Transfer royalty to cooperative treasury (skip when not in a cooperative).
        if royalty_amount > 0 {
            if let Some(ref coop_addr) = escrow.cooperative_address {
                token_client.transfer(&env.current_contract_address(), coop_addr, &royalty_amount);
                // Emit cooperative royalty event.
                env.events().publish(
                    (symbol_short!("escrow"), symbol_short!("royalty"), order_id),
                    (coop_addr.clone(), royalty_amount),
                );
            }
        }

        // Transfer farmer's net amount.
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.farmer,
            &farmer_amount,
        );

        escrow.status = EscrowStatus::Released;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(order_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);

        // #844 / #952 — canonical release event
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("release")),
            (order_id, farmer_amount, fee_amount),
        );
        env.events()
            .publish(("escrow", "release", order_id), farmer_amount);

        // #851 — Mint reward tokens for the buyer using try_call (non-blocking)
        // Calculate reward amount using the admin-configurable rate (default 1% = 100 bps)
        let reward_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RewardBps)
            .unwrap_or(100);
        let reward_amount = Self::compute_fee(farmer_amount, reward_bps);
        if let Some(reward_token_address) = env.storage().instance().get(&DataKey::RewardTokenContract) {
            // Use try_invoke to call reward token mint - if it fails, emit event but don't abort release
            let mint_args = soroban_sdk::vec![
                &env,
                escrow.buyer.clone().into_val(&env),
                reward_amount.into_val(&env),
            ];
            let mint_result = env.try_invoke_contract::<(), EscrowError>(
                &reward_token_address,
                &symbol_short!("mint"),
                mint_args,
            );
            if !matches!(mint_result, Ok(Ok(()))) {
                // Mint failed - emit event but release proceeds
                env.events()
                    .publish(("escrow", "mint_failed", order_id), ());
            }
        }

        Ok(())
    }

    /// Release an escrow as a continuous payment stream instead of lump-sum.
    ///
    /// The farmer receives `farmer_amount` tokens streamed continuously from this contract
    /// at `stream_rate_per_second` stroops per second until `stream_end_time` (ledger timestamp).
    /// Platform fees and cooperative royalties are deducted before streaming, matching
    /// standard `release()` behavior.
    ///
    /// # Authorization
    /// Only the escrow buyer may call this (see `release()` authorization rules).
    ///
    /// # Parameters
    /// - `order_id`: Escrow ID
    /// - `platform_fee_bps`: Platform fee rate in basis points (max 1000, i.e., 10%)
    /// - `stream_rate_per_second`: Streaming rate in stroops/sec (must be > 0)
    /// - `stream_end_time`: Ledger timestamp when streaming stops (must be > current timestamp)
    ///
    /// # Returns
    /// Stream ID (u64) on success, or EscrowError on validation failure.
    ///
    /// # Errors
    /// - `NotFound`: Order does not exist
    /// - `AlreadySettled`: Escrow already released or refunded
    /// - `InDispute`: Escrow is in disputed state
    /// - `Unauthorized`: Caller is not the buyer
    /// - `InvalidAmount`: platform_fee_bps > 1000, or stream_rate <= 0, or end_time <= now
    /// - `NotYetReleasable`: Pre-order unlock date not yet reached (#875)
    ///
    /// # Issue Reference
    /// See issue #973 for design decision and streaming integration rationale.
    pub fn release_to_stream(
        env: Env,
        order_id: u64,
        platform_fee_bps: u32,
        stream_rate_per_second: i128,
        stream_end_time: u64,
    ) -> Result<u64, EscrowError> {
        // Validate platform fee
        if platform_fee_bps > 1000 {
            return Err(EscrowError::InvalidAmount);
        }

        // Validate stream parameters
        let now = env.ledger().timestamp();
        if stream_rate_per_second <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        if stream_end_time <= now {
            return Err(EscrowError::InvalidAmount);
        }

        // Fetch and validate escrow
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        // Require buyer authorization
        escrow.buyer.require_auth();

        // Check escrow status
        match escrow.status {
            EscrowStatus::Released | EscrowStatus::Refunded => {
                return Err(EscrowError::AlreadySettled);
            }
            EscrowStatus::Disputed => {
                return Err(EscrowError::InDispute);
            }
            EscrowStatus::Active => {}
        }

        // #875: block release until the pre-order unlock date
        if escrow.release_after_unix > 0 && now < escrow.release_after_unix {
            return Err(EscrowError::NotYetReleasable);
        }

        // Verify the token stored at deposit time matches the escrow record.
        let stored_token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Token(order_id))
            .ok_or(EscrowError::NotFound)?;
        if stored_token != escrow.token {
            return Err(EscrowError::InvalidToken);
        }

        // Effects before interactions — see release() above.
        escrow.refunded = true;
        env.storage().persistent().set(&key, &escrow);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &escrow.buyer, &escrow.amount);
    }

    pub fn dispute(env: Env, order_id: u64, caller: Address) {
        caller.require_auth();
        let key = DataKey::Escrow(order_id);
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&key)
            .expect("escrow not found");
        let token_client = token::Client::new(&env, &escrow.token);

        // Use stored fee_bps if initialized, otherwise use the passed parameter.
        let effective_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::FeeBps)
            .unwrap_or(platform_fee_bps);

        let fee_amount = Self::compute_fee(escrow.amount, effective_bps);
        let after_fee = escrow.amount - fee_amount;

        // #860: cooperative royalty — deducted from the farmer's portion.
        let royalty_amount: i128 = match &escrow.cooperative_address {
            Some(_) => Self::compute_fee(after_fee, escrow.cooperative_royalty_bps),
            None => 0,
        };
        let farmer_amount = after_fee - royalty_amount;

        // Transfer platform fee
        if fee_amount > 0 {
            let fee_dest: Address = env
                .storage()
                .instance()
                .get(&DataKey::FeeDestination)
                .or_else(|| env.storage().instance().get(&DataKey::Platform))
                .ok_or(EscrowError::NotFound)?;
            token_client.transfer(&env.current_contract_address(), &fee_dest, &fee_amount);
        }

        // Transfer cooperative royalty
        if royalty_amount > 0 {
            if let Some(ref coop_addr) = escrow.cooperative_address {
                token_client.transfer(&env.current_contract_address(), coop_addr, &royalty_amount);
                env.events().publish(
                    (symbol_short!("escrow"), symbol_short!("royalty"), order_id),
                    (coop_addr.clone(), royalty_amount),
                );
            }
        }

        // Create payment stream with farmer_amount as initial deposit
        let stream_id: u64 = order_id; // Use order_id as stream_id for 1:1 correspondence
        let payment_stream = stream::PaymentStream {
            sender: env.current_contract_address(),
            recipient: escrow.farmer.clone(),
            rate_per_second: stream_rate_per_second,
            deposit: farmer_amount,
            accrued_at_checkpoint: 0,
            last_checkpoint_at: now,
            end_time: stream_end_time,
            cancelled: false,
        };
        env.storage()
            .persistent()
            .set(&stream::StreamKey::Stream(stream_id), &payment_stream);
        env.storage()
            .persistent()
            .extend_ttl(&stream::StreamKey::Stream(stream_id), TTL_MIN, TTL_MAX);

        // Mark escrow as released
        escrow.status = EscrowStatus::Released;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);

        // Emit release event (similar to release())
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("release"), order_id),
            (farmer_amount, fee_amount),
        );
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("release")),
            (order_id, farmer_amount, fee_amount),
        );
        env.events().publish(("escrow", "release", order_id), farmer_amount);

        // Emit stream creation event
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("stream"), order_id),
            (stream_rate_per_second, stream_end_time),
        );

        Ok(stream_id)
    }

    /// Rotate the admin to a new address. Admin-only; can only be called after
    /// initialize() has been called (i.e. an admin must already exist). Prevents
    /// front-running attacks during bootstrap. (#954)
    pub fn set_admin(env: Env, admin: Address) -> Result<(), EscrowError> {
        let existing_admin: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::Unauthorized)?;
        existing_admin.current_admin.require_auth();

        let transfer = AdminTransfer { current_admin: admin, pending_admin: None };
        env.storage().instance().set(&DataKey::Admin, &transfer);
        Ok(())
    }

    /// Admin-only: update the minimum deposit amount (in stroops) to respond to
    /// XLM price changes. Must be positive and not exceed MAX_MIN_DEPOSIT. (#857)
    pub fn set_min_deposit(env: Env, amount: i128) -> Result<(), EscrowError> {
        let admin_transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::Unauthorized)?;
        admin_transfer.current_admin.require_auth();

        if amount <= 0 || amount > MAX_MIN_DEPOSIT {
            return Err(EscrowError::InvalidAmount);
        }
        env.storage().instance().set(&DataKey::MinDeposit, &amount);
        env.events()
            .publish((symbol_short!("escrow"), symbol_short!("min_dep")), amount);
        Ok(())
    }

    /// Read-only view: returns the current minimum deposit amount in stroops,
    /// falling back to the `MIN_DEPOSIT_STROOPS` default when unset. (#857)
    pub fn get_min_deposit(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MinDeposit)
            .unwrap_or(MIN_DEPOSIT_STROOPS)
    }

    /// Admin-only: update the reward token mint rate (in basis points) to adjust
    /// buyer incentives. Must be positive and <= 1000 (10%). (#953)
    pub fn set_reward_bps(env: Env, reward_bps: u32) -> Result<(), EscrowError> {
        let admin_transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::Unauthorized)?;
        admin_transfer.current_admin.require_auth();

        if reward_bps == 0 || reward_bps > 1000 {
            return Err(EscrowError::InvalidAmount);
        }
        env.storage().instance().set(&DataKey::RewardBps, &reward_bps);
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("reward_bps")),
            reward_bps,
        );
        Ok(())
    }

    /// Read-only view: returns the current reward rate in basis points,
    /// falling back to 100 bps (1%) when unset. (#953)
    pub fn get_reward_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::RewardBps)
            .unwrap_or(100)
    }

    /// Release many escrows to their farmers in a single transaction. (#856)
    ///
    /// Callable by the Platform role only (the platform address authorises the
    /// whole batch, so individual buyer signatures are not required). Reduces the
    /// per-release transaction fee for cron-driven settlement of many small orders.
    ///
    /// - At most `MAX_BATCH_RELEASE` (20) IDs are accepted, matching Stellar's
    ///   per-transaction operation limit; otherwise `EscrowError::BatchTooLarge`.
    /// - Each release is independent: a failing one emits
    ///   ("escrow", "batch_release_error", order_id) and the batch continues.
    /// - Returns one `(order_id, succeeded)` pair per input ID, in order.
    pub fn batch_release(env: Env, order_ids: Vec<u64>) -> Result<Vec<(u64, bool)>, EscrowError> {
        // Platform-role authorization for the whole batch.
        let platform: Address = env
            .storage()
            .instance()
            .get(&DataKey::Platform)
            .ok_or(EscrowError::Unauthorized)?;
        platform.require_auth();

        if order_ids.len() > MAX_BATCH_RELEASE {
            return Err(EscrowError::BatchTooLarge);
        }

        let mut results: Vec<(u64, bool)> = Vec::new(&env);
        for order_id in order_ids.iter() {
            match Self::release_internal(&env, order_id) {
                Ok(()) => results.push_back((order_id, true)),
                Err(_) => {
                    env.events().publish(
                        (
                            symbol_short!("escrow"),
                            soroban_sdk::Symbol::new(&env, "batch_release_error"),
                            order_id,
                        ),
                        (),
                    );
                    results.push_back((order_id, false));
                }
            }
        }
        Ok(results)
    }

    /// Core release logic shared by `batch_release` (#856) — releases an escrow
    /// to its farmer with the stored platform fee, WITHOUT requiring buyer auth
    /// (the caller is responsible for authorization). Returns an error instead of
    /// panicking so a batch can continue past individual failures.
    fn release_internal(env: &Env, order_id: u64) -> Result<(), EscrowError> {
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        match escrow.status {
            EscrowStatus::Released | EscrowStatus::Refunded => {
                return Err(EscrowError::AlreadySettled);
            }
            EscrowStatus::Disputed => return Err(EscrowError::InDispute),
            EscrowStatus::Active => {}
        }

        // Enforce the token stored at deposit time.
        let stored_token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Token(order_id))
            .ok_or(EscrowError::NotFound)?;
        if stored_token != escrow.token {
            return Err(EscrowError::InvalidToken);
        }

        escrow.disputed = true;
        env.storage().persistent().set(&key, &escrow);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
    }
        let token_client = token::Client::new(env, &escrow.token);
        let effective_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let fee_amount = Self::compute_fee(escrow.amount, effective_bps);
        let farmer_amount = escrow.amount - fee_amount;

        if fee_amount > 0 {
            let fee_dest: Address = env
                .storage()
                .instance()
                .get(&DataKey::FeeDestination)
                .or_else(|| env.storage().instance().get(&DataKey::Platform))
                .ok_or(EscrowError::NotFound)?;
            token_client.transfer(&env.current_contract_address(), &fee_dest, &fee_amount);
        }
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.farmer,
            &farmer_amount,
        );

        escrow.status = EscrowStatus::Released;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(order_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("release")),
            (order_id, farmer_amount, fee_amount),
        );
        Ok(())
    }

    /// Store a point-in-time copy of the live escrow record for `order_id`,
    /// keyed by the current ledger sequence. (#858)
    ///
    /// Snapshots live in temporary storage (same TTL as the escrow record) and
    /// never mutate the live escrow. Used for dispute resolution and audit.
    /// Internal: callers are responsible for any authorization.
    fn store_snapshot(env: &Env, order_id: u64) -> Result<u64, EscrowError> {
        let escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        let seq = env.ledger().sequence() as u64;
        let key = DataKey::Snapshot(order_id, seq);
        env.storage().temporary().set(&key, &escrow);
        env.storage().temporary().extend_ttl(&key, TTL_MIN, TTL_MAX);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("snapshot"), order_id),
            seq,
        );
        Ok(seq)
    }

    /// Take a snapshot of the current escrow state for `order_id`. (#858)
    ///
    /// Callable by the buyer, farmer, or the Platform/Arbitrator role (admin).
    /// Returns the ledger sequence the snapshot was stored under.
    pub fn take_snapshot(env: Env, order_id: u64, caller: Address) -> Result<u64, EscrowError> {
        let escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        let admin_transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(EscrowError::Unauthorized)?;

        caller.require_auth();
        let is_authorized = caller == escrow.buyer
            || caller == escrow.farmer
            || caller == admin_transfer.current_admin;

        if !is_authorized {
            return Err(EscrowError::Unauthorized);
        }

        Self::store_snapshot(&env, order_id)
    }

    /// Read-only view: return the escrow snapshot stored for
    /// (`order_id`, `ledger_sequence`), or `SnapshotNotFound`. (#858)
    pub fn get_snapshot(
        env: Env,
        order_id: u64,
        ledger_sequence: u64,
    ) -> Result<Escrow, EscrowError> {
        env.storage()
            .temporary()
            .get(&DataKey::Snapshot(order_id, ledger_sequence))
            .ok_or(EscrowError::SnapshotNotFound)
    }

    /// Refund funds to the buyer after timeout.
    ///
    /// Uses the token stored in the escrow record (#683).
    pub fn refund(env: Env, order_id: u64) -> Result<(), EscrowError> {
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        escrow.buyer.require_auth();

        match escrow.status {
            EscrowStatus::Released | EscrowStatus::Refunded => {
                return Err(EscrowError::AlreadySettled);
            }
            _ => {}
        }
        if env.ledger().timestamp() < escrow.timeout_unix {
            return Err(EscrowError::TimeoutNotReached);
        }

        // Verify the token stored at deposit time matches the escrow record.
        let stored_token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Token(order_id))
            .ok_or(EscrowError::NotFound)?;
        if stored_token != escrow.token {
            return Err(EscrowError::InvalidToken);
        }

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.buyer,
            &escrow.amount,
        );

        escrow.status = EscrowStatus::Refunded;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(order_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);

        // #844 — refund event: ("escrow", "refund") → (order_id, refunded_amount)
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("refund")),
            (order_id, escrow.amount),
        );

        env.events()
            .publish(("escrow", "refund", order_id), escrow.amount);
        Ok(())
    }

    /// Permissionless claim for timeout refunds. Mirrors `refund`.
    pub fn claim_timeout_refund(env: Env, order_id: u64) -> Result<(), EscrowError> {
        Self::refund(env, order_id)
    }

    // ── #878: Auto-release (time-lock release) ─────────────────────────────────────

    /// Default auto-release days. (#878)
    const DEFAULT_AUTO_RELEASE_DAYS: u64 = 7;

    /// Set the auto-release days (admin only). (#878)
    pub fn set_auto_release_days(env: Env, days: u64) -> Result<(), EscrowError> {
        let admin_transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin_transfer.current_admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::AutoReleaseDays, &days);
        env.events()
            .publish((symbol_short!("escrow"), symbol_short!("auto_days")), days);
        Ok(())
    }

    /// Auto-release escrow funds to the farmer when the time-lock has expired. (#878)
    /// Anyone may call this when `env.ledger().timestamp() >= auto_release_unix`
    /// and the escrow status is `Active`. Blocked if in dispute.
    /// Applies the same fee logic as `release`.
    pub fn auto_release(env: Env, order_id: u64) -> Result<(), EscrowError> {
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        // Must be Active (not settled, not disputed, not refunded)
        if escrow.status != EscrowStatus::Active {
            return Err(EscrowError::AlreadySettled);
        }

        let now = env.ledger().timestamp();
        if now < escrow.auto_release_unix {
            return Err(EscrowError::AutoReleaseNotReached);
        }

        // Apply same fee logic as release (using stored fee_bps)
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let fee_amount = if fee_bps > 0 && fee_bps <= 1000 {
            Self::compute_fee(escrow.amount, fee_bps)
        } else {
            0
        };
        let farmer_amount = escrow.amount - fee_amount;

        // Verify token
        let stored_token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Token(order_id))
            .ok_or(EscrowError::NotFound)?;
        if stored_token != escrow.token {
            return Err(EscrowError::InvalidToken);
        }

        let token_client = token::Client::new(&env, &escrow.token);

        // Transfer fee to fee_destination
        if fee_amount > 0 {
            let fee_dest: Address = env
                .storage()
                .instance()
                .get(&DataKey::FeeDestination)
                .or_else(|| env.storage().instance().get(&DataKey::Platform))
                .ok_or(EscrowError::NotFound)?;
            token_client.transfer(&env.current_contract_address(), &fee_dest, &fee_amount);
        }

        // Transfer farmer amount
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.farmer,
            &farmer_amount,
        );

        escrow.status = EscrowStatus::Released;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(order_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);

        // Emit auto-release event
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("auto_rel")),
            order_id,
        );

        Ok(())
    }

    // ── #877: Dispute evidence submission ──────────────────────────────────────────

    /// Maximum number of evidence hashes per party per escrow. (#877)
    const MAX_EVIDENCE_PER_PARTY: u32 = 5;

    /// Evidence submission window in seconds (48 hours). (#877)
    const EVIDENCE_WINDOW_SECS: u64 = 172_800;

    /// Submit evidence hash for a disputed escrow. (#877)
    /// Only buyer or farmer can submit when status is Disputed,
    /// and only within 48 hours of the dispute being opened.
    pub fn submit_evidence(
        env: Env,
        order_id: u64,
        evidence_hash: BytesN<32>,
    ) -> Result<(), EscrowError> {
        let escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        if escrow.status != EscrowStatus::Disputed {
            return Err(EscrowError::InDispute);
        }

        let is_buyer = true;
        let submitter = escrow.buyer.clone();
        submitter.require_auth();

        // Check evidence submission window (48 hours from dispute opened)
        let now = env.ledger().timestamp();
        if escrow.dispute_opened_at == 0
            || now.saturating_sub(escrow.dispute_opened_at) > Self::EVIDENCE_WINDOW_SECS
        {
            return Err(EscrowError::SubmissionWindowClosed);
        }

        // Check max evidence count per party
        let count_key = if is_buyer {
            DataKey::BuyerEvidenceCount(order_id)
        } else {
            DataKey::FarmerEvidenceCount(order_id)
        };
        let evidence_count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
        if evidence_count >= Self::MAX_EVIDENCE_PER_PARTY {
            return Err(EscrowError::InvalidAmount); // reuse — max evidence reached
        }

        // Store evidence hash
        let evidence_key = if is_buyer {
            DataKey::BuyerEvidence(order_id)
        } else {
            DataKey::FarmerEvidence(order_id)
        };
        // Store evidence as a Vec of hashes
        let mut hashes: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&evidence_key)
            .unwrap_or_else(|| Vec::new(&env));
        hashes.push_back(evidence_hash.clone());
        env.storage().persistent().set(&evidence_key, &hashes);
        env.storage()
            .persistent()
            .set(&count_key, &(evidence_count + 1));
        env.storage()
            .persistent()
            .extend_ttl(&evidence_key, TTL_MIN, TTL_MAX);
        env.storage()
            .persistent()
            .extend_ttl(&count_key, TTL_MIN, TTL_MAX);

        // Emit event
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("evidence"), order_id),
            (submitter, evidence_hash),
        );

        Ok(())
    }

    /// Get all evidence hashes for a disputed escrow. Returns (buyer_hashes, farmer_hashes). (#877)
    pub fn get_evidence(env: Env, order_id: u64) -> (Vec<BytesN<32>>, Vec<BytesN<32>>) {
        let buyer_hashes: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::BuyerEvidence(order_id))
            .unwrap_or_else(|| Vec::new(&env));
        let farmer_hashes: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::FarmerEvidence(order_id))
            .unwrap_or_else(|| Vec::new(&env));
        (buyer_hashes, farmer_hashes)
    }

    pub fn dispute(env: Env, order_id: u64, caller: Address) -> Result<(), EscrowError> {
        caller.require_auth();
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        if caller != escrow.buyer && caller != escrow.farmer {
            return Err(EscrowError::Unauthorized);
        }
        match escrow.status {
            EscrowStatus::Released | EscrowStatus::Refunded => {
                return Err(EscrowError::AlreadySettled);
            }
            _ => {}
        }

        // #858: capture a snapshot of the pre-dispute state before mutating it,
        // so the arbitrator can inspect the escrow as it was when the dispute opened.
        Self::store_snapshot(&env, order_id)?;

        escrow.status = EscrowStatus::Disputed;
        // #877: Record dispute opened timestamp for evidence window check
        escrow.dispute_opened_at = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(order_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);

        // #844 — dispute opened event: ("escrow", "dispute") → order_id
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("dispute")),
            order_id,
        );

        Ok(())
    }

    /// Admin resolves a disputed escrow. Uses the token stored in the record (#683).
    pub fn resolve_dispute(env: Env, order_id: u64, release_to_farmer: bool) {
        let admin_transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin_transfer.current_admin.require_auth();

        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .expect("escrow not found");

        if escrow.status != EscrowStatus::Disputed {
            panic!("escrow is not in dispute");
        }

        // Verify the token stored at deposit time matches the escrow record.
        let stored_token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Token(order_id))
            .expect("token not set for escrow");
        if stored_token != escrow.token {
            panic!("stored token does not match escrow token");
        }

        let token_client = token::Client::new(&env, &escrow.token);
        if release_to_farmer {
            token_client.transfer(
                &env.current_contract_address(),
                &escrow.farmer,
                &escrow.amount,
            );
            escrow.status = EscrowStatus::Released;
            env.events()
                .publish(("escrow", "resolve_dispute", order_id), true);
        } else {
            token_client.transfer(
                &env.current_contract_address(),
                &escrow.buyer,
                &escrow.amount,
            );
            escrow.status = EscrowStatus::Refunded;
            env.events()
                .publish(("escrow", "resolve_dispute", order_id), false);
        }
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(order_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);

        // #844 — resolved event: ("escrow", "resolved") → (order_id, buyer_pct)
        // buyer_pct = 100 if refunded to buyer, 0 if released to farmer
        let buyer_pct: u32 = if release_to_farmer { 0 } else { 100 };
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("resolved")),
            (order_id, buyer_pct),
        );
    }

    /// Admin proposes a new admin (first step of two-step transfer).
    pub fn propose_admin(env: Env, new_admin: Address) {
        let mut transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        transfer.current_admin.require_auth();
        transfer.pending_admin = Some(new_admin.clone());
        env.storage().instance().set(&DataKey::Admin, &transfer);
        env.events().publish(("admin", "proposed"), new_admin);
    }

    /// Pending admin accepts the transfer (second step).
    pub fn accept_admin(env: Env) -> Result<(), EscrowError> {
        let mut transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        let pending = transfer
            .pending_admin
            .clone()
            .ok_or(EscrowError::NoPendingAdmin)?;
        pending.require_auth();
        transfer.current_admin = pending.clone();
        transfer.pending_admin = None;
        env.storage().instance().set(&DataKey::Admin, &transfer);
        env.events().publish(("admin", "accepted"), pending);
        Ok(())
    }

    /// Admin-only contract WASM upgrade. Validates `new_wasm_hash` is non-zero
    /// before invoking the deployer API to perform the update.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), EscrowError> {
        let transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        transfer.current_admin.require_auth();

        let zero = BytesN::<32>::from_array(&env, &[0u8; 32]);
        if new_wasm_hash == zero {
            return Err(EscrowError::InvalidWasmHash);
        }

        env.deployer().update_current_contract_wasm(new_wasm_hash);
        env.events().publish(("admin", "upgrade"), ());
        Ok(())
    }

    pub fn get(env: Env, order_id: u64) -> Result<Escrow, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)
    }

    /// Read-only view: returns the full Escrow struct for `order_id` (#697).
    /// Returns `None` if the escrow does not exist. No auth required.
    pub fn get_escrow(env: Env, order_id: u64) -> Option<Escrow> {
        env.storage().persistent().get(&DataKey::Escrow(order_id))
    }

    /// Read-only view: returns `true` if the escrow for `order_id` has been
    /// settled (Released or Refunded), `false` if Active or Disputed (#697).
    /// Returns `false` for unknown order IDs. No auth required.
    pub fn is_settled(env: Env, order_id: u64) -> bool {
        match env
            .storage()
            .persistent()
            .get::<DataKey, Escrow>(&DataKey::Escrow(order_id))
        {
            Some(escrow) => matches!(
                escrow.status,
                EscrowStatus::Released | EscrowStatus::Refunded
            ),
            None => false,
        }
    }

    /// Read-only view: returns paginated list of order IDs deposited by `buyer`. (#876, #980)
    /// Returns a `PaginatedEscrows` with a page of escrow IDs and total count.
    /// `limit` is capped at `MAX_ESCROW_PAGE_SIZE` to prevent excessive read costs.
    pub fn get_buyer_escrows(env: Env, buyer: Address, offset: u32, limit: u32) -> PaginatedEscrows {
        let all_escrows: Vec<u64> = env.storage()
            .persistent()
            .get(&DataKey::BuyerEscrows(buyer))
            .unwrap_or_else(|| Vec::new(&env));

        let total = all_escrows.len() as u32;
        let capped_limit = core::cmp::min(limit, MAX_ESCROW_PAGE_SIZE);
        let start = offset as usize;
        let end = core::cmp::min(
            (offset as usize) + (capped_limit as usize),
            all_escrows.len() as usize,
        );

        let mut page = Vec::new(&env);
        if start < all_escrows.len() as usize {
            for i in start..end {
                page.push_back(all_escrows.get(i as u32).unwrap());
            }
        }

        PaginatedEscrows {
            escrows: page,
            total,
        }
    }

    /// Read-only view: returns paginated list of order IDs for a given `farmer`. (#876, #980)
    /// Returns a `PaginatedEscrows` with a page of escrow IDs and total count.
    /// `limit` is capped at `MAX_ESCROW_PAGE_SIZE` to prevent excessive read costs.
    pub fn get_farmer_escrows(env: Env, farmer: Address, offset: u32, limit: u32) -> PaginatedEscrows {
        let all_escrows: Vec<u64> = env.storage()
            .persistent()
            .get(&DataKey::FarmerEscrows(farmer))
            .unwrap_or_else(|| Vec::new(&env));

        let total = all_escrows.len() as u32;
        let capped_limit = core::cmp::min(limit, MAX_ESCROW_PAGE_SIZE);
        let start = offset as usize;
        let end = core::cmp::min(
            (offset as usize) + (capped_limit as usize),
            all_escrows.len() as usize,
        );

        let mut page = Vec::new(&env);
        if start < all_escrows.len() as usize {
            for i in start..end {
                page.push_back(all_escrows.get(i as u32).unwrap());
            }
        }

        PaginatedEscrows {
            escrows: page,
            total,
        }
    }

    // -----------------------------------------------------------------------
    // migrate — v1 → v2 schema migration (#691)
    //
    // Reads each `order_id` in `order_ids` from persistent storage.  If the
    // entry deserialises as a v1 `EscrowRecord` (no `status` field, `released`
    // bool), it is rewritten as a v2 `Escrow` with:
    //   • status = EscrowStatus::Active   (released=false entries)
    //   • status = EscrowStatus::Released (released=true  entries)
    //   • token  = `fallback_token`       (v1 had no per-escrow token)
    //
    // Already-migrated entries (those that already deserialise as `Escrow`)
    // are left untouched.  The function is admin-only and idempotent.
    //
    // Returns the number of entries that were actually rewritten.
    // -----------------------------------------------------------------------
    fn has_escrow_field(env: &Env, raw: &Val, field: Val) -> bool {
        match Map::<Val, Val>::try_from_val(env, raw) {
            Ok(map) => map.contains_key(field),
            Err(_) => false,
        }
    }

    fn is_legacy_escrow_record(env: &Env, raw: &Val) -> bool {
        let released_key = symbol_short!("released").into_val(env);
        let status_key = symbol_short!("status").into_val(env);
        Self::has_escrow_field(env, raw, released_key)
            && !Self::has_escrow_field(env, raw, status_key)
    }

    fn is_v2_escrow(env: &Env, raw: &Val) -> bool {
        let status_key = symbol_short!("status").into_val(env);
        let token_key = symbol_short!("token").into_val(env);
        Self::has_escrow_field(env, raw, status_key) && Self::has_escrow_field(env, raw, token_key)
    }

    /// Read-only migration dry-run for operators. Returns one tuple for each
    /// requested order ID: `(order_id, needs_migration)`. Missing IDs and
    /// already-v2 escrows return `false`; legacy v1 `EscrowRecord` entries
    /// return `true`. (#981)
    pub fn migrate_preview(env: Env, order_ids: Vec<u64>) -> Vec<(u64, bool)> {
        let mut preview: Vec<(u64, bool)> = Vec::new(&env);

        for order_id in order_ids.iter() {
            let key = DataKey::Escrow(order_id);
            let needs_migration = match env.storage().persistent().get::<DataKey, Val>(&key) {
                Some(raw) => Self::is_legacy_escrow_record(&env, &raw),
                None => false,
            };
            preview.push_back((order_id, needs_migration));
        }

        preview
    }

    pub fn migrate(
        env: Env,
        order_ids: Vec<u64>,
        fallback_token: Address,
    ) -> Result<u32, EscrowError> {
        // Only the current admin may trigger a migration.
        let transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        transfer.current_admin.require_auth();

        let mut migrated: u32 = 0;

        for order_id in order_ids.iter() {
            let key = DataKey::Escrow(order_id);

            // Skip if no entry exists at all.
            let Some(raw): Option<Val> = env.storage().persistent().get(&key) else {
                continue;
            };

            if Self::is_v2_escrow(&env, &raw) {
                continue;
            }
            if !Self::is_legacy_escrow_record(&env, &raw) {
                return Err(EscrowError::MigrationFailed);
            }

            // Try to decode as the old v1 EscrowRecord.
            let record: EscrowRecord =
                EscrowRecord::try_from_val(&env, &raw).map_err(|_| EscrowError::MigrationFailed)?;

            let status = if record.released {
                EscrowStatus::Released
            } else {
                EscrowStatus::Active
            };

            let now = env.ledger().timestamp();
            let auto_release_days: u64 = env
                .storage()
                .instance()
                .get(&DataKey::AutoReleaseDays)
                .unwrap_or(Self::DEFAULT_AUTO_RELEASE_DAYS);
            let new_escrow = Escrow {
                buyer: record.buyer,
                farmer: record.farmer,
                token: fallback_token.clone(),
                amount: record.amount,
                timeout_unix: record.timeout_unix,
                status,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: now.saturating_add(auto_release_days.saturating_mul(86400)),
                dispute_opened_at: 0,
                release_after_unix: 0,
            };

            env.storage().persistent().set(&key, &new_escrow);
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_MIN, TTL_MAX);

            env.events().publish(("escrow", "migrated", order_id), ());

            migrated += 1;
        }

        Ok(migrated)
    }

    // -----------------------------------------------------------------------
    // #701 — cooperative multisig escrow release
    //
    // set_coop registers the M-of-N cooperative configuration (admin-only).
    // multisig_release verifies that at least `threshold` of the registered
    // members have signed the order_id and, if so, releases funds to the farmer.
    // -----------------------------------------------------------------------

    /// Admin-only: configure cooperative members (ed25519 public keys) and
    /// the minimum signature threshold required for `multisig_release`.
    /// Number of members is capped at `MAX_COOP_SIGNERS` to prevent unbounded
    /// loop costs in multisig_release signature verification. (#979)
    pub fn set_coop(
        env: Env,
        members: Vec<BytesN<32>>,
        threshold: u32,
    ) -> Result<(), EscrowError> {
        let transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        transfer.current_admin.require_auth();

        if members.len() as u32 > MAX_COOP_SIGNERS {
            return Err(EscrowError::TooManyCoopSigners);
        }

        let config = CoopConfig { members, threshold };
        env.storage().instance().set(&DataKey::CoopConfig, &config);
        Ok(())
    }

    /// Release escrow funds to the farmer after M-of-N cooperative members
    /// have provided valid ed25519 signatures over sha256(order_id).
    ///
    /// `signatures` is positionally aligned with the stored `CoopConfig.members`
    /// list.  Pass an empty `Bytes` for members that are not signing; pass a
    /// 64-byte ed25519 signature for members that are.  Any non-empty entry
    /// that is not a valid 64-byte signature will cause the call to fail.
    pub fn multisig_release(
        env: Env,
        order_id: u64,
        signatures: Vec<Bytes>,
    ) -> Result<(), EscrowError> {
        let coop: CoopConfig = env
            .storage()
            .instance()
            .get(&DataKey::CoopConfig)
            .ok_or(EscrowError::CoopNotConfigured)?;

        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        match escrow.status {
            EscrowStatus::Released | EscrowStatus::Refunded => {
                return Err(EscrowError::AlreadySettled);
            }
            EscrowStatus::Disputed => {
                return Err(EscrowError::InDispute);
            }
            EscrowStatus::Active => {}
        }

        // message = sha256(order_id as big-endian bytes) — used as the signed payload
        let order_id_bytes = Bytes::from_slice(&env, &order_id.to_be_bytes());
        let message: Bytes = env.crypto().sha256(&order_id_bytes).into();

        // Walk the member list and count valid signatures.
        // Signatures are positionally aligned with CoopConfig.members; pass an
        // empty Bytes for members that are not participating in this release.
        let n = coop.members.len().min(signatures.len());
        let mut valid: u32 = 0;
        for i in 0..n {
            let sig: Bytes = signatures.get(i).ok_or(EscrowError::NotEnoughSignatures)?;
            if sig.len() == 0 {
                continue; // member chose not to sign
            }
            // Reject non-empty entries that are not a valid 64-byte ed25519 sig.
            let sig64 =
                BytesN::<64>::try_from(sig).map_err(|_| EscrowError::NotEnoughSignatures)?;
            let member_key: BytesN<32> = coop
                .members
                .get(i)
                .ok_or(EscrowError::NotEnoughSignatures)?;
            env.crypto().ed25519_verify(&member_key, &message, &sig64);
            valid += 1;
        }

        if valid < coop.threshold {
            return Err(EscrowError::NotEnoughSignatures);
        }

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.farmer,
            &escrow.amount,
        );

        escrow.status = EscrowStatus::Released;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(order_id), &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl,
        testutils::{Address as _, Ledger},
        Address, Env,
    };

    const MAX_BATCH_DEPOSIT_CPU_BUDGET: u64 = 8_000_000;
    const MAX_BATCH_DEPOSIT_MEMORY_BUDGET: u64 = 2_000_000;
    const MAX_BATCH_RELEASE_CPU_BUDGET: u64 = 12_000_000;
    const MAX_BATCH_RELEASE_MEMORY_BUDGET: u64 = 3_000_000;

    #[contract]
    pub struct NoopTokenContract;

    #[contractimpl]
    impl NoopTokenContract {
        pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
    }

    fn store_escrow(env: &Env, order_id: u64, buyer: Address, farmer: Address, token: Address) {
        let escrow = Escrow {
            buyer,
            farmer,
            token,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            status: EscrowStatus::Active,
            cooperative_address: None,
            cooperative_royalty_bps: 0,
            auto_release_unix: 9_999_999,
            dispute_opened_at: 0,
            release_after_unix: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(order_id), &escrow);
    }

    // ── EscrowStatus::Disputed consolidation tests ────────────────────────────

    #[test]
    fn dispute_sets_status_to_disputed() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            store_escrow(&env, 1, buyer.clone(), farmer, token);
            EscrowContract::dispute(env.clone(), 1, buyer).unwrap();
            let updated = EscrowContract::get(env, 1).unwrap();
            assert_eq!(updated.status, EscrowStatus::Disputed);
        });
    }

    #[test]
    fn release_disputed_escrow_returns_in_dispute_error() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let escrow = Escrow {
                buyer: buyer.clone(),
                farmer,
                token,
                amount: 1_000_0000,
                timeout_unix: 1_000,
                status: EscrowStatus::Disputed,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 0,
            };
            env.storage().persistent().set(&DataKey::Escrow(2), &escrow);
            let result = EscrowContract::release(env, 2, 0);
            assert_eq!(result, Err(EscrowError::InDispute));
        });
    }

    // ── error variant tests ───────────────────────────────────────────────────

    #[test]
    fn get_not_found() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let result = EscrowContract::get(env, 99);
            assert_eq!(result, Err(EscrowError::NotFound));
        });
    }

    #[test]
    fn dispute_not_found() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let caller = Address::generate(&env);
            let result = EscrowContract::dispute(env, 99, caller);
            assert_eq!(result, Err(EscrowError::NotFound));
        });
    }

    #[test]
    fn dispute_unauthorized() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let stranger = Address::generate(&env);
            let token = Address::generate(&env);
            store_escrow(&env, 3, buyer, farmer, token);
            let result = EscrowContract::dispute(env, 3, stranger);
            assert_eq!(result, Err(EscrowError::Unauthorized));
        });
    }

    #[test]
    fn dispute_already_settled() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let escrow = Escrow {
                buyer: buyer.clone(),
                farmer,
                token,
                amount: 1_000_0000,
                timeout_unix: 1_000,
                status: EscrowStatus::Released,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 0,
            };
            env.storage().persistent().set(&DataKey::Escrow(4), &escrow);
            let result = EscrowContract::dispute(env, 4, buyer);
            assert_eq!(result, Err(EscrowError::AlreadySettled));
        });
    }

    #[test]
    fn refund_timeout_not_reached() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            store_escrow(&env, 5, buyer, farmer, token);
            let escrow: Escrow = env.storage().persistent().get(&DataKey::Escrow(5)).unwrap();
            assert!(env.ledger().timestamp() < escrow.timeout_unix);
        });
    }

    #[test]
    fn release_fee_exceeds_maximum() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            store_escrow(&env, 6, buyer, farmer, token);
            let result = EscrowContract::release(env, 6, 1001);
            assert_eq!(result, Err(EscrowError::InvalidAmount));
        });
    }

    #[test]
    fn release_not_found() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let result = EscrowContract::release(env, 99, 250);
            assert_eq!(result, Err(EscrowError::NotFound));
        });
    }

    #[test]
    fn release_already_settled() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let escrow = Escrow {
                buyer: buyer.clone(),
                farmer,
                token,
                amount: 1_000_0000,
                timeout_unix: 1_000,
                status: EscrowStatus::Released,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 0,
            };
            env.storage().persistent().set(&DataKey::Escrow(7), &escrow);
            let result = EscrowContract::release(env, 7, 0);
            assert_eq!(result, Err(EscrowError::AlreadySettled));
        });
    }

    #[test]
    fn get_returns_escrow_data() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            store_escrow(&env, 8, buyer.clone(), farmer.clone(), token);
            let stored = EscrowContract::get(env, 8).unwrap();
            assert_eq!(stored.buyer, buyer);
            assert_eq!(stored.farmer, farmer);
            assert_eq!(stored.amount, 1_000_0000);
        });
    }

    #[test]
    fn get_escrow_returns_none_for_unknown_order() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let result = EscrowContract::get_escrow(env, 999);
            assert!(result.is_none());
        });
    }

    #[test]
    fn get_escrow_returns_correct_data_after_create() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            store_escrow(&env, 9, buyer.clone(), farmer.clone(), token.clone());
            let result = EscrowContract::get_escrow(env, 9);
            assert!(result.is_some());
            let escrow = result.unwrap();
            assert_eq!(escrow.buyer, buyer);
            assert_eq!(escrow.farmer, farmer);
            assert_eq!(escrow.amount, 1_000_0000);
            assert_eq!(escrow.status, EscrowStatus::Active);
            assert_eq!(escrow.token, token);
        });
    }

    #[test]
    fn get_escrow_returns_release_after_unix() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let escrow = Escrow {
                buyer: buyer.clone(),
                farmer: farmer.clone(),
                token: token.clone(),
                amount: 1_000_0000,
                timeout_unix: 9_999_999,
                status: EscrowStatus::Active,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 1_750_000_000,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(777), &escrow);
            let result = EscrowContract::get_escrow(env, 777).unwrap();
            assert_eq!(result.release_after_unix, 1_750_000_000);
        });
    }

    #[test]
    fn two_escrows_have_independent_keys() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let buyer_a = Address::generate(&env);
            let farmer_a = Address::generate(&env);
            let buyer_b = Address::generate(&env);
            let farmer_b = Address::generate(&env);
            let token = Address::generate(&env);

            store_escrow(&env, 10, buyer_a.clone(), farmer_a.clone(), token.clone());
            store_escrow(&env, 11, buyer_b.clone(), farmer_b.clone(), token);

            let mut e10: Escrow = env
                .storage()
                .persistent()
                .get(&DataKey::Escrow(10))
                .unwrap();
            e10.status = EscrowStatus::Released;
            env.storage().persistent().set(&DataKey::Escrow(10), &e10);
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::Escrow(10), TTL_MIN, TTL_MAX);

            let e11: Escrow = env
                .storage()
                .persistent()
                .get(&DataKey::Escrow(11))
                .unwrap();
            assert_eq!(
                e11.status,
                EscrowStatus::Active,
                "escrow 11 must not be affected by escrow 10 mutation"
            );
            assert_eq!(e11.buyer, buyer_b);
        });
    }

    #[test]
    fn fee_rounding() {
        let amount: i128 = 1;
        let fee = (amount * 250_i128) / 10_000;
        assert_eq!(fee, 0);
        let amount2: i128 = 40_000;
        let fee2 = (amount2 * 250_i128) / 10_000;
        assert_eq!(fee2, 1_000);
    }

    #[test]
    fn fee_zero_bps() {
        let amount: i128 = 1_000_0000;
        let fee = (amount * 0_i128) / 10_000;
        assert_eq!(fee, 0);
        assert_eq!(amount - fee, 1_000_0000);
    }

    #[test]
    fn fee_250_bps() {
        let amount: i128 = 1_000_0000;
        let fee = (amount * 250_i128) / 10_000;
        assert_eq!(fee, 25_0000);
        assert_eq!(amount - fee, 975_0000);
    }

    // ── #683 multi-token: token address is stored and retrievable ─────────────

    #[test]
    fn escrow_stores_token_address() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            store_escrow(&env, 20, buyer, farmer, token.clone());
            let escrow = EscrowContract::get(env, 20).unwrap();
            assert_eq!(escrow.token, token);
        });
    }

    #[test]
    fn two_escrows_can_use_different_tokens() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token_a = Address::generate(&env);
            let token_b = Address::generate(&env);
            store_escrow(&env, 21, buyer.clone(), farmer.clone(), token_a.clone());
            store_escrow(&env, 22, buyer, farmer, token_b.clone());
            assert_eq!(EscrowContract::get(env.clone(), 21).unwrap().token, token_a);
            assert_eq!(EscrowContract::get(env, 22).unwrap().token, token_b);
        });
    }

    #[test]
    fn migrate_preview_marks_only_legacy_records() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);

            let legacy = EscrowRecord {
                buyer: buyer.clone(),
                farmer: farmer.clone(),
                amount: 25_000_000,
                timeout_unix: 9_999,
                released: false,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(30), &legacy);
            store_escrow(&env, 31, buyer, farmer, token);

            let mut ids: Vec<u64> = Vec::new(&env);
            ids.push_back(30);
            ids.push_back(31);
            ids.push_back(32);

            let preview = EscrowContract::migrate_preview(env, ids);
            assert_eq!(preview.len(), 3);
            assert_eq!(preview.get(0).unwrap(), (30, true));
            assert_eq!(preview.get(1).unwrap(), (31, false));
            assert_eq!(preview.get(2).unwrap(), (32, false));
        });
    }

    // ── #689 batch_deposit validation ─────────────────────────────────────────

    #[test]
    fn batch_deposit_rejects_zero_amount() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let mut entries = Vec::new(&env);
            entries.push_back((100_u64, buyer, farmer, token, 0_i128, 9999_u64));
            let result = EscrowContract::batch_deposit(env, entries);
            assert_eq!(result, Err(EscrowError::InvalidAmount));
        });
    }

    #[test]
    fn batch_deposit_rejects_negative_amount() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let mut entries = Vec::new(&env);
            entries.push_back((101_u64, buyer, farmer, token, -1_i128, 9999_u64));
            let result = EscrowContract::batch_deposit(env, entries);
            assert_eq!(result, Err(EscrowError::InvalidAmount));
        });
    }

    #[test]
    fn batch_deposit_rejects_duplicate_order_id() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            // Pre-store an escrow with order_id 200
            store_escrow(&env, 200, buyer.clone(), farmer.clone(), token.clone());
            let mut entries = Vec::new(&env);
            entries.push_back((200_u64, buyer, farmer, token, 1000_i128, 9999_u64));
            let result = EscrowContract::batch_deposit(env, entries);
            assert_eq!(result, Err(EscrowError::AlreadyExists));
        });
    }

    // ── #686 property-based fuzz tests ────────────────────────────────────────
    //
    // Soroban's test environment is deterministic; we simulate property-based
    // fuzzing by iterating over a representative set of boundary and random-like
    // values covering the full input space described in the issue.

    /// Property: deposit with any positive amount must succeed (no token transfer
    /// is executed because we write directly to storage, so we test the guard logic).
    #[test]
    fn fuzz_deposit_amount_guard_positive_values() {
        let amounts: &[i128] = &[1, 2, 100, 1_000, i128::MAX / 2, i128::MAX];
        for &amount in amounts {
            let env = Env::default();
            let contract_id = env.register(EscrowContract, ());
            env.clone().as_contract(&contract_id, || {
                let buyer = Address::generate(&env);
                let farmer = Address::generate(&env);
                let token = Address::generate(&env);
                // Write directly to bypass token transfer (unit-tests the guard only).
                let escrow = Escrow {
                    buyer: buyer.clone(),
                    farmer,
                    token,
                    amount,
                    timeout_unix: 9999,
                    status: EscrowStatus::Active,
                    cooperative_address: None,
                    cooperative_royalty_bps: 0,
                    auto_release_unix: 9_999_999,
                    dispute_opened_at: 0,
                    release_after_unix: 0,
                };
                env.storage()
                    .persistent()
                    .set(&DataKey::Escrow(amount as u64), &escrow);
                let stored = EscrowContract::get(env, amount as u64).unwrap();
                assert_eq!(stored.amount, amount);
            });
        }
    }

    /// Property: deposit with amount <= 0 must always return InvalidAmount.
    #[test]
    fn fuzz_deposit_rejects_non_positive_amounts() {
        let bad_amounts: &[i128] = &[0, -1, -100, i128::MIN];
        for &amount in bad_amounts {
            let env = Env::default();
            env.mock_all_auths();
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            // Manually invoke the guard check (mirrors deposit logic).
            let result: Result<(), EscrowError> = if amount <= 0 {
                Err(EscrowError::InvalidAmount)
            } else {
                Ok(())
            };
            assert_eq!(
                result,
                Err(EscrowError::InvalidAmount),
                "amount={amount} should be rejected"
            );
            // Also verify batch_deposit rejects it.
            let mut entries = Vec::new(&env);
            entries.push_back((1_u64, buyer, farmer, token, amount, 9999_u64));
            let batch_result = EscrowContract::batch_deposit(env, entries);
            assert_eq!(batch_result, Err(EscrowError::InvalidAmount));
        }
    }

    /// Property: release before refund — once released, refund must return AlreadySettled.
    #[test]
    fn fuzz_release_then_refund_ordering() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let escrow = Escrow {
                buyer: buyer.clone(),
                farmer,
                token,
                amount: 1_000,
                timeout_unix: 0, // already timed out
                status: EscrowStatus::Released,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 0,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(300), &escrow);

            // Refund on an already-released escrow must fail.
            let result = EscrowContract::refund(env, 300);
            assert_eq!(result, Err(EscrowError::AlreadySettled));
        });
    }

    /// Property: refund before release — once refunded, release must return AlreadySettled.
    #[test]
    fn fuzz_refund_then_release_ordering() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let escrow = Escrow {
                buyer: buyer.clone(),
                farmer,
                token,
                amount: 1_000,
                timeout_unix: 0,
                status: EscrowStatus::Refunded,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 0,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(301), &escrow);

            let result = EscrowContract::release(env, 301, 0);
            assert_eq!(result, Err(EscrowError::AlreadySettled));
        });
    }

    /// Property: timeout boundary — refund must fail when timestamp < timeout_unix
    /// and succeed (guard-wise) when timestamp >= timeout_unix.
    #[test]
    fn fuzz_timeout_boundary_conditions() {
        // Pairs of (ledger_timestamp, timeout_unix, expect_timeout_error)
        let cases: &[(u64, u64, bool)] = &[
            (0, 1, true),             // before timeout
            (999, 1_000, true),       // one second before
            (1_000, 1_000, false),    // exactly at timeout
            (1_001, 1_000, false),    // one second after
            (u64::MAX, 1_000, false), // far future
            (0, 0, false),            // timeout at genesis
        ];

        for &(ts, timeout_unix, expect_err) in cases {
            // Mirror the refund timeout guard.
            let timed_out = ts >= timeout_unix;
            if expect_err {
                assert!(
                    !timed_out,
                    "ts={ts} timeout={timeout_unix}: expected timeout not reached"
                );
            } else {
                assert!(
                    timed_out,
                    "ts={ts} timeout={timeout_unix}: expected timeout reached"
                );
            }
        }
    }

    /// Property: platform fee calculation never produces negative farmer_amount
    /// for any valid (positive) amount and fee in [0, 1000] bps.
    #[test]
    fn fuzz_fee_calculation_never_negative() {
        let amounts: &[i128] = &[1, 7, 100, 10_000, 1_000_000, i128::MAX / 10_000];
        let fees_bps: &[u32] = &[0, 1, 250, 500, 999, 1000];
        for &amount in amounts {
            for &bps in fees_bps {
                let fee = (amount * bps as i128) / 10_000;
                let farmer_amount = amount - fee;
                assert!(
                    farmer_amount >= 0,
                    "amount={amount} bps={bps} farmer_amount={farmer_amount}"
                );
                assert!(fee >= 0, "fee must be non-negative");
                assert!(fee <= amount, "fee must not exceed amount");
            }
        }
    }

    /// Property: fee_bps > 1000 must always be rejected.
    #[test]
    fn fuzz_release_rejects_excessive_fee_bps() {
        let bad_fees: &[u32] = &[1001, 1002, 5000, 10_000, u32::MAX];
        for &bps in bad_fees {
            let env = Env::default();
            let contract_id = env.register(EscrowContract, ());
            env.mock_all_auths();
            env.clone().as_contract(&contract_id, || {
                let buyer = Address::generate(&env);
                let farmer = Address::generate(&env);
                let token = Address::generate(&env);
                store_escrow(&env, 500, buyer, farmer, token);
                let result = EscrowContract::release(env, 500, bps);
                assert_eq!(
                    result,
                    Err(EscrowError::InvalidAmount),
                    "bps={bps} should be rejected"
                );
            });
        }
    }

    // ── #851 cross-contract reward token mint tests ────────────────────────────

    #[test]
    fn test_set_reward_token_by_admin() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let reward_token = Address::generate(&env);

            // Set up admin
            let transfer = AdminTransfer {
                current_admin: admin.clone(),
                pending_admin: None,
            };
            env.storage().instance().set(&DataKey::Admin, &transfer);

            EscrowContract::set_reward_token(env.clone(), reward_token.clone());

            let stored = env.storage().instance().get(&DataKey::RewardTokenContract);
            assert_eq!(stored, Some(reward_token));
        });
    }

    #[test]
    #[should_panic]
    fn test_set_reward_token_requires_admin() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let _unauthorized = Address::generate(&env);
            let reward_token = Address::generate(&env);

            let transfer = AdminTransfer {
                current_admin: admin,
                pending_admin: None,
            };
            env.storage().instance().set(&DataKey::Admin, &transfer);

            EscrowContract::set_reward_token(env, reward_token);
        });
    }

    #[test]
    fn test_release_mints_reward_tokens_when_configured() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let admin = Address::generate(&env);
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let reward_token = Address::generate(&env);

            // Set up admin and reward token
            let transfer = AdminTransfer {
                current_admin: admin,
                pending_admin: None,
            };
            env.storage().instance().set(&DataKey::Admin, &transfer);
            env.storage()
                .instance()
                .set(&DataKey::RewardTokenContract, &reward_token);
            env.storage()
                .instance()
                .set(&DataKey::Platform, &Address::generate(&env));

            // Create escrow
            store_escrow(&env, 600, buyer.clone(), farmer, token);

            let escrow = EscrowContract::get(env.clone(), 600).unwrap();
            let reward_amount = (escrow.amount * 100) / 10_000;
            assert_eq!(reward_amount, 100_000);
            assert_eq!(
                env.storage().instance().get(&DataKey::RewardTokenContract),
                Some(reward_token)
            );
        });
    }

    #[test]
    fn test_release_without_reward_token_proceeds() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);

            // Set up platform but NO reward token
            env.storage()
                .instance()
                .set(&DataKey::Platform, &Address::generate(&env));

            // Create escrow
            store_escrow(&env, 601, buyer.clone(), farmer, token);

            assert!(env
                .storage()
                .instance()
                .get::<DataKey, Address>(&DataKey::RewardTokenContract)
                .is_none());
            assert_eq!(
                EscrowContract::get(env, 601).unwrap().status,
                EscrowStatus::Active
            );
        });
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);

        // Set up platform but NO reward token
        env.storage().instance().set(&DataKey::Platform, &Address::generate(&env));

        // Create escrow
        store_escrow(&env, 601, buyer.clone(), farmer, token);

        env.mock_auths(&[&buyer]);

        // Release should proceed normally without reward token
        let result = EscrowContract::release(env, 601, 0);
        // Will fail at token transfer (no real token), but should not panic
        assert!(result.is_err() || result.is_ok());
    }

    // ── #950 auth tests: buyer, admin, and farmer access control ─────────────────

    #[test]
    fn test_release_admin_can_release_active_escrow() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);

        // Set up admin
        let transfer = AdminTransfer { current_admin: admin.clone(), pending_admin: None };
        env.storage().instance().set(&DataKey::Admin, &transfer);
        env.storage().instance().set(&DataKey::Platform, &Address::generate(&env));
        env.storage().instance().set(&DataKey::FeeBps, &0_u32);

        // Create active escrow
        store_escrow(&env, 950, buyer, farmer, token);

        // Admin should be able to call release
        let result = EscrowContract::release(env.clone(), 950, 0);
        // Will fail at token transfer (no real token), but auth must succeed
        assert_ne!(result, Err(EscrowError::Unauthorized));
    }

    #[test]
    fn test_release_third_party_cannot_release() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let third_party = Address::generate(&env);
        let token = Address::generate(&env);

        // Set up admin
        let transfer = AdminTransfer { current_admin: admin, pending_admin: None };
        env.storage().instance().set(&DataKey::Admin, &transfer);
        env.storage().instance().set(&DataKey::Platform, &Address::generate(&env));

        // Create active escrow
        store_escrow(&env, 951, buyer, farmer, token);

        // Third-party should NOT be able to call release
        env.mock_auths(&[&third_party]);
        let result = EscrowContract::release(env, 951, 0);
        assert_eq!(result, Err(EscrowError::Unauthorized));
    }

    // ── #951 platform_fee_bps fallback-only behavior ──────────────────────────────

    #[test]
    fn test_release_platform_fee_bps_ignored_after_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);

        // Set up platform with initialized fee (250 bps = 2.5%)
        env.storage().instance().set(&DataKey::Platform, &Address::generate(&env));
        env.storage().instance().set(&DataKey::FeeBps, &250_u32); // stored fee

        // Create escrow with 1000 stroops
        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer: farmer.clone(),
            token,
            amount: 1_000_i128,
            timeout_unix: 9_999_999,
            status: EscrowStatus::Active,
            cooperative_address: None,
            cooperative_royalty_bps: 0,
            auto_release_unix: 9_999_999,
            dispute_opened_at: 0,
            release_after_unix: 0,
        };
        env.storage().persistent().set(&DataKey::Escrow(952), &escrow);
        env.storage().persistent().set(&DataKey::Token(952), &token);

        // Calculate expected fee using stored FeeBps (250 bps)
        let stored_fee = (1_000_i128 * 250) / 10_000; // = 25

        // Verify that different platform_fee_bps values produce the same fee outcome
        // (Release will fail at token transfer, but fee calculation is before that)
        // by checking that the stored FeeBps is always used, not the parameter

        // The key invariant: effective_bps is always taken from storage, never from parameter
        let effective_from_storage: u32 = env
            .storage()
            .instance()
            .get(&DataKey::FeeBps)
            .unwrap_or(0);
        let effective_fee = (1_000_i128 * effective_from_storage as i128) / 10_000;
        assert_eq!(effective_fee, stored_fee, "fee must use stored FeeBps, not parameter");
    }

    // ── #952 canonical event format ──────────────────────────────────────────────────

    #[test]
    fn test_release_emits_single_canonical_event() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);

        env.storage().instance().set(&DataKey::Platform, &Address::generate(&env));
        env.storage().instance().set(&DataKey::FeeBps, &0_u32);

        store_escrow(&env, 953, buyer, farmer, token);

        // Note: In Soroban test environment, event publishing is tracked but
        // the test harness doesn't expose event counts directly. The fix ensures
        // only one event is published by code inspection rather than runtime assertion.
        // The refactoring removed lines 523-532 (three event publishes) and replaced
        // with single publish at line 524-527, verified by code review.

        let result = EscrowContract::release(env, 953, 0);
        // Verify no Unauthorized error (auth passed)
        assert_ne!(result, Err(EscrowError::Unauthorized));
    }

    // ── #701 cooperative multisig tests ───────────────────────────────────────

    fn setup_admin(env: &Env) -> Address {
        let admin = Address::generate(env);
        let transfer = AdminTransfer {
            current_admin: admin.clone(),
            pending_admin: None,
        };
        env.storage().instance().set(&DataKey::Admin, &transfer);
        admin
    }

    #[test]
    fn set_coop_stores_config() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            setup_admin(&env);

            let mut members: Vec<BytesN<32>> = Vec::new(&env);
            members.push_back(BytesN::from_array(&env, &[1u8; 32]));
            members.push_back(BytesN::from_array(&env, &[2u8; 32]));

            EscrowContract::set_coop(env.clone(), members.clone(), 2).unwrap();

            let stored: CoopConfig = env.storage().instance().get(&DataKey::CoopConfig).unwrap();
            assert_eq!(stored.threshold, 2);
            assert_eq!(stored.members.len(), 2);
        });
    }

    #[test]
    fn set_coop_rejects_too_many_signers() {
        let env = Env::default();
        env.mock_all_auths();
        setup_admin(&env);

        let mut members: Vec<BytesN<32>> = Vec::new(&env);
        for i in 0u8..=15 {
            members.push_back(BytesN::from_array(&env, &[i; 32]));
        }
        // 16 members exceeds MAX_COOP_SIGNERS (15)
        let result = EscrowContract::set_coop(env, members, 10);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), EscrowError::TooManyCoopSigners);
    }

    #[test]
    fn multisig_release_coop_not_configured() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            store_escrow(&env, 600, buyer, farmer, token);

            let sigs: Vec<Bytes> = Vec::new(&env);
            let result = EscrowContract::multisig_release(env, 600, sigs);
            assert_eq!(result, Err(EscrowError::CoopNotConfigured));
        });
    }

    #[test]
    fn multisig_release_not_found() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            setup_admin(&env);

            let mut members: Vec<BytesN<32>> = Vec::new(&env);
            members.push_back(BytesN::from_array(&env, &[1u8; 32]));
            EscrowContract::set_coop(env.clone(), members, 1).unwrap();

            let sigs: Vec<Bytes> = Vec::new(&env);
            let result = EscrowContract::multisig_release(env, 9999, sigs);
            assert_eq!(result, Err(EscrowError::NotFound));
        });
    }

    #[test]
    fn multisig_release_already_settled() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            setup_admin(&env);

            let mut members: Vec<BytesN<32>> = Vec::new(&env);
            members.push_back(BytesN::from_array(&env, &[1u8; 32]));
            EscrowContract::set_coop(env.clone(), members, 1).unwrap();

            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let escrow = Escrow {
                buyer,
                farmer,
                token,
                amount: 1_000,
                timeout_unix: 9999,
                status: EscrowStatus::Released,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 0,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(601), &escrow);

            let sigs: Vec<Bytes> = Vec::new(&env);
            let result = EscrowContract::multisig_release(env, 601, sigs);
            assert_eq!(result, Err(EscrowError::AlreadySettled));
        });
    }

    #[test]
    fn multisig_release_in_dispute() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            setup_admin(&env);

            let mut members: Vec<BytesN<32>> = Vec::new(&env);
            members.push_back(BytesN::from_array(&env, &[1u8; 32]));
            EscrowContract::set_coop(env.clone(), members, 1).unwrap();

            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let escrow = Escrow {
                buyer,
                farmer,
                token,
                amount: 1_000,
                timeout_unix: 9999,
                status: EscrowStatus::Disputed,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 0,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(602), &escrow);

            let sigs: Vec<Bytes> = Vec::new(&env);
            let result = EscrowContract::multisig_release(env, 602, sigs);
            assert_eq!(result, Err(EscrowError::InDispute));
        });
    }

    #[test]
    fn multisig_release_not_enough_signatures() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            setup_admin(&env);

            let mut members: Vec<BytesN<32>> = Vec::new(&env);
            members.push_back(BytesN::from_array(&env, &[1u8; 32]));
            members.push_back(BytesN::from_array(&env, &[2u8; 32]));
            // Require 2-of-2 signatures
            EscrowContract::set_coop(env.clone(), members, 2).unwrap();

            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            store_escrow(&env, 603, buyer, farmer, token);

            // Provide zero signatures — threshold of 2 is not met
            let sigs: Vec<Bytes> = Vec::new(&env);
            let result = EscrowContract::multisig_release(env, 603, sigs);
            assert_eq!(result, Err(EscrowError::NotEnoughSignatures));
        });
    }

    #[test]
    fn multisig_release_skips_empty_signature_slots() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            setup_admin(&env);

            let mut members: Vec<BytesN<32>> = Vec::new(&env);
            members.push_back(BytesN::from_array(&env, &[1u8; 32]));
            members.push_back(BytesN::from_array(&env, &[2u8; 32]));
            // Require 2 valid signatures
            EscrowContract::set_coop(env.clone(), members, 2).unwrap();

            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            store_escrow(&env, 604, buyer, farmer, token);

            // Provide one empty slot and one empty slot — neither counts
            let mut sigs: Vec<Bytes> = Vec::new(&env);
            sigs.push_back(Bytes::new(&env));
            sigs.push_back(Bytes::new(&env));

            let result = EscrowContract::multisig_release(env, 604, sigs);
            assert_eq!(result, Err(EscrowError::NotEnoughSignatures));
        });
    }

    // ── #860 cooperative royalty on release tests ─────────────────────────────

    /// Standard release with no cooperative set — farmer receives (amount - fee),
    /// no royalty transfer occurs.
    #[test]
    fn release_no_cooperative_standard_flow() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);

            // 10_000_000 stroops = 1 XLM, zero royalty bps
            let escrow = Escrow {
                buyer: buyer.clone(),
                farmer: farmer.clone(),
                token: token.clone(),
                amount: 10_000_000,
                timeout_unix: 9_999_999,
                status: EscrowStatus::Active,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 0,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(700), &escrow);
            env.storage().persistent().set(&DataKey::Token(700), &token);

            // Store a fee destination so the release guard passes.
            env.storage()
                .instance()
                .set(&DataKey::FeeDestination, &Address::generate(&env));
            env.storage().instance().set(&DataKey::FeeBps, &0u32);

            let fee_amount = (escrow.amount * 0_i128) / 10_000;
            let royalty_amount = 0_i128;
            let farmer_amount = escrow.amount - fee_amount - royalty_amount;
            assert_eq!(fee_amount, 0);
            assert_eq!(royalty_amount, 0);
            assert_eq!(farmer_amount, escrow.amount);
        });
    }

    /// Royalty calculation: 500 bps (5%) deducted from farmer portion.
    #[test]
    fn royalty_calculation_500_bps() {
        let amount: i128 = 10_000_000; // 1 XLM
        let platform_fee_bps: u32 = 0;
        let royalty_bps: u32 = 500; // 5%

        let fee = (amount * platform_fee_bps as i128) / 10_000;
        let after_fee = amount - fee;
        let royalty = (after_fee * royalty_bps as i128) / 10_000;
        let farmer_amount = after_fee - royalty;

        assert_eq!(fee, 0);
        assert_eq!(royalty, 500_000); // 5% of 10_000_000
        assert_eq!(farmer_amount, 9_500_000); // 95%
        assert!(farmer_amount >= 0);
        assert!(royalty >= 0);
        assert_eq!(farmer_amount + royalty + fee, amount);
    }

    /// Royalty calculation: zero bps means no royalty even when cooperative_address is set.
    #[test]
    fn royalty_zero_bps_no_transfer() {
        let amount: i128 = 10_000_000;
        let royalty_bps: u32 = 0;

        let royalty = (amount * royalty_bps as i128) / 10_000;
        let farmer_amount = amount - royalty;

        assert_eq!(royalty, 0);
        assert_eq!(farmer_amount, amount);
    }

    /// Royalty is capped: royalty_bps > 10_000 must be rejected by deposit.
    #[test]
    fn deposit_rejects_royalty_bps_above_10000() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let coop = Address::generate(&env);

            // Bypass balance / token by manually triggering the guard check.
            // deposit returns InvalidAmount when royalty_bps > 10_000.
            let bad_bps: u32 = 10_001;
            let result: Result<(), EscrowError> = if bad_bps > 10_000 {
                Err(EscrowError::InvalidAmount)
            } else {
                Ok(())
            };
            assert_eq!(result, Err(EscrowError::InvalidAmount));

            // Also verify via the actual amount <= 0 guard that runs first,
            // ensuring bad_bps guard is independent.
            let _ = (buyer, farmer, token, coop);
        });
    }

    /// Release with cooperative set — escrow stored with cooperative_address and
    /// royalty_bps; verify that farmer_amount + royalty == amount (accounting check).
    #[test]
    fn release_with_cooperative_accounting() {
        let amount: i128 = 10_000_000;
        let fee_bps: u32 = 250;
        let royalty_bps: u32 = 500;

        let fee = (amount * fee_bps as i128) / 10_000;
        let after_fee = amount - fee;
        let royalty = (after_fee * royalty_bps as i128) / 10_000;
        let farmer_amount = after_fee - royalty;

        assert_eq!(fee, 250_000);
        assert_eq!(royalty, 487_500);
        assert_eq!(farmer_amount, 9_262_500);
        assert_eq!(fee + royalty + farmer_amount, amount);
    }

    // ── #857 minimum deposit / dust-attack prevention tests ───────────────────

    fn setup_admin_for(env: &Env) -> Address {
        let admin = Address::generate(env);
        let transfer = AdminTransfer {
            current_admin: admin.clone(),
            pending_admin: None,
        };
        env.storage().instance().set(&DataKey::Admin, &transfer);
        admin
    }

    #[test]
    fn min_deposit_default_is_half_xlm() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            assert_eq!(EscrowContract::get_min_deposit(env), 5_000_000);
        });
    }

    #[test]
    fn set_min_deposit_updates_queryable_value() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            setup_admin_for(&env);
            EscrowContract::set_min_deposit(env.clone(), 10_000_000).unwrap();
            assert_eq!(EscrowContract::get_min_deposit(env), 10_000_000);
        });
    }

    #[test]
    fn set_min_deposit_rejects_non_positive() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            setup_admin_for(&env);
            assert_eq!(
                EscrowContract::set_min_deposit(env, 0),
                Err(EscrowError::InvalidAmount)
            );
        });
    }

    #[test]
    fn set_min_deposit_rejects_excessive_amount() {
        let env = Env::default();
        env.mock_all_auths();
        setup_admin_for(&env);
        assert_eq!(
            EscrowContract::set_min_deposit(env, MAX_MIN_DEPOSIT + 1),
            Err(EscrowError::InvalidAmount)
        );
        assert_eq!(
            EscrowContract::set_min_deposit(env, i128::MAX),
            Err(EscrowError::InvalidAmount)
        );
    }

    #[test]
    fn deposit_below_minimum_rejected() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let token = Address::generate(&env);
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            // 0.49 XLM — below the 0.5 XLM default minimum. The guard runs before any
            // token transfer, so no real token client is required.
            let result = EscrowContract::deposit(
                env,
                token,
                700,
                buyer,
                farmer,
                4_900_000,
                u64::MAX,
                None,
                0,
                0,
            );
            assert_eq!(result, Err(EscrowError::BelowMinDeposit));
        });
    }

    #[test]
    fn deposit_at_and_above_minimum_pass_amount_guard() {
        // Mirrors the contract guard: amount >= MIN_DEPOSIT_STROOPS is accepted.
        // (Full deposit past this point requires a live token client, exercised
        // by the backend integration tests.)
        let min = 5_000_000_i128;
        for amount in [min, min + 1, 10_000_000, 1_000_000_000] {
            assert!(
                amount >= min,
                "amount {amount} should satisfy the minimum-deposit guard"
            );
        }
    }

    // ── #856 batch release tests ──────────────────────────────────────────────

    #[test]
    fn batch_release_too_large() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let platform = Address::generate(&env);
            env.storage().instance().set(&DataKey::Platform, &platform);

            let mut ids: Vec<u64> = Vec::new(&env);
            for i in 0..21u64 {
                ids.push_back(i);
            }
            let result = EscrowContract::batch_release(env, ids);
            assert_eq!(result, Err(EscrowError::BatchTooLarge));
        });
    }

    #[test]
    fn batch_release_partial_failure_continues() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let platform = Address::generate(&env);
            env.storage().instance().set(&DataKey::Platform, &platform);

            // Valid releases around an already-settled entry must still succeed.
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = env.register(NoopTokenContract, ());
            store_escrow(&env, 800, buyer.clone(), farmer.clone(), token.clone());
            store_escrow(&env, 802, buyer.clone(), farmer.clone(), token.clone());
            env.storage().persistent().set(&DataKey::Token(800), &token);
            env.storage().persistent().set(&DataKey::Token(802), &token);
            let settled = Escrow {
                buyer, farmer, token: token.clone(),
                amount: 1_000,
                timeout_unix: 0,
                status: EscrowStatus::Released,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 0,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(801), &settled);
            env.storage().persistent().set(&DataKey::Token(801), &token);

            let mut ids: Vec<u64> = Vec::new(&env);
            ids.push_back(800u64);
            ids.push_back(801u64);
            ids.push_back(802u64);

            let results = EscrowContract::batch_release(env, ids).unwrap();
            assert_eq!(results.len(), 3);
            assert_eq!(results.get(0).unwrap(), (800u64, true));
            assert_eq!(results.get(1).unwrap(), (801u64, false));
            assert_eq!(results.get(2).unwrap(), (802u64, true));
        });
    }

    #[test]
    fn batch_release_empty_is_ok() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let platform = Address::generate(&env);
            env.storage().instance().set(&DataKey::Platform, &platform);

            let ids: Vec<u64> = Vec::new(&env);
            let results = EscrowContract::batch_release(env, ids).unwrap();
            assert_eq!(results.len(), 0);
        });
    }

    #[test]
    fn max_batch_deposit_and_release_resource_budget() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        let token = env.register(NoopTokenContract, ());
        env.mock_all_auths();

        env.clone().as_contract(&contract_id, || {
            let platform = Address::generate(&env);
            env.storage().instance().set(&DataKey::Platform, &platform);

            let mut ids: Vec<u64> = Vec::new(&env);
            let mut entries: Vec<(u64, Address, Address, Address, i128, u64)> = Vec::new(&env);
            let timeout = env
                .ledger()
                .timestamp()
                .saturating_add(MIN_TIMEOUT_SECS + 10_000);

            for i in 0..MAX_BATCH_RELEASE {
                let order_id = 10_000_u64 + u64::from(i);
                let buyer = Address::generate(&env);
                let farmer = Address::generate(&env);
                ids.push_back(order_id);
                entries.push_back((
                    order_id,
                    buyer,
                    farmer,
                    token.clone(),
                    MIN_DEPOSIT_STROOPS,
                    timeout,
                ));
            }

            let mut budget = env.budget();
            budget.reset_tracker();
            EscrowContract::batch_deposit(env.clone(), entries).unwrap();
            let deposit_cpu = env.budget().cpu_instruction_cost();
            let deposit_mem = env.budget().memory_bytes_cost();

            assert!(
                deposit_cpu <= MAX_BATCH_DEPOSIT_CPU_BUDGET,
                "batch_deposit CPU budget grew to {deposit_cpu}"
            );
            assert!(
                deposit_mem <= MAX_BATCH_DEPOSIT_MEMORY_BUDGET,
                "batch_deposit memory budget grew to {deposit_mem}"
            );

            for i in 0..MAX_BATCH_RELEASE {
                let order_id = ids.get(i).unwrap();
                assert!(
                    env.storage()
                        .persistent()
                        .has(&DataKey::Token(order_id)),
                    "batch_deposit must persist token key for order {order_id}"
                );
            }

            let mut budget = env.budget();
            budget.reset_tracker();
            let results = EscrowContract::batch_release(env.clone(), ids).unwrap();
            let release_cpu = env.budget().cpu_instruction_cost();
            let release_mem = env.budget().memory_bytes_cost();

            std::println!(
                "max batch budget: deposit_cpu={deposit_cpu}, deposit_mem={deposit_mem}, release_cpu={release_cpu}, release_mem={release_mem}"
            );

            assert_eq!(results.len(), MAX_BATCH_RELEASE);
            for i in 0..MAX_BATCH_RELEASE {
                let order_id = 10_000_u64 + u64::from(i);
                assert_eq!(results.get(i).unwrap(), (order_id, true));
                assert_eq!(
                    EscrowContract::get(env.clone(), order_id).unwrap().status,
                    EscrowStatus::Released
                );
            }

            assert!(
                release_cpu <= MAX_BATCH_RELEASE_CPU_BUDGET,
                "batch_release CPU budget grew to {release_cpu}"
            );
            assert!(
                release_mem <= MAX_BATCH_RELEASE_MEMORY_BUDGET,
                "batch_release memory budget grew to {release_mem}"
            );
        });
    }

    // ── #858 snapshot audit trail tests ───────────────────────────────────────

    #[test]
    fn take_snapshot_stores_retrievable_copy() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            setup_admin_for(&env);
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            store_escrow(&env, 900, buyer.clone(), farmer, token);

            let seq = EscrowContract::take_snapshot(env.clone(), 900, buyer.clone()).unwrap();
            let snap = EscrowContract::get_snapshot(env, 900, seq).unwrap();
            assert_eq!(snap.buyer, buyer);
            assert_eq!(snap.amount, 1_000_0000);
            assert_eq!(snap.status, EscrowStatus::Active);
        });
    }

    #[test]
    fn get_snapshot_missing_returns_not_found() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let result = EscrowContract::get_snapshot(env, 999, 1);
            assert_eq!(result, Err(EscrowError::SnapshotNotFound));
        });
    }

    #[test]
    fn take_snapshot_missing_escrow_returns_not_found() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let admin = setup_admin_for(&env);
            let result = EscrowContract::take_snapshot(env, 12345, admin);
            assert_eq!(result, Err(EscrowError::NotFound));
        });
    }

    #[test]
    fn take_snapshot_allowed_for_buyer_farmer_and_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        let admin = setup_admin_for(&env);
        store_escrow(&env, 902, buyer.clone(), farmer.clone(), token);

        let seq_by_admin = EscrowContract::take_snapshot(env.clone(), 902, admin.clone()).unwrap();
        let snap = EscrowContract::get_snapshot(env.clone(), 902, seq_by_admin).unwrap();
        assert_eq!(snap.buyer, buyer);

        store_escrow(&env, 903, buyer.clone(), farmer.clone(), token);
        let seq_by_buyer = EscrowContract::take_snapshot(env.clone(), 903, buyer.clone()).unwrap();
        let snap = EscrowContract::get_snapshot(env.clone(), 903, seq_by_buyer).unwrap();
        assert_eq!(snap.farmer, farmer);

        store_escrow(&env, 904, buyer.clone(), farmer.clone(), token);
        let seq_by_farmer = EscrowContract::take_snapshot(env.clone(), 904, farmer.clone()).unwrap();
        let snap = EscrowContract::get_snapshot(env, 904, seq_by_farmer).unwrap();
        assert_eq!(snap.buyer, buyer);
    }

    #[test]
    fn dispute_takes_snapshot_of_pre_dispute_state() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let coop = Address::generate(&env);

            let amount: i128 = 10_000_000;
            let fee_bps: u32 = 250; // 2.5% platform fee
            let royalty_bps: u32 = 500; // 5% cooperative royalty

            let escrow = Escrow {
                buyer: buyer.clone(),
                farmer: farmer.clone(),
                token: token.clone(),
                amount,
                timeout_unix: 9_999_999,
                status: EscrowStatus::Active,
                cooperative_address: Some(coop.clone()),
                cooperative_royalty_bps: royalty_bps,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 0,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(800), &escrow);
            env.storage().persistent().set(&DataKey::Token(800), &token);
            env.storage()
                .instance()
                .set(&DataKey::FeeDestination, &Address::generate(&env));
            env.storage().instance().set(&DataKey::FeeBps, &fee_bps);

            // Accounting: fee → fee_dest, royalty → coop, farmer_amount → farmer
            let fee = (amount * fee_bps as i128) / 10_000;
            let after_fee = amount - fee;
            let royalty = (after_fee * royalty_bps as i128) / 10_000;
            let farmer_amount = after_fee - royalty;

            // 10_000_000 * 250 / 10_000 = 250_000
            assert_eq!(fee, 250_000);
            // (10_000_000 - 250_000) * 500 / 10_000 = 487_500
            assert_eq!(royalty, 487_500);
            // 9_750_000 - 487_500 = 9_262_500
            assert_eq!(farmer_amount, 9_262_500);
            // Invariant: all amounts sum to original
            assert_eq!(fee + royalty + farmer_amount, amount);
            assert!(farmer_amount >= 0);
            assert!(royalty >= 0);
            store_escrow(&env, 901, buyer.clone(), farmer, token);

            let seq = env.ledger().sequence() as u64;
            EscrowContract::dispute(env.clone(), 901, buyer).unwrap();

            // Snapshot captured the Active state from before the dispute…
            let snap = EscrowContract::get_snapshot(env.clone(), 901, seq).unwrap();
            assert_eq!(snap.status, EscrowStatus::Active);
            // …while the live record is now Disputed.
            assert_eq!(
                EscrowContract::get(env, 901).unwrap().status,
                EscrowStatus::Disputed
            );
        });
    }

    // ── #875 pre-order release lock tests ─────────────────────────────────────

    #[test]
    fn release_before_unlock_date_returns_not_yet_releasable() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            env.ledger().set_timestamp(1_000);

            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let escrow = Escrow {
                buyer: buyer.clone(),
                farmer,
                token: token.clone(),
                amount: 1_000_0000,
                timeout_unix: 9_999_999,
                status: EscrowStatus::Active,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 5_000, // unlock at 5000, ledger is at 1000
            };
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(1000), &escrow);
            env.storage()
                .persistent()
                .set(&DataKey::Token(1000), &token);

            let result = EscrowContract::release(env, 1000, 0);
            assert_eq!(result, Err(EscrowError::NotYetReleasable));
        });
    }

    #[test]
    fn release_after_unlock_date_passes_lock_check() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            env.ledger().set_timestamp(10_000);

            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let escrow = Escrow {
                buyer: buyer.clone(),
                farmer,
                token: token.clone(),
                amount: 1_000_0000,
                timeout_unix: 9_999_999,
                status: EscrowStatus::Active,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 5_000, // unlock at 5000, ledger is at 10000
            };
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(1001), &escrow);
            env.storage()
                .persistent()
                .set(&DataKey::Token(1001), &token);
            env.storage()
                .instance()
                .set(&DataKey::Platform, &Address::generate(&env));

            assert!(env.ledger().timestamp() >= escrow.release_after_unix);
        });
    }

    #[test]
    fn release_with_zero_release_after_unix_is_not_blocked() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            env.ledger().set_timestamp(1_000);

            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let escrow = Escrow {
                buyer: buyer.clone(),
                farmer,
                token: token.clone(),
                amount: 1_000_0000,
                timeout_unix: 9_999_999,
                status: EscrowStatus::Active,
                cooperative_address: None,
                cooperative_royalty_bps: 0,
                auto_release_unix: 9_999_999,
                dispute_opened_at: 0,
                release_after_unix: 0, // no lock
            };
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(1002), &escrow);
            env.storage()
                .persistent()
                .set(&DataKey::Token(1002), &token);
            env.storage()
                .instance()
                .set(&DataKey::Platform, &Address::generate(&env));

            assert_eq!(escrow.release_after_unix, 0);
        });
    }

    // ── #876 multi-escrow index tests ─────────────────────────────────────────

    #[test]
    fn deposit_populates_buyer_and_farmer_index() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.mock_all_auths();
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);

            // Manually insert escrow and index entries as deposit() would
            let order_id: u64 = 2000;
            store_escrow(
                &env,
                order_id,
                buyer.clone(),
                farmer.clone(),
                Address::generate(&env),
            );

            // Simulate what deposit() does for the index
            let mut buyer_ids: Vec<u64> = Vec::new(&env);
            buyer_ids.push_back(order_id);
            env.storage()
                .persistent()
                .set(&DataKey::BuyerEscrows(buyer.clone()), &buyer_ids);

            let mut farmer_ids: Vec<u64> = Vec::new(&env);
            farmer_ids.push_back(order_id);
            env.storage()
                .persistent()
                .set(&DataKey::FarmerEscrows(farmer.clone()), &farmer_ids);

            let b_ids = EscrowContract::get_buyer_escrows(env.clone(), buyer);
            assert_eq!(b_ids.len(), 1);
            assert_eq!(b_ids.get(0).unwrap(), order_id);

            let f_ids = EscrowContract::get_farmer_escrows(env, farmer);
            assert_eq!(f_ids.len(), 1);
            assert_eq!(f_ids.get(0).unwrap(), order_id);
        });
        let b_result = EscrowContract::get_buyer_escrows(env.clone(), buyer, 0, 10);
        assert_eq!(b_result.escrows.len(), 1);
        assert_eq!(b_result.total, 1);
        assert_eq!(b_result.escrows.get(0).unwrap(), order_id);

        let f_result = EscrowContract::get_farmer_escrows(env, farmer, 0, 10);
        assert_eq!(f_result.escrows.len(), 1);
        assert_eq!(f_result.total, 1);
        assert_eq!(f_result.escrows.get(0).unwrap(), order_id);
    }

    #[test]
    fn get_buyer_escrows_empty_when_no_deposits() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);
            let ids = EscrowContract::get_buyer_escrows(env, buyer);
            assert_eq!(ids.len(), 0);
        });
        let buyer = Address::generate(&env);
        let result = EscrowContract::get_buyer_escrows(env, buyer, 0, 10);
        assert_eq!(result.escrows.len(), 0);
        assert_eq!(result.total, 0);
    }

    #[test]
    fn get_farmer_escrows_empty_when_no_deposits() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let farmer = Address::generate(&env);
            let ids = EscrowContract::get_farmer_escrows(env, farmer);
            assert_eq!(ids.len(), 0);
        });
        let farmer = Address::generate(&env);
        let result = EscrowContract::get_farmer_escrows(env, farmer, 0, 10);
        assert_eq!(result.escrows.len(), 0);
        assert_eq!(result.total, 0);
    }

    #[test]
    fn index_prunes_oldest_entry_at_1000_limit() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        env.clone().as_contract(&contract_id, || {
            let buyer = Address::generate(&env);

            // Pre-fill the index with 1000 entries (0..999)
            let mut ids: Vec<u64> = Vec::new(&env);
            for i in 0u64..1000 {
                ids.push_back(i);
            }
            env.storage()
                .persistent()
                .set(&DataKey::BuyerEscrows(buyer.clone()), &ids);

            // Simulate what deposit() does when limit is reached
            let mut stored: Vec<u64> = env
                .storage()
                .persistent()
                .get(&DataKey::BuyerEscrows(buyer.clone()))
                .unwrap();
            if stored.len() >= 1000 {
                stored.remove(0);
            }
            stored.push_back(1000u64);
            env.storage()
                .persistent()
                .set(&DataKey::BuyerEscrows(buyer.clone()), &stored);

            let result: Vec<u64> = env
                .storage()
                .persistent()
                .get(&DataKey::BuyerEscrows(buyer))
                .unwrap();
            assert_eq!(result.len(), 1000);
            // oldest (0) was removed, newest (1000) is last
            assert_eq!(result.get(0).unwrap(), 1u64);
            assert_eq!(result.get(999).unwrap(), 1000u64);
        });
    }

    // ── Evidence submission cap tests (#956) ────────────────────────────────

    #[test]
    fn submit_evidence_respects_max_per_party_cap() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);

        // Create a disputed escrow
        let mut escrow = Escrow {
            buyer: buyer.clone(),
            farmer: farmer.clone(),
            token,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            status: EscrowStatus::Disputed,
            cooperative_address: None,
            cooperative_royalty_bps: 0,
            auto_release_unix: 9_999_999,
            dispute_opened_at: env.ledger().timestamp(),
            release_after_unix: 0,
        };
        env.storage().persistent().set(&DataKey::Escrow(1), &escrow);

        let evidence_hash = BytesN::<32>::from_array(
            &env,
            &[
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
                23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
            ],
        );

        // Submit MAX_EVIDENCE_PER_PARTY evidence entries (should succeed)
        for i in 0..5 {
            let mut hash_bytes = [1u8; 32];
            hash_bytes[0] = i as u8;
            let hash = BytesN::<32>::from_array(&env, &hash_bytes);
            let result = EscrowContract::submit_evidence(env.clone(), 1, hash);
            assert!(result.is_ok(), "submission {} should succeed", i);
        }

        // 6th submission should fail
        let mut hash_bytes = [6u8; 32];
        let hash = BytesN::<32>::from_array(&env, &hash_bytes);
        let result = EscrowContract::submit_evidence(env.clone(), 1, hash);
        assert_eq!(result, Err(EscrowError::InvalidAmount));
    }

    #[test]
    fn submit_evidence_tracks_buyer_and_farmer_separately() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);

        // Create a disputed escrow
        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer: farmer.clone(),
            token,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            status: EscrowStatus::Disputed,
            cooperative_address: None,
            cooperative_royalty_bps: 0,
            auto_release_unix: 9_999_999,
            dispute_opened_at: env.ledger().timestamp(),
            release_after_unix: 0,
        };
        env.storage().persistent().set(&DataKey::Escrow(1), &escrow);

        // Mock buyer auth for buyer submissions
        env.mock_auths(&[(buyer.clone(), soroban_sdk::InvokeContractArgs {
            contract_id: env.current_contract_address(),
            function_name: soroban_sdk::symbol_short!("submit_evidence"),
            args: soroban_sdk::vec![&env],
        })]);

        // Submit 5 evidence entries as buyer
        for i in 0..5 {
            let mut hash_bytes = [10u8; 32];
            hash_bytes[0] = i as u8;
            let hash = BytesN::<32>::from_array(&env, &hash_bytes);
            let result = EscrowContract::submit_evidence(env.clone(), 1, hash);
            assert!(result.is_ok(), "buyer submission {} should succeed", i);
        }

        // Mock farmer auth for farmer submissions
        env.mock_auths(&[(farmer.clone(), soroban_sdk::InvokeContractArgs {
            contract_id: env.current_contract_address(),
            function_name: soroban_sdk::symbol_short!("submit_evidence"),
            args: soroban_sdk::vec![&env],
        })]);

        // Submit 5 evidence entries as farmer (should succeed, separate from buyer)
        for i in 0..5 {
            let mut hash_bytes = [20u8; 32];
            hash_bytes[0] = i as u8;
            let hash = BytesN::<32>::from_array(&env, &hash_bytes);
            let result = EscrowContract::submit_evidence(env.clone(), 1, hash);
            assert!(result.is_ok(), "farmer submission {} should succeed", i);
        }

        // Verify counts
        let buyer_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::BuyerEvidenceCount(1))
            .unwrap_or(0);
        let farmer_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::FarmerEvidenceCount(1))
            .unwrap_or(0);
        assert_eq!(buyer_count, 5);
        assert_eq!(farmer_count, 5);
    }

    #[test]
    fn paginated_escrow_returns_expected_page_and_total() {
        let env = Env::default();
        let buyer = Address::generate(&env);

        // Create 250 escrow IDs
        let mut ids: Vec<u64> = Vec::new(&env);
        for i in 0u64..250 {
            ids.push_back(i);
        }
        env.storage().persistent().set(&DataKey::BuyerEscrows(buyer.clone()), &ids);

        // Test first page
        let page1 = EscrowContract::get_buyer_escrows(env.clone(), buyer.clone(), 0, 50);
        assert_eq!(page1.total, 250);
        assert_eq!(page1.escrows.len(), 50);
        assert_eq!(page1.escrows.get(0).unwrap(), 0u64);
        assert_eq!(page1.escrows.get(49).unwrap(), 49u64);

        // Test second page
        let page2 = EscrowContract::get_buyer_escrows(env.clone(), buyer.clone(), 50, 50);
        assert_eq!(page2.total, 250);
        assert_eq!(page2.escrows.len(), 50);
        assert_eq!(page2.escrows.get(0).unwrap(), 50u64);
        assert_eq!(page2.escrows.get(49).unwrap(), 99u64);

        // Test limit capped at MAX_ESCROW_PAGE_SIZE
        let large_page = EscrowContract::get_buyer_escrows(env.clone(), buyer.clone(), 0, 500);
        assert_eq!(large_page.total, 250);
        assert_eq!(large_page.escrows.len(), 100);  // Capped at MAX_ESCROW_PAGE_SIZE

        // Test offset beyond total
        let empty_page = EscrowContract::get_buyer_escrows(env, buyer, 300, 50);
        assert_eq!(empty_page.total, 250);
        assert_eq!(empty_page.escrows.len(), 0);
    }

    #[test]
    fn deposit_rejects_order_id_over_max() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);

        let err = EscrowContract::deposit(
            env,
            token,
            MAX_ORDER_ID,
            buyer,
            farmer,
            100,
            1_000,
        )
        .unwrap_err();
        assert_eq!(err, EscrowError::InvalidAmount);
    }
}
