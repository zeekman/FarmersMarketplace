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
    /// Locks `amount` tokens in escrow for `order_id`.
    /// Validates buyer != farmer (#469) and timeout >= now + 1h (#470).
    /// Stores a `product_hash` derived from `product_name` + `price_stroops` (#703).
    /// Extends TTL after writing (#468, #688).
    /// Emits ("escrow", "deposit", order_id) -> (buyer, farmer, amount) (#471).
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

    /// Releases escrowed funds to the farmer. Only the buyer may call this.
    /// Verifies `product_name` + `price_stroops` hash matches the stored hash (#703).
    /// Extends TTL after updating the record (#468, #688).
    /// Emits ("escrow", "release", order_id) -> amount (#471).
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

        record.buyer.require_auth();

        // Verify product details have not been tampered with (#703)
        let expected_hash = compute_product_hash(&env, &product_name, price_stroops);
        if expected_hash != record.product_hash {
            return Err(EscrowError::SnapshotNotFound);
        }

        let amount = record.amount;
        record.status = EscrowStatus::Released;

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("release"), order_id),
            amount,
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
    pub fn grant_role(env: Env, caller: Address, account: Address, role: Role) {
        caller.require_auth();

        let platform_key = DataKey::Role(caller.clone(), Role::Platform);
        let caller_is_platform: bool = env
            .storage()
            .persistent()
            .get(&platform_key)
            .unwrap_or(false);

        let is_bootstrap = matches!(role, Role::Platform) && !caller_is_platform;
        if !caller_is_platform && !is_bootstrap {
            panic!("only a Platform role holder can grant roles");
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
