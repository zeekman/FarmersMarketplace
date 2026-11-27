#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Symbol,
};

const ADMIN: Symbol = symbol_short!("ADMIN");
const PENDING_ADMIN: Symbol = symbol_short!("PEND_ADM");
const PENDING_ADMIN_EXPIRY: Symbol = symbol_short!("PEND_EXP");
const ADMIN_PROPOSAL_TTL_SECS: u64 = 7 * 24 * 60 * 60;

// Conservative TTL bump so offset records don't get archived between writes.
// Values are in ledgers (~5s each): ~6 days threshold, ~30 days bump.
const BUMP_THRESHOLD: u32 = 100_000;
const BUMP_AMOUNT: u32 = 500_000;

// Instance TTL bounds: ~6 days threshold, ~30 days bump. Instance storage holds
// the admin config, so every state-changing entrypoint must extend it to avoid
// the config being archived on a quiet deployment.
const TTL_MIN: u32 = 100_000;
const TTL_MAX: u32 = 500_000;

/// Typed errors for the carbon-offset contract. Codes are stable and must not
/// be renumbered; clients map them to user-facing messages.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CarbonError {
    /// 1 — `initialize` was already called.
    AlreadyInitialized = 1,
    /// 2 — contract has not been initialized yet.
    NotInitialized = 2,
    /// 3 — `kg_co2` must be greater than zero.
    InvalidOffsetAmount = 3,
    /// 4 — an offset is already recorded for this order.
    OffsetAlreadyRecorded = 4,
    /// 5 — no verifier approval exists for this order.
    VerifierApprovalRequired = 5,
    /// 6 — verifier approval does not match the requested offset.
    VerifierApprovalMismatch = 6,
    /// 7 — cannot amend a voided offset.
    CannotAmendVoided = 7,
    /// 8 — no active offset record found for this order.
    OffsetNotFound = 8,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Offset(u64),
    Verification(u64),
    Voided(u64),
}

#[derive(Clone)]
#[contracttype]
pub struct VerifierApproval {
    pub kg_co2: u64,
    pub verifier: Address,
}

/// On-chain carbon offset certificate for a single order.
#[derive(Clone)]
#[contracttype]
pub struct CarbonOffset {
    pub order_id: u64,
    pub kg_co2: u64,
    pub offset_paid: bool,
    pub verifier: Address,
}

/// Contract version reported by `version()`. (CT-28)
pub const CONTRACT_VERSION: u32 = 1;

/// Read-only snapshot of contract configuration. (CT-28)
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Config {
    pub admin: Option<Address>,
    pub pending_admin: Option<Address>,
    pub version: u32,
}

#[contract]
pub struct CarbonOffsetContract;

/// Extend the instance storage TTL so admin/config data is never archived.
fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(TTL_MIN, TTL_MAX);
}

#[contractimpl]
impl CarbonOffsetContract {
    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
    }

    fn require_positive_offset(kg_co2: u64) -> Result<(), CarbonError> {
        if kg_co2 == 0 {
            return Err(CarbonError::InvalidOffsetAmount);
        }
        Ok(())
    }

    fn load_admin(env: &Env) -> Result<Address, CarbonError> {
        env.storage()
            .instance()
            .get(&ADMIN)
            .ok_or(CarbonError::NotInitialized)
    }

    /// One-time setup: sets the platform admin address allowed to call `record_offset`.
    pub fn initialize(env: Env, admin: Address) -> Result<(), CarbonError> {
        admin.require_auth();
        if env.storage().instance().has(&ADMIN) {
            return Err(CarbonError::AlreadyInitialized);
        }
        env.storage().instance().set(&ADMIN, &admin);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    /// A verifier must authorize the exact offset amount before the platform can record it.
    pub fn authorize_offset(
        env: Env,
        order_id: u64,
        kg_co2: u64,
        verifier: Address,
    ) -> Result<(), CarbonError> {
        Self::require_positive_offset(kg_co2)?;
        verifier.require_auth();
        let key = DataKey::Verification(order_id);
        env.storage().persistent().set(
            &key,
            &VerifierApproval {
                kg_co2,
                verifier: verifier.clone(),
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
        env.events().publish(
            (symbol_short!("carbon"), symbol_short!("verify")),
            (order_id, kg_co2, verifier),
        );
        bump_instance(&env);
        Ok(())
    }

    /// Record a verified carbon offset for `order_id`. Callable only by the platform admin.
    /// Emits ("carbon", "offset", order_id, kg_co2).
    pub fn record_offset(
        env: Env,
        order_id: u64,
        kg_co2: u64,
        verifier: Address,
    ) -> Result<(), CarbonError> {
        Self::require_positive_offset(kg_co2)?;
        let admin = Self::load_admin(&env)?;
        admin.require_auth();

        let key = DataKey::Offset(order_id);
        let void_key = DataKey::Voided(order_id);
        let was_voided: bool = env.storage().persistent().get(&void_key).unwrap_or(false);
        if env.storage().persistent().has(&key) && !was_voided {
            return Err(CarbonError::OffsetAlreadyRecorded);
        }

        let verification_key = DataKey::Verification(order_id);
        let approval: VerifierApproval = env
            .storage()
            .persistent()
            .get(&verification_key)
            .ok_or(CarbonError::VerifierApprovalRequired)?;
        if approval.kg_co2 != kg_co2 || approval.verifier != verifier {
            return Err(CarbonError::VerifierApprovalMismatch);
        }

        let previous: Option<CarbonOffset> = if was_voided {
            env.storage().persistent().get(&key)
        } else {
            None
        };
        let record = CarbonOffset {
            order_id,
            kg_co2,
            // Payment is not handled or verified by this contract.
            offset_paid: false,
            verifier,
        };

        // Write state before publishing the event — no external calls occur in this
        // function, so there is no reentrancy window, but this keeps the pattern
        // consistent with the escrow contracts (state settled before any side effect).
        env.storage().persistent().set(&key, &record);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
        env.storage().persistent().remove(&verification_key);
        if was_voided {
            env.storage().persistent().remove(&void_key);
        }
        Self::bump_instance_ttl(&env);

        if let Some(previous) = previous {
            env.events().publish(
                (symbol_short!("carbon"), symbol_short!("reissued")),
                (order_id, previous.kg_co2, kg_co2, record.verifier.clone()),
            );
        }

        bump_instance(&env);

        env.events().publish(
            (symbol_short!("carbon"), symbol_short!("offset")),
            (order_id, kg_co2),
        );
        Ok(())
    }

    /// Public, read-only lookup of an order's carbon offset record.
    pub fn get_offset(env: Env, order_id: u64) -> Option<CarbonOffset> {
        if env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::Voided(order_id))
            .unwrap_or(false)
        {
            return None;
        }
        env.storage().persistent().get(&DataKey::Offset(order_id))
    }

    /// Amend an incorrect record. The verifier must authorize the corrected amount.
    pub fn amend_offset(
        env: Env,
        order_id: u64,
        kg_co2: u64,
        verifier: Address,
    ) -> Result<(), CarbonError> {
        Self::require_positive_offset(kg_co2)?;
        let admin = Self::load_admin(&env)?;
        admin.require_auth();
        verifier.require_auth();
        if env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::Voided(order_id))
            .unwrap_or(false)
        {
            return Err(CarbonError::CannotAmendVoided);
        }
        let key = DataKey::Offset(order_id);
        let mut record: CarbonOffset = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(CarbonError::OffsetNotFound)?;
        let previous_kg_co2 = record.kg_co2;
        record.kg_co2 = kg_co2;
        record.verifier = verifier.clone();
        record.offset_paid = false;
        env.storage().persistent().set(&key, &record);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
        Self::bump_instance_ttl(&env);
        env.events().publish(
            (symbol_short!("carbon"), symbol_short!("amended")),
            (order_id, previous_kg_co2, kg_co2, verifier),
        );
        Ok(())
    }

    /// Void an incorrect record so it can be reissued after a new verifier approval.
    pub fn void_offset(env: Env, order_id: u64) -> Result<(), CarbonError> {
        let admin = Self::load_admin(&env)?;
        admin.require_auth();
        let key = DataKey::Offset(order_id);
        if !env.storage().persistent().has(&key)
            || env
                .storage()
                .persistent()
                .get::<DataKey, bool>(&DataKey::Voided(order_id))
                .unwrap_or(false)
        {
            return Err(CarbonError::OffsetNotFound);
        }
        let record: CarbonOffset = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(CarbonError::OffsetNotFound)?;
        let void_key = DataKey::Voided(order_id);
        env.storage().persistent().set(&void_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&void_key, BUMP_THRESHOLD, BUMP_AMOUNT);
        Self::bump_instance_ttl(&env);
        env.events().publish(
            (symbol_short!("carbon"), symbol_short!("voided")),
            (order_id, record.kg_co2, record.verifier),
        );
    }

    /// Begin a two-step admin transfer. Only the current admin may propose.
    pub fn propose_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .expect("not initialized");
        admin.require_auth();
        env.storage().instance().set(&PENDING_ADMIN, &new_admin);
        env.storage().instance().set(
            &PENDING_ADMIN_EXPIRY,
            &env.ledger()
                .timestamp()
                .saturating_add(ADMIN_PROPOSAL_TTL_SECS),
        );
        Self::bump_instance_ttl(&env);
        env.events().publish(
            (symbol_short!("admin"), symbol_short!("proposed")),
            new_admin,
        );
        bump_instance(&env);
    }

    /// Complete an admin transfer. Only the proposed address may accept.
    pub fn accept_admin(env: Env) {
        let pending: Address = env
            .storage()
            .instance()
            .get(&PENDING_ADMIN)
            .expect("no pending admin");
        let expires_at: u64 = env
            .storage()
            .instance()
            .get(&PENDING_ADMIN_EXPIRY)
            .unwrap_or(0);
        assert!(
            env.ledger().timestamp() < expires_at,
            "admin proposal expired"
        );
        pending.require_auth();
        env.storage().instance().set(&ADMIN, &pending);
        env.storage().instance().remove(&PENDING_ADMIN);
        env.storage().instance().remove(&PENDING_ADMIN_EXPIRY);
        Self::bump_instance_ttl(&env);
        env.events().publish(
            (symbol_short!("admin"), symbol_short!("accepted")),
            pending,
            (order_id, record.kg_co2),
        );
        bump_instance(&env);
    }

    /// Replace this contract's WASM. Only the current admin may upgrade.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .expect("not initialized");
        admin.require_auth();
        if new_wasm_hash.to_array().iter().all(|byte| *byte == 0) {
            panic!("WASM hash must not be zero");
        }
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        Self::bump_instance_ttl(&env);
        env.events()
            .publish(
                (symbol_short!("contract"), symbol_short!("upgraded")),
                new_wasm_hash,
            );
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        bump_instance(&env);
    }

    /// Read-only view of the contract configuration. (CT-28)
    pub fn get_config(env: Env) -> Config {
        let store = env.storage().instance();
        Config {
            admin: store.get(&ADMIN),
            pending_admin: store.get(&PENDING_ADMIN),
            version: CONTRACT_VERSION,
        }
    }

    /// Contract code version. (CT-28)
    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};

    #[test]
    fn record_and_get_offset() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(CarbonOffsetContract, ());
        let client = CarbonOffsetContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);

        client.initialize(&admin);
        client.authorize_offset(&42, &120, &verifier);
        client.record_offset(&42, &120, &verifier);

        let record = client.get_offset(&42);
        assert!(record.is_some());
        let record = record.unwrap();
        assert_eq!(record.order_id, 42);
        assert_eq!(record.kg_co2, 120);
        assert!(!record.offset_paid);
        assert_eq!(record.verifier, verifier);
    }

    #[test]
    fn missing_offset_returns_none() {
        let env = Env::default();
        let contract_id = env.register(CarbonOffsetContract, ());
        let client = CarbonOffsetContractClient::new(&env, &contract_id);

        assert!(client.get_offset(&99).is_none());
    }

    #[test]
    #[should_panic(expected = "offset already recorded")]
    fn duplicate_offset_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(CarbonOffsetContract, ());
        let client = CarbonOffsetContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);

        client.initialize(&admin);
        client.authorize_offset(&1, &10, &verifier);
        client.record_offset(&1, &10, &verifier);
        client.authorize_offset(&1, &10, &verifier);
        client.record_offset(&1, &10, &verifier);
    }

    #[test]
    #[should_panic(expected = "kg_co2 must be positive")]
    fn zero_offset_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(CarbonOffsetContract, ());
        let client = CarbonOffsetContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);

        client.initialize(&admin);
        client.authorize_offset(&1, &0, &verifier);
    }

    #[test]
    #[should_panic(expected = "verifier approval required")]
    fn offset_requires_verifier_approval() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(CarbonOffsetContract, ());
        let client = CarbonOffsetContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);

        client.initialize(&admin);
        client.record_offset(&1, &10, &verifier);
    }

    #[test]
    #[should_panic]
    fn verifier_must_authorize_its_approval() {
        let env = Env::default();
        let contract_id = env.register(CarbonOffsetContract, ());
        let client = CarbonOffsetContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);
        env.mock_auths(&[&admin]);

        client.initialize(&admin);
        client.authorize_offset(&1, &10, &verifier);
    }

    #[test]
    fn admin_can_amend_and_void_then_reissue_offset() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(CarbonOffsetContract, ());
        let client = CarbonOffsetContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);

        client.initialize(&admin);
        client.authorize_offset(&1, &10, &verifier);
        client.record_offset(&1, &10, &verifier);
        client.amend_offset(&1, &12, &verifier);
        assert_eq!(client.get_offset(&1).unwrap().kg_co2, 12);

        client.void_offset(&1);
        assert!(client.get_offset(&1).is_none());
        client.authorize_offset(&1, &14, &verifier);
        client.record_offset(&1, &14, &verifier);
        assert_eq!(client.get_offset(&1).unwrap().kg_co2, 14);
    }

    #[test]
    #[should_panic(expected = "WASM hash must not be zero")]
    fn zero_upgrade_hash_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(CarbonOffsetContract, ());
        let client = CarbonOffsetContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        client.upgrade(&BytesN::from_array(&env, &[0; 32]));
    }

    #[test]
    fn instance_ttl_extended_across_calls() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(CarbonOffsetContract, ());
        let client = CarbonOffsetContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);

        client.initialize(&admin);

        // Advance the ledger past TTL_MIN between calls; the instance config
        // (admin) must still be readable because each entrypoint bumps the TTL.
        env.ledger().with_mut(|l| {
            l.sequence_number += TTL_MIN + 1;
        });

        client.record_offset(&7, &50, &verifier);

        env.ledger().with_mut(|l| {
            l.sequence_number += TTL_MIN + 1;
        });

        let record = client.get_offset(&7);
        assert_eq!(record.order_id, 7);
        assert_eq!(record.kg_co2, 50);
        Ok(())
    }
}
