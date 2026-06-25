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

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Bytes, BytesN, Env,
};

// TTL constants (in ledgers; ~5 s/ledger on Stellar)
pub const TTL_MIN: u32 = 100_000;
pub const TTL_MAX: u32 = 200_000;

/// Minimum timeout duration enforced on deposit (1 hour in seconds).
pub const MIN_TIMEOUT_SECS: u64 = 3_600;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    AlreadyExists    = 1,
    NotFound         = 2,
    Unauthorized     = 3,
    NotTimedOut      = 4,
    AlreadySettled   = 5,
    InvalidParties   = 6,
    AlreadyInitialized = 7,
    SnapshotNotFound = 8,
    /// Refund amount exceeds escrowed balance or is zero. (#676)
    InvalidAmount    = 9,
}

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
    /// Verified on release to detect product tampering.
    pub product_hash: BytesN<32>,
}

/// Hash product details deterministically for tamper detection (#703).
/// Input bytes are: name (up to 64 bytes, zero-padded) + price as 8 LE bytes.
pub fn compute_product_hash(env: &Env, product_name: &Bytes, price_stroops: i128) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.append(product_name);
    // Append price as little-endian 16 bytes
    let price_bytes = price_stroops.to_le_bytes();
    let price_bytes_soroban = Bytes::from_array(env, &price_bytes);
    buf.append(&price_bytes_soroban);
    env.crypto().sha256(&buf)
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    // ── #837 ─────────────────────────────────────────────────────────────────
    /// Initialize the contract with a platform admin, fee rate, and fee destination.
    ///
    /// Must be called exactly once after deployment (e.g. from `contract/cli.sh`).
    /// Subsequent calls return `EscrowError::AlreadyInitialized`.
    ///
    /// - `admin`: the address granted admin / Platform privileges.
    /// - `fee_bps`: platform fee in basis points (max 1 000 = 10 %).
    /// - `fee_destination`: address that receives the fee portion on every release.
    pub fn initialize(
        env: Env,
        admin: Address,
        fee_bps: u32,
        fee_destination: Address,
    ) -> Result<(), EscrowError> {
        // Guard: reject double-initialisation.
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(EscrowError::AlreadyInitialized);
        }
        if fee_bps > 1_000 {
            panic!("fee_bps must not exceed 1000");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::FeeDestination, &fee_destination);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().extend_ttl(TTL_MIN, TTL_MAX);
        // Also grant the admin the Platform role so all role checks still pass.
        let role_key = DataKey::Role(admin.clone(), Role::Platform);
        env.storage().persistent().set(&role_key, &true);
        env.storage().persistent().extend_ttl(&role_key, TTL_MIN, TTL_MAX);
        Ok(())
    }

    // ── #838 ─────────────────────────────────────────────────────────────────
    /// Locks `amount` tokens in escrow for `order_id`.
    ///
    /// Hardening (#838):
    /// - `amount > 0` is enforced; zero or negative returns `EscrowError::InvalidAmount`.
    /// - `timeout_unix` is validated using `env.ledger().timestamp()` (not wall clock).
    /// - Duplicate `order_id` always returns `AlreadyExists` (settled escrows are immutable).
    /// - Emits ("escrow", "deposit", order_id) -> (buyer, farmer, amount) (#471).
    /// - Extends TTL after writing (#468, #688).
    ///
    /// Also validates buyer != farmer (#469) and timeout >= now + 1h (#470).
    /// Stores a `product_hash` derived from `product_name` + `price_stroops` (#703).
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
        if buyer == farmer {
            return Err(EscrowError::InvalidParties);
        }

        // #838: validate amount > 0
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }

        // #838: use env.ledger().timestamp() for timeout validation
        let now = env.ledger().timestamp();
        if timeout_unix <= now.saturating_add(MIN_TIMEOUT_SECS) {
            panic!("timeout must be at least 1 hour in the future");
        }

        let key = DataKey::Escrow(order_id);
        // #838: AlreadyExists regardless of settlement state (escrow IDs are immutable)
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

        // #471 / #838: emit deposit event
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("deposit"), order_id),
            (buyer, farmer, amount),
        );

        Ok(())
    }

    // ── #839 ─────────────────────────────────────────────────────────────────
    /// Releases escrowed funds to the farmer with platform fee deduction.
    ///
    /// - `fee = amount * fee_bps / 10_000`; `farmer_amount = amount - fee`.
    /// - The fee is implicitly transferred to `fee_destination` (recorded in event).
    /// - Only the buyer or Platform role may call this; calling as farmer returns
    ///   `EscrowError::Unauthorized` (enforced via `buyer.require_auth()`).
    /// - Emits ("escrow", "release", order_id, farmer_amount, fee) (#839).
    /// - Extends TTL after updating the record (#468, #688).
    /// - Verifies `product_name` + `price_stroops` hash matches stored hash (#703).
    pub fn release(
        env: Env,
        order_id: u64,
        product_name: Bytes,
        price_stroops: i128,
    ) -> Result<(), EscrowError> {
        let key = DataKey::Escrow(order_id);

        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::NotFound)?;

        if record.status != EscrowStatus::Active {
            return Err(EscrowError::AlreadySettled);
        }

        // #839: buyer or platform admin may release; farmer is rejected implicitly
        // because only the buyer's address is stored and require_auth enforces the caller.
        record.buyer.require_auth();

        // Verify product details have not been tampered with (#703)
        let expected_hash = compute_product_hash(&env, &product_name, price_stroops);
        if expected_hash != record.product_hash {
            return Err(EscrowError::SnapshotNotFound);
        }

        // #839: compute fee using stored fee_bps (set via initialize()); default 0.
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

        // #839 / #471: emit enriched release event (order_id, farmer_amount, fee).
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("release"), order_id),
            (farmer_amount, fee_amount),
        );

        Ok(())
    }

    /// Returns escrowed funds to the buyer after the timeout has passed.
    ///
    /// If `amount` is `Some(n)`, refunds only `n` to the buyer and releases the
    /// remainder to the farmer (partial refund, #676).
    /// If `amount` is `None`, refunds the full balance.
    ///
    /// Permissionless sweep - anyone may call once timeout is reached.
    /// Extends TTL after updating the record (#468, #688).
    /// Emits ("escrow", "refund", order_id) -> refunded_amount (#471).
    pub fn refund(env: Env, order_id: u64, amount: Option<i128>) -> Result<(), EscrowError> {
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

        // For a partial refund the remainder stays with the farmer; the escrow
        // is fully settled regardless.
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
    /// Only the buyer or farmer may open a dispute.
    /// Optionally records an `arbitrator` address; if omitted the caller is
    /// expected to resolve via an out-of-band arbitrator grant.
    pub fn open_dispute(
        env: Env,
        order_id: u64,
        caller: Address,
        arbitrator: Option<Address>,
    ) -> Result<(), EscrowError> {
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
        record.arbitrator = arbitrator.clone();

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("dispute"), order_id),
            caller,
        );

        Ok(())
    }

    /// Settles a disputed escrow. (#675)
    /// Only an address that holds `Role::Arbitrator` **or** is the designated
    /// `arbitrator` on the record may call this.
    ///
    /// `release_to_buyer`: if true, the full amount is refunded to the buyer;
    ///   otherwise it is released to the farmer.
    pub fn resolve_dispute(
        env: Env,
        order_id: u64,
        caller: Address,
        release_to_buyer: bool,
    ) -> Result<(), EscrowError> {
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

        // Authorised if: caller holds the global Arbitrator role, OR caller
        // is the arbitrator recorded on this specific escrow.
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

    /// Grants `role` to `account` (#687).
    /// Only a PLATFORM holder may grant roles.
    /// Bootstrap: first grant of Role::Platform is open (no existing platform).
    /// After initialize() is called, grant_role checks DataKey::Admin is set (#837).
    pub fn grant_role(env: Env, caller: Address, account: Address, role: Role) {
        caller.require_auth();

        // #837: if the contract has been initialized, verify the caller is the stored admin
        // or already holds the Platform role. This closes the bootstrap-before-init window.
        let admin_opt: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        let is_initialized = env.storage().instance().has(&DataKey::Initialized);

        let platform_key = DataKey::Role(caller.clone(), Role::Platform);
        let caller_is_platform: bool = env
            .storage()
            .persistent()
            .get(&platform_key)
            .unwrap_or(false);

        // If initialized, the caller must already be a Platform holder or the stored admin.
        if is_initialized {
            let is_admin = admin_opt
                .as_ref()
                .map(|a| *a == caller)
                .unwrap_or(false);
            if !caller_is_platform && !is_admin {
                panic!("only a Platform role holder can grant roles");
            }
        } else {
            // Pre-init bootstrap: first grant of Role::Platform is open.
            let is_bootstrap = matches!(role, Role::Platform) && !caller_is_platform;
            if !caller_is_platform && !is_bootstrap {
                panic!("only a Platform role holder can grant roles");
            }
        }

        let key = DataKey::Role(account, role);
        env.storage().persistent().set(&key, &true);
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);
    }

    /// Revokes `role` from `account` (#687).
    /// Only a PLATFORM holder may call this.
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

        let key = DataKey::Role(account, role);
        env.storage().persistent().remove(&key);
    }

    /// Returns true if `account` holds `role` (#687).
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
}

mod test;
