//! Carbon-offset contract.
//!
//! Tracks carbon-offset credits and lets the admin upgrade the contract
//! wasm. Upgrades are time-locked: the admin must first propose a new wasm
//! hash, wait for `UPGRADE_DELAY`, and only then execute it. A pending
//! proposal can be cancelled at any time before execution.
//!
//! User-reachable failures are reported with [`CarbonError`] rather than
//! panicking.

#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, Symbol};

/// Default time-lock applied between `propose_upgrade` and `execute_upgrade`.
/// 48 hours, expressed in seconds.
pub const UPGRADE_DELAY: u64 = 48 * 60 * 60;

/// Time-lock used when the `testnet` feature flag is enabled. Testnet builds
/// may set the delay to 0 so upgrades can be exercised immediately.
#[cfg(feature = "testnet")]
pub const UPGRADE_DELAY_TESTNET: u64 = 0;

/// Typed errors returned by the contract. No `panic!` is used for
/// user-reachable failures.
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum CarbonError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    UnregisteredVerifier = 4,
    NoVerification = 5,
    KgCo2Mismatch = 6,
    OffsetAlreadyRecorded = 7,
    NoOffset = 8,
    InvalidWasmHash = 9,
    NoPendingUpgrade = 10,
    UpgradeNotReady = 11,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OffsetRecord {
    pub order_id: u64,
    pub kg_co2: i128,
    pub verifier: Address,
    pub voided: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingUpgrade {
    pub new_wasm_hash: BytesN<32>,
    pub eta: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Verifier(Address),
    Verification(u64),
    Offset(u64),
    PendingUpgrade,
}

#[contract]
pub struct CarbonOffsetContract;

#[contractimpl]
impl CarbonOffsetContract {
    pub fn init(env: Env, admin: Address) -> Result<(), CarbonError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(CarbonError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    fn require_admin(env: &Env) -> Result<Address, CarbonError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CarbonError::NotInitialized)?;
        admin.require_auth();
        Ok(admin)
    }

    fn upgrade_delay() -> u64 {
        #[cfg(feature = "testnet")]
        {
            UPGRADE_DELAY_TESTNET
        }
        #[cfg(not(feature = "testnet"))]
        {
            UPGRADE_DELAY
        }
    }

    pub fn add_verifier(env: Env, verifier: Address) -> Result<(), CarbonError> {
        Self::require_admin(&env)?;
        env.storage()
            .persistent()
            .set(&DataKey::Verifier(verifier.clone()), &true);
        env.events()
            .publish((Symbol::new(&env, "verifier_added"),), verifier);
        Ok(())
    }

    pub fn remove_verifier(env: Env, verifier: Address) -> Result<(), CarbonError> {
        Self::require_admin(&env)?;
        env.storage()
            .persistent()
            .remove(&DataKey::Verifier(verifier.clone()));
        env.events()
            .publish((Symbol::new(&env, "verifier_removed"),), verifier);
        Ok(())
    }

    pub fn is_verifier(env: Env, verifier: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Verifier(verifier))
            .unwrap_or(false)
    }

    pub fn authorize_offset(
        env: Env,
        order_id: u64,
        kg_co2: i128,
        verifier: Address,
    ) -> Result<(), CarbonError> {
        verifier.require_auth();
        let registered: bool = env
            .storage()
            .persistent()
            .get(&DataKey::Verifier(verifier.clone()))
            .unwrap_or(false);
        if !registered {
            return Err(CarbonError::UnregisteredVerifier);
        }
        env.storage().persistent().set(
            &DataKey::Verification(order_id),
            &(verifier.clone(), kg_co2),
        );
        env.events().publish(
            (Symbol::new(&env, "offset_authorized"), order_id),
            (verifier, kg_co2),
        );
        Ok(())
    }

    pub fn record_offset(env: Env, order_id: u64, kg_co2: i128) -> Result<(), CarbonError> {
        Self::require_admin(&env)?;
        if env
            .storage()
            .persistent()
            .has(&DataKey::Offset(order_id))
        {
            return Err(CarbonError::OffsetAlreadyRecorded);
        }
        let (verifier, approved_kg): (Address, i128) = env
            .storage()
            .persistent()
            .get(&DataKey::Verification(order_id))
            .ok_or(CarbonError::NoVerification)?;
        if approved_kg != kg_co2 {
            return Err(CarbonError::KgCo2Mismatch);
        }
        env.storage()
            .persistent()
            .remove(&DataKey::Verification(order_id));
        env.storage().persistent().set(
            &DataKey::Offset(order_id),
            &OffsetRecord {
                order_id,
                kg_co2,
                verifier,
                voided: false,
            },
        );
        env.events()
            .publish((Symbol::new(&env, "offset_recorded"), order_id), kg_co2);
        Ok(())
    }

    pub fn amend_offset(env: Env, order_id: u64, kg_co2: i128) -> Result<(), CarbonError> {
        Self::require_admin(&env)?;
        let (verifier, approved_kg): (Address, i128) = env
            .storage()
            .persistent()
            .get(&DataKey::Verification(order_id))
            .ok_or(CarbonError::NoVerification)?;
        if approved_kg != kg_co2 {
            return Err(CarbonError::KgCo2Mismatch);
        }
        env.storage()
            .persistent()
            .remove(&DataKey::Verification(order_id));
        env.storage().persistent().set(
            &DataKey::Offset(order_id),
            &OffsetRecord {
                order_id,
                kg_co2,
                verifier,
                voided: false,
            },
        );
        env.events()
            .publish((Symbol::new(&env, "offset_amended"), order_id), kg_co2);
        Ok(())
    }

    pub fn void_offset(env: Env, order_id: u64) -> Result<(), CarbonError> {
        Self::require_admin(&env)?;
        let mut record: OffsetRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Offset(order_id))
            .ok_or(CarbonError::NoOffset)?;
        record.voided = true;
        env.storage()
            .persistent()
            .set(&DataKey::Offset(order_id), &record);
        env.events()
            .publish((Symbol::new(&env, "offset_voided"), order_id), ());
        Ok(())
    }

    pub fn get_offset(env: Env, order_id: u64) -> Option<OffsetRecord> {
        env.storage().persistent().get(&DataKey::Offset(order_id))
    }

    /// Propose a new wasm hash. Stores `(hash, eta = now + UPGRADE_DELAY)` and
    /// emits an `upgrade_proposed` event. Rejects the zero hash.
    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), CarbonError> {
        Self::require_admin(&env)?;

        if new_wasm_hash == BytesN::from_array(&env, &[0u8; 32]) {
            return Err(CarbonError::InvalidWasmHash);
        }

        let eta = env.ledger().timestamp() + Self::upgrade_delay();
        let pending = PendingUpgrade {
            new_wasm_hash: new_wasm_hash.clone(),
            eta,
        };
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgrade, &pending);

        env.events().publish(
            (Symbol::new(&env, "upgrade_proposed"),),
            (new_wasm_hash, eta),
        );
        Ok(())
    }

    /// Execute a previously proposed upgrade. Only succeeds once `eta` has
    /// passed.
    pub fn execute_upgrade(env: Env) -> Result<(), CarbonError> {
        Self::require_admin(&env)?;

        let pending: PendingUpgrade = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgrade)
            .ok_or(CarbonError::NoPendingUpgrade)?;

        if env.ledger().timestamp() < pending.eta {
            return Err(CarbonError::UpgradeNotReady);
        }

        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgrade);

        env.deployer()
            .update_current_contract_wasm(pending.new_wasm_hash.clone());

        env.events().publish(
            (Symbol::new(&env, "upgrade_executed"),),
            pending.new_wasm_hash,
        );
        Ok(())
    }

    /// Cancel a pending upgrade proposal.
    pub fn cancel_upgrade(env: Env) -> Result<(), CarbonError> {
        Self::require_admin(&env)?;

        env.storage()
            .instance()
            .remove(&DataKey::PendingUpgrade);

        env.events()
            .publish((Symbol::new(&env, "upgrade_cancelled"),), ());
        Ok(())
    }
}
