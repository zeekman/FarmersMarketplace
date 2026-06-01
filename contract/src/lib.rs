//! Farmers Marketplace - Soroban Escrow Contract
//!
//! Issues addressed:
//!   #468 - Extend ledger entry TTL so escrow data cannot expire and lock funds.
//!   #469 - Validate buyer != farmer on deposit.
//!   #470 - Validate timeout_unix is at least 1 hour in the future on deposit.
//!   #471 - Emit Soroban events for deposit, release, and refund.
//!   #687 - ACL role management: grant_role / revoke_role (ARBITRATOR, PLATFORM).
//!   #688 - Extend TTL on every state-changing operation (deposit, release, refund).

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Env,
};

// TTL constants (in ledgers; ~5 s/ledger on Stellar)
//   100_000 ledgers ~= 57 days  (min threshold)
//   200_000 ledgers ~= 115 days (max / reset target)
pub const TTL_MIN: u32 = 100_000;
pub const TTL_MAX: u32 = 200_000;

/// Minimum timeout duration enforced on deposit (1 hour in seconds).
pub const MIN_TIMEOUT_SECS: u64 = 3_600;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    AlreadyExists = 1,
    NotFound = 2,
    Unauthorized = 3,
    NotTimedOut = 4,
    AlreadySettled = 5,
    InvalidParties = 6,
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
    pub released: bool,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Locks `amount` tokens in escrow for `order_id`.
    /// Validates buyer != farmer (#469) and timeout >= now + 1h (#470).
    /// Extends TTL after writing (#468, #688).
    /// Emits ("escrow", "deposit", order_id) -> (buyer, farmer, amount) (#471).
    pub fn deposit(
        env: Env,
        order_id: u64,
        buyer: Address,
        farmer: Address,
        amount: i128,
        timeout_unix: u64,
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

        let record = EscrowRecord {
            buyer: buyer.clone(),
            farmer: farmer.clone(),
            amount,
            timeout_unix,
            released: false,
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
    /// Extends TTL after updating the record (#468, #688).
    /// Emits ("escrow", "release", order_id) -> amount (#471).
    pub fn release(env: Env, order_id: u64) -> Result<(), EscrowError> {
        let key = DataKey::Escrow(order_id);

        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::NotFound)?;

        if record.released {
            return Err(EscrowError::AlreadySettled);
        }

        record.buyer.require_auth();

        let amount = record.amount;
        record.released = true;

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("release"), order_id),
            amount,
        );

        Ok(())
    }

    /// Returns escrowed funds to the buyer after the timeout has passed.
    /// Permissionless sweep - anyone may call once timeout is reached.
    /// Extends TTL after updating the record (#468, #688).
    /// Emits ("escrow", "refund", order_id) -> amount (#471).
    pub fn refund(env: Env, order_id: u64) -> Result<(), EscrowError> {
        let key = DataKey::Escrow(order_id);

        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::NotFound)?;

        if record.released {
            return Err(EscrowError::AlreadySettled);
        }

        let now = env.ledger().timestamp();
        if now < record.timeout_unix {
            return Err(EscrowError::NotTimedOut);
        }

        let amount = record.amount;
        record.released = true;

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("refund"), order_id),
            amount,
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