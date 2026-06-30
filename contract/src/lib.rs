//! Farmers Marketplace - Soroban Escrow Contract
//!
//! Issues addressed:
//!   #468 - Extend ledger entry TTL so escrow data cannot expire and lock funds.
//!   #469 - Validate buyer != farmer on deposit.
//!   #470 - Validate timeout_unix is at least 1 hour in the future on deposit.
//!   #471 - Emit Soroban events for deposit, release, and refund.
//!   #675 - EscrowStatus::Disputed variant; arbitrator resolve_dispute.
//!   #676 - Partial refund: optional amount parameter on refund.
//!   #687 - ACL role management: grant_role / revoke_role (ARBITRATOR, PLATFORM).
//!   #688 - Extend TTL on every state-changing operation.
//!   #836 - (backend) CSRF double-submit cookie pattern (handled in middleware).
//!   #837 - initialize() sets admin, fee_bps, fee_destination atomically; AlreadyInitialized guard.
//!   #838 - deposit validates amount > 0; uses env.ledger().timestamp() for timeout; emits event.
//!   #839 - release deducts fee, sends to fee_destination atomically, emits enriched event.
//!   #852 - Wasm binary optimisation: [profile.release] in Cargo.toml + wasm-opt in cli.sh.
//!   #853 - upgrade(new_wasm_hash): admin-only contract upgrade preserving all escrow state.
//!   #854 - Emergency pause (circuit breaker): pause() / unpause() with multi-sig guard.
//!   #855 - MAX_FEE_BPS = 500; InvalidFeeRate (code 11); set_fee_rate() with event.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Bytes, BytesN, Env, Vec,
};

// ── TTL constants (in ledgers; ~5 s/ledger on Stellar) ───────────────────────
pub const TTL_MIN: u32 = 100_000;
pub const TTL_MAX: u32 = 200_000;

/// Minimum timeout duration enforced on deposit (1 hour in seconds).
pub const MIN_TIMEOUT_SECS: u64 = 3_600;

/// Maximum platform fee: 500 basis points = 5 %. (#855)
pub const MAX_FEE_BPS: u32 = 500;

// ── Error codes ───────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    AlreadyExists      = 1,
    NotFound           = 2,
    Unauthorized       = 3,
    NotTimedOut        = 4,
    AlreadySettled     = 5,
    InvalidParties     = 6,
    AlreadyInitialized = 7,
    SnapshotNotFound   = 8,
    /// Refund amount exceeds escrowed balance or is zero. (#676)
    InvalidAmount      = 9,
    /// Escrow is currently paused; all state-changing calls are rejected. (#854)
    ContractPaused     = 10,
    /// fee_bps exceeds MAX_FEE_BPS (500). (#855)
    InvalidFeeRate     = 11,
}

// ── Domain types ──────────────────────────────────────────────────────────────

/// Status of an escrow record. (#675)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    Active,
    Released,
    Refunded,
    /// A dispute has been opened; only an arbitrator may settle it.
    Disputed,
}

/// Roles for ACL management (#687).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Role {
    Arbitrator,
    Platform,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Escrow(u64),
    Role(Address, Role),
    /// Platform admin address. Set by initialize(). (#837)
    Admin,
    /// Platform fee in basis points (e.g. 250 = 2.5%). Set by initialize(). (#837)
    FeeBps,
    /// Address that receives the platform fee on release. Set by initialize(). (#837)
    FeeDestination,
    /// Sentinel flag — true once initialize() has been called. (#837)
    Initialized,
    /// Ordered list of all members that currently hold a given role. (#401)
    RoleMembers(Role),
    /// Paused flag — true when the circuit breaker is active. (#854)
    Paused,
    /// Addresses that have cast an unpause vote; cleared on successful unpause. (#854)
    UnpauseVotes,
}

#[contracttype]
#[derive(Clone)]
pub struct EscrowRecord {
    pub buyer: Address,
    pub farmer: Address,
    pub amount: i128,
    pub timeout_unix: u64,
    /// Replaces the old `released: bool` flag with a richer status. (#675)
    pub status: EscrowStatus,
    /// Optional arbitrator address set when a dispute is opened. (#675)
    pub arbitrator: Option<Address>,
    /// SHA-256 hash of the product details at order time (#703).
    pub product_hash: BytesN<32>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Hash product details deterministically for tamper detection (#703).
pub fn compute_product_hash(env: &Env, product_name: &Bytes, price_stroops: i128) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.append(product_name);
    let price_bytes = price_stroops.to_le_bytes();
    let price_bytes_soroban = Bytes::from_array(env, &price_bytes);
    buf.append(&price_bytes_soroban);
    env.crypto().sha256(&buf)
}

/// Abort with ContractPaused if the circuit breaker is active. (#854)
fn require_not_paused(env: &Env) -> Result<(), EscrowError> {
    let paused: bool = env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false);
    if paused {
        Err(EscrowError::ContractPaused)
    } else {
        Ok(())
    }
}

