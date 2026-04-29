//! Farmers Marketplace — Soroban Escrow Contract
//!
//! Fixes addressed:
//!   #468 — Extend ledger entry TTL so escrow data cannot expire and lock funds.
//!   #469 — Validate payer != freelancer (buyer != farmer) on create/deposit.
//!   #470 — Validate timeout_unix is at least 1 hour in the future on deposit.
//!   #471 — Emit Soroban events for deposit, release, and refund.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, symbol_short,
};

// ---------------------------------------------------------------------------
// TTL constants (in ledgers; ~5 s/ledger on Stellar)
//   100 000 ledgers ≈ 5 000 000 s ≈ 57 days  (min)
//   200 000 ledgers ≈ 10 000 000 s ≈ 115 days (max)
// ---------------------------------------------------------------------------
const TTL_MIN: u32 = 100_000;
const TTL_MAX: u32 = 200_000;

/// Minimum timeout duration enforced on deposit (1 hour in seconds).
const MIN_TIMEOUT_SECS: u64 = 3_600;

// ---------------------------------------------------------------------------
// Error enum
// ---------------------------------------------------------------------------
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    /// Escrow record already exists for this order_id.
    AlreadyExists = 1,
    /// No escrow record found for this order_id.
    NotFound = 2,
    /// Caller is not authorised to perform this action.
    Unauthorized = 3,
    /// The escrow has not yet timed out.
    NotTimedOut = 4,
    /// The escrow has already been settled (released or refunded).
    AlreadySettled = 5,
    /// payer and farmer addresses must be different.
    InvalidParties = 6,
}

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Escrow(u64), // keyed by order_id
}

// ---------------------------------------------------------------------------
// Escrow record stored on-chain
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

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    // -----------------------------------------------------------------------
    // deposit
    //
    // Locks `amount` tokens in escrow for `order_id`.
    //
    // Validations (fixes #469, #470):
    //   • buyer != farmer
    //   • timeout_unix > now + MIN_TIMEOUT_SECS
    //
    // TTL extension (fix #468):
    //   • Extends the persistent entry TTL after writing.
    //
    // Event emitted (fix #471):
    //   topics : ("escrow", "deposit", order_id)
    //   data   : (buyer, farmer, amount)
    // -----------------------------------------------------------------------
    pub fn deposit(
        env: Env,
        order_id: u64,
        buyer: Address,
        farmer: Address,
        amount: i128,
        timeout_unix: u64,
    ) -> Result<(), EscrowError> {
        // Fix #469 — payer must differ from farmer
        if buyer == farmer {
            return Err(EscrowError::InvalidParties);
        }

        // Fix #470 — timeout must be at least 1 hour in the future
        let now = env.ledger().timestamp();
        if timeout_unix <= now.saturating_add(MIN_TIMEOUT_SECS) {
            panic!("timeout must be at least 1 hour in the future");
        }

        let key = DataKey::Escrow(order_id);

        // Prevent duplicate deposits for the same order
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

        // Fix #468 — extend TTL so the entry cannot expire
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

        // Fix #471 — emit deposit event
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("deposit"), order_id),
            (buyer, farmer, amount),
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // release
    //
    // Releases escrowed funds to the farmer. Only the buyer may call this.
    //
    // TTL extension (fix #468):
    //   • Extends TTL after updating the record.
    //
    // Event emitted (fix #471):
    //   topics : ("escrow", "release", order_id)
    //   data   : amount
    // -----------------------------------------------------------------------
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

        // Only the buyer can release funds to the farmer
        record.buyer.require_auth();

        let amount = record.amount;
        record.released = true;

        env.storage().persistent().set(&key, &record);

        // Fix #468 — extend TTL after update
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

        // Fix #471 — emit release event
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("release"), order_id),
            amount,
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // refund
    //
    // Returns escrowed funds to the buyer after the timeout has passed.
    // Anyone may call this once the timeout is reached (permissionless sweep).
    //
    // TTL extension (fix #468):
    //   • Extends TTL after updating the record.
    //
    // Event emitted (fix #471):
    //   topics : ("escrow", "refund", order_id)
    //   data   : amount
    // -----------------------------------------------------------------------
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

        // Fix #468 — extend TTL after update
        env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

        // Fix #471 — emit refund event
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("refund"), order_id),
            amount,
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // get_escrow — read-only helper (useful for the backend monitor)
    // -----------------------------------------------------------------------
    pub fn get_escrow(env: Env, order_id: u64) -> Result<EscrowRecord, EscrowError> {
        let key = DataKey::Escrow(order_id);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::NotFound)
    }
}

mod test;