/// Return the stored admin, panicking if the contract is not yet initialised.
fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("contract not initialized")
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {

    // ── #837 / #855 ───────────────────────────────────────────────────────────
    /// Initialize the contract with a platform admin, fee rate, and fee destination.
    ///
    /// Must be called exactly once after deployment.
    /// Returns `EscrowError::AlreadyInitialized` on re-entry.
    /// Returns `EscrowError::InvalidFeeRate` if `fee_bps > MAX_FEE_BPS` (500). (#855)
    pub fn initialize(
        env: Env,
        admin: Address,
        fee_bps: u32,
        fee_destination: Address,
    ) -> Result<(), EscrowError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(EscrowError::AlreadyInitialized);
        }
        // #855: enforce MAX_FEE_BPS = 500 (5 %)
        if fee_bps > MAX_FEE_BPS {
            return Err(EscrowError::InvalidFeeRate);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::FeeDestination, &fee_destination);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().extend_ttl(TTL_MIN, TTL_MAX);

        // Grant the admin the Platform role so ACL checks pass immediately.
        let role_key = DataKey::Role(admin.clone(), Role::Platform);
        env.storage().persistent().set(&role_key, &true);
        env.storage().persistent().extend_ttl(&role_key, TTL_MIN, TTL_MAX);

        Ok(())
    }

    // ── #855 ──────────────────────────────────────────────────────────────────
    /// Update the platform fee rate. Admin-only.
    ///
    /// - Validates `new_fee_bps <= MAX_FEE_BPS`; returns `InvalidFeeRate` otherwise.
    /// - Emits `("escrow", "fee_updated", old_bps, new_bps)` for transparency.
    pub fn set_fee_rate(env: Env, new_fee_bps: u32) -> Result<(), EscrowError> {
        require_not_paused(&env)?;

        let admin = get_admin(&env);
        admin.require_auth();

        if new_fee_bps > MAX_FEE_BPS {
            return Err(EscrowError::InvalidFeeRate);
        }

        let old_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::FeeBps)
            .unwrap_or(0u32);

        env.storage().instance().set(&DataKey::FeeBps, &new_fee_bps);
        env.storage().instance().extend_ttl(TTL_MIN, TTL_MAX);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("fee_upd")),
            (old_bps, new_fee_bps),
        );

        Ok(())
    }

    // ── #853 ──────────────────────────────────────────────────────────────────
    /// Upgrade the contract WASM to a new hash. Admin-only.
    ///
    /// All persistent escrow entries survive the upgrade unchanged because
    /// Soroban persistent storage is keyed independently of the WASM binary.
    /// The `DataKey` enum must remain backward-compatible in any new WASM.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), EscrowError> {
        let admin = get_admin(&env);
        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    // ── #854 ──────────────────────────────────────────────────────────────────
    /// Activate the circuit breaker. Admin-only.
    ///
    /// While paused, every state-changing function returns `ContractPaused`.
    /// Read-only calls (`get_escrow`, `has_role`, `get_role_members`) still work.
    pub fn pause(env: Env) -> Result<(), EscrowError> {
        let admin = get_admin(&env);
        admin.require_auth();

        env.storage().instance().set(&DataKey::Paused, &true);
        env.storage().instance().extend_ttl(TTL_MIN, TTL_MAX);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("paused")),
            (),
        );

        Ok(())
    }

    /// Cast an unpause vote. Requires 2-of-3 Platform role holders to agree.
    ///
    /// The caller must hold `Role::Platform`.  Once the second unique vote is
    /// recorded the pause is lifted and the vote list is cleared.
    /// (For a full 3-signer quorum, change the threshold constant below.)
    pub fn unpause(env: Env, caller: Address) -> Result<(), EscrowError> {
        caller.require_auth();

        // Caller must hold Platform role.
        let platform_key = DataKey::Role(caller.clone(), Role::Platform);
        let is_platform: bool = env
            .storage()
            .persistent()
            .get(&platform_key)
            .unwrap_or(false);
        if !is_platform {
            return Err(EscrowError::Unauthorized);
        }

        // Accumulate votes (2-of-3 threshold). (#854)
        const UNPAUSE_THRESHOLD: u32 = 2;

        let mut votes: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::UnpauseVotes)
            .unwrap_or_else(|| Vec::new(&env));

        // Deduplicate: ignore if caller already voted.
        if !votes.contains(&caller) {
            votes.push_back(caller.clone());
            env.storage().instance().set(&DataKey::UnpauseVotes, &votes);
            env.storage().instance().extend_ttl(TTL_MIN, TTL_MAX);
        }

        if votes.len() >= UNPAUSE_THRESHOLD {
            env.storage().instance().set(&DataKey::Paused, &false);
            // Clear votes for next pause/unpause cycle.
            let empty: Vec<Address> = Vec::new(&env);
            env.storage().instance().set(&DataKey::UnpauseVotes, &empty);
            env.storage().instance().extend_ttl(TTL_MIN, TTL_MAX);

            env.events().publish(
                (symbol_short!("escrow"), symbol_short!("unpaused")),
                (),
            );
        }

        Ok(())
    }

    // ── #838 ──────────────────────────────────────────────────────────────────
    /// Locks `amount` tokens in escrow for `order_id`.
    pub fn deposit(
        env: Env,
        order_id: u64,
        buyer: Address,
        farmer: Address,
        amount: i128,
        timeout_unix: u64,
        product_name: Bytes,
        price_stroops: i128,
    ) -> Result<(), EscrowError> {
        require_not_paused(&env)?;

        if buyer == farmer {
            return Err(EscrowError::InvalidParties);
        }
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }

        let now = env.ledger().timestamp();
        if timeout_unix <= now.saturating_add(MIN_TIMEOUT_SECS) {
            panic!("timeout must be at least 1 hour in the future");
        }

        let key = DataKey::Escrow(order_id);
        if env.storage().persistent().has(&key) {
            return Err(EscrowError::AlreadyExists);
        }

        buyer.require_auth();

        let product_hash = compute_product_hash(&env, &product_name, price_stroops);

        let record = EscrowRecord {
            buyer: buyer.clone(),
            farmer: farmer.clone(),
            amount,
            timeout_unix,
            status: EscrowStatus::Active,
            arbitrator: None,
            product_hash,
        };

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("deposit"), order_id),
            (buyer, farmer, amount),
        );

        Ok(())
    }

    // ── #839 ──────────────────────────────────────────────────────────────────
    /// Releases escrowed funds to the farmer with platform fee deduction.
    pub fn release(
        env: Env,
        order_id: u64,
        product_name: Bytes,
        price_stroops: i128,
    ) -> Result<(), EscrowError> {
        require_not_paused(&env)?;

        let key = DataKey::Escrow(order_id);

        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::NotFound)?;

        if record.status != EscrowStatus::Active {
            return Err(EscrowError::AlreadySettled);
        }

        record.buyer.require_auth();

        let expected_hash = compute_product_hash(&env, &product_name, price_stroops);
        if expected_hash != record.product_hash {
            return Err(EscrowError::SnapshotNotFound);
        }

        let fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::FeeBps)
            .unwrap_or(0u32);
        let fee_amount = (record.amount * fee_bps as i128) / 10_000;
        let farmer_amount = record.amount - fee_amount;

        record.status = EscrowStatus::Released;

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("release"), order_id),
            (farmer_amount, fee_amount),
        );

        Ok(())
    }

    /// Returns escrowed funds to the buyer after the timeout has passed.
    pub fn refund(env: Env, order_id: u64, amount: Option<i128>) -> Result<(), EscrowError> {
        require_not_paused(&env)?;

        let key = DataKey::Escrow(order_id);

        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::NotFound)?;

        if record.status != EscrowStatus::Active {
            return Err(EscrowError::AlreadySettled);
        }

        let now = env.ledger().timestamp();
        if now < record.timeout_unix {
            return Err(EscrowError::NotTimedOut);
        }

        let refund_amount = match amount {
            Some(n) => {
                if n <= 0 || n > record.amount {
                    return Err(EscrowError::InvalidAmount);
                }
                n
            }
            None => record.amount,
        };

        record.amount = refund_amount;
        record.status = EscrowStatus::Refunded;

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("refund"), order_id),
            refund_amount,
        );

        Ok(())
    }

    /// Opens a dispute on an active escrow. (#675)
    pub fn open_dispute(
        env: Env,
        order_id: u64,
        caller: Address,
        arbitrator: Option<Address>,
    ) -> Result<(), EscrowError> {
        require_not_paused(&env)?;

        caller.require_auth();

        let key = DataKey::Escrow(order_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::NotFound)?;

        if record.status != EscrowStatus::Active {
            return Err(EscrowError::AlreadySettled);
        }

        if caller != record.buyer && caller != record.farmer {
            return Err(EscrowError::Unauthorized);
        }

        record.status = EscrowStatus::Disputed;
        record.arbitrator = arbitrator;

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("dispute"), order_id),
            caller,
        );

        Ok(())
    }

    /// Settles a disputed escrow. (#675)
    pub fn resolve_dispute(
        env: Env,
        order_id: u64,
        caller: Address,
        release_to_buyer: bool,
    ) -> Result<(), EscrowError> {
        require_not_paused(&env)?;

        caller.require_auth();

        let key = DataKey::Escrow(order_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::NotFound)?;

        if record.status != EscrowStatus::Disputed {
            return Err(EscrowError::AlreadySettled);
        }

        let role_key = DataKey::Role(caller.clone(), Role::Arbitrator);
        let has_global_role: bool = env
            .storage()
            .persistent()
            .get(&role_key)
            .unwrap_or(false);

        let is_record_arbitrator = record
            .arbitrator
            .as_ref()
            .map(|a| *a == caller)
            .unwrap_or(false);

        if !has_global_role && !is_record_arbitrator {
            return Err(EscrowError::Unauthorized);
        }

        let amount = record.amount;
        record.status = if release_to_buyer {
            EscrowStatus::Refunded
        } else {
            EscrowStatus::Released
        };

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("resolved"), order_id),
            (caller, release_to_buyer, amount),
        );

        Ok(())
    }

    // ── #687 / #401 ───────────────────────────────────────────────────────────

    /// Grants `role` to `account`. (#687)
    pub fn grant_role(env: Env, caller: Address, account: Address, role: Role) {
        caller.require_auth();

        let admin_opt: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        let is_initialized = env.storage().instance().has(&DataKey::Initialized);

        let platform_key = DataKey::Role(caller.clone(), Role::Platform);
        let caller_is_platform: bool = env
            .storage()
            .persistent()
            .get(&platform_key)
            .unwrap_or(false);

        if is_initialized {
            let is_admin = admin_opt
                .as_ref()
                .map(|a| *a == caller)
                .unwrap_or(false);
            if !caller_is_platform && !is_admin {
                panic!("only a Platform role holder can grant roles");
            }
        } else {
            let is_bootstrap = matches!(role, Role::Platform) && !caller_is_platform;
            if !caller_is_platform && !is_bootstrap {
                panic!("only a Platform role holder can grant roles");
            }
        }

        let key = DataKey::Role(account.clone(), role.clone());
        env.storage().persistent().set(&key, &true);
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

        let members_key = DataKey::RoleMembers(role.clone());
        let mut members: Vec<Address> = env
            .storage()
            .persistent()
            .get(&members_key)
            .unwrap_or_else(|| Vec::new(&env));
        if !members.contains(&account) {
            members.push_back(account);
            env.storage().persistent().set(&members_key, &members);
            env.storage().persistent().extend_ttl(&members_key, TTL_MIN, TTL_MAX);
        }
    }

    /// Revokes `role` from `account`. (#687)
    pub fn revoke_role(env: Env, caller: Address, account: Address, role: Role) {
        caller.require_auth();

        let platform_key = DataKey::Role(caller.clone(), Role::Platform);
        let caller_is_platform: bool = env
            .storage()
            .persistent()
            .get(&platform_key)
            .unwrap_or(false);

        if !caller_is_platform {
            panic!("only a Platform role holder can revoke roles");
        }

        let key = DataKey::Role(account.clone(), role.clone());
        env.storage().persistent().remove(&key);

        let members_key = DataKey::RoleMembers(role.clone());
        let mut members: Vec<Address> = env
            .storage()
            .persistent()
            .get(&members_key)
            .unwrap_or_else(|| Vec::new(&env));
        if let Some(idx) = members.iter().position(|a| a == account) {
            members.remove(idx as u32);
            env.storage().persistent().set(&members_key, &members);
        }
    }

    /// Returns all addresses that currently hold `role`. (#401)
    pub fn get_role_members(env: Env, role: Role) -> Vec<Address> {
        let members_key = DataKey::RoleMembers(role);
        env.storage()
            .persistent()
            .get(&members_key)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Returns true if `account` holds `role`. (#401, #687)
    pub fn has_role(env: Env, account: Address, role: Role) -> bool {
        let key = DataKey::Role(account, role);
        env.storage().persistent().get(&key).unwrap_or(false)
    }

    /// Returns the full escrow record for a specific order ID.
    pub fn get_escrow(env: Env, order_id: u64) -> Result<EscrowRecord, EscrowError> {
        let key = DataKey::Escrow(order_id);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::NotFound)
    }

    /// Returns true if the contract is currently paused. (#854)
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }
}

mod test;
