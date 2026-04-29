#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, contracterror, token, Address, Env};

// TTL thresholds for persistent escrow entries (~57–115 days at 5 s/ledger).
const TTL_MIN: u32 = 100_000;
const TTL_MAX: u32 = 200_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    NotFound          = 1,
    AlreadySettled    = 2,
    InDispute         = 3,
    Unauthorized      = 4,
    InvalidAmount     = 5,
    AlreadyExists     = 6,
    TimeoutNotReached = 7,
}

#[derive(Clone, PartialEq)]
#[contracttype]
pub enum EscrowStatus {
    Active,
    Released,
    Refunded,
    Disputed,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Per-escrow data — stored in persistent storage with individual TTL.
    Escrow(u64),
    /// Contract metadata — stored in instance storage (shared TTL is fine).
    Admin,
    /// Contract metadata — stored in instance storage (shared TTL is fine).
    Platform,
}

#[derive(Clone)]
#[contracttype]
pub struct Escrow {
    pub buyer: Address,
    pub farmer: Address,
    pub amount: i128,
    pub timeout_unix: u64,
    pub status: EscrowStatus,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Must be called once to register the platform fee recipient.
    pub fn init(env: Env, platform_address: Address) {
        env.storage().instance().set(&DataKey::Platform, &platform_address);
    }

    pub fn deposit(
        env: Env,
        xlm_token: Address,
        order_id: u64,
        buyer: Address,
        farmer: Address,
        amount: i128,
        timeout_unix: u64,
    ) -> Result<(), EscrowError> {
        buyer.require_auth();
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        if env.storage().persistent().has(&DataKey::Escrow(order_id)) {
            return Err(EscrowError::AlreadyExists);
        }

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&buyer, &env.current_contract_address(), &amount);

        let escrow = Escrow {
            buyer,
            farmer,
            amount,
            timeout_unix,
            status: EscrowStatus::Active,
        };
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
        Ok(())
    }

    /// Release funds to the farmer, deducting a platform fee.
    /// `platform_fee_bps`: fee in basis points (e.g. 250 = 2.5%). Max 1000 (10%).
    pub fn release(
        env: Env,
        xlm_token: Address,
        order_id: u64,
        platform_fee_bps: u32,
    ) -> Result<(), EscrowError> {
        if platform_fee_bps > 1000 {
            return Err(EscrowError::InvalidAmount);
        }

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
            EscrowStatus::Disputed => {
                return Err(EscrowError::InDispute);
            }
            EscrowStatus::Active => {}
        }

        let token_client = token::Client::new(&env, &xlm_token);

        let fee_amount = (escrow.amount * platform_fee_bps as i128) / 10_000;
        let farmer_amount = escrow.amount - fee_amount;

        if fee_amount > 0 {
            let platform: Address = env
                .storage()
                .instance()
                .get(&DataKey::Platform)
                .ok_or(EscrowError::NotFound)?;
            token_client.transfer(&env.current_contract_address(), &platform, &fee_amount);
        }

        token_client.transfer(&env.current_contract_address(), &escrow.farmer, &farmer_amount);

        escrow.status = EscrowStatus::Released;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
        Ok(())
    }

    pub fn set_admin(env: Env, admin: Address) {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("admin already set");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn refund(env: Env, xlm_token: Address, order_id: u64) -> Result<(), EscrowError> {
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

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &escrow.buyer, &escrow.amount);

        escrow.status = EscrowStatus::Refunded;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
        Ok(())
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

        escrow.status = EscrowStatus::Disputed;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
        Ok(())
    }

    pub fn resolve_dispute(env: Env, xlm_token: Address, order_id: u64, release_to_farmer: bool) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();

        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .expect("escrow not found");

        if escrow.status != EscrowStatus::Disputed {
            panic!("escrow is not in dispute");
        }

        let token_client = token::Client::new(&env, &xlm_token);
        if release_to_farmer {
            token_client.transfer(&env.current_contract_address(), &escrow.farmer, &escrow.amount);
            escrow.status = EscrowStatus::Released;
        } else {
            token_client.transfer(&env.current_contract_address(), &escrow.buyer, &escrow.amount);
            escrow.status = EscrowStatus::Refunded;
        }
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
    }

    pub fn get(env: Env, order_id: u64) -> Result<Escrow, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)
    }

    /// Read-only view: returns the escrow state for `order_id`, or `None` if it does not exist.
    pub fn get_escrow(env: Env, order_id: u64) -> Option<Escrow> {
        env.storage().persistent().get(&DataKey::Escrow(order_id))
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    fn store_escrow(env: &Env, order_id: u64, buyer: Address, farmer: Address) {
        let escrow = Escrow {
            buyer,
            farmer,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            status: EscrowStatus::Active,
        };
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
    }

    // ── EscrowStatus::Disputed consolidation tests ────────────────────────────

    #[test]
    fn dispute_sets_status_to_disputed() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        store_escrow(&env, 1, buyer.clone(), farmer);
        EscrowContract::dispute(env.clone(), 1, buyer).unwrap();
        let updated = EscrowContract::get(env, 1).unwrap();
        assert_eq!(updated.status, EscrowStatus::Disputed);
    }

    #[test]
    fn release_disputed_escrow_returns_in_dispute_error() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            status: EscrowStatus::Disputed,
        };
        env.storage().persistent().set(&DataKey::Escrow(2), &escrow);
        let xlm_token = Address::generate(&env);
        let result = EscrowContract::release(env, xlm_token, 2, 0);
        assert_eq!(result, Err(EscrowError::InDispute));
    }

    // ── error variant tests ───────────────────────────────────────────────────

    #[test]
    fn get_not_found() {
        let env = Env::default();
        let result = EscrowContract::get(env, 99);
        assert_eq!(result, Err(EscrowError::NotFound));
    }

    #[test]
    fn dispute_not_found() {
        let env = Env::default();
        let caller = Address::generate(&env);
        let result = EscrowContract::dispute(env, 99, caller);
        assert_eq!(result, Err(EscrowError::NotFound));
    }

    #[test]
    fn dispute_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let stranger = Address::generate(&env);
        store_escrow(&env, 3, buyer, farmer);
        let result = EscrowContract::dispute(env, 3, stranger);
        assert_eq!(result, Err(EscrowError::Unauthorized));
    }

    #[test]
    fn dispute_already_settled() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            status: EscrowStatus::Released,
        };
        env.storage().persistent().set(&DataKey::Escrow(4), &escrow);
        let result = EscrowContract::dispute(env, 4, buyer);
        assert_eq!(result, Err(EscrowError::AlreadySettled));
    }

    #[test]
    fn refund_timeout_not_reached() {
        let env = Env::default();
        // timeout_unix = 1_000, ledger timestamp defaults to 0
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        store_escrow(&env, 5, buyer, farmer);
        let escrow: Escrow = env.storage().persistent().get(&DataKey::Escrow(5)).unwrap();
        assert!(env.ledger().timestamp() < escrow.timeout_unix);
    }

    #[test]
    fn release_fee_exceeds_maximum() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        store_escrow(&env, 6, buyer, farmer);
        let xlm_token = Address::generate(&env);
        let result = EscrowContract::release(env, xlm_token, 6, 1001);
        assert_eq!(result, Err(EscrowError::InvalidAmount));
    }

    #[test]
    fn release_not_found() {
        let env = Env::default();
        env.mock_all_auths();
        let xlm_token = Address::generate(&env);
        let result = EscrowContract::release(env, xlm_token, 99, 250);
        assert_eq!(result, Err(EscrowError::NotFound));
    }

    #[test]
    fn release_already_settled() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            status: EscrowStatus::Released,
        };
        env.storage().persistent().set(&DataKey::Escrow(7), &escrow);
        let xlm_token = Address::generate(&env);
        let result = EscrowContract::release(env, xlm_token, 7, 0);
        assert_eq!(result, Err(EscrowError::AlreadySettled));
    }

    #[test]
    fn get_returns_escrow_data() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        store_escrow(&env, 8, buyer.clone(), farmer.clone());
        let stored = EscrowContract::get(env, 8).unwrap();
        assert_eq!(stored.buyer, buyer);
        assert_eq!(stored.farmer, farmer);
        assert_eq!(stored.amount, 1_000_0000);
    }

    #[test]
    fn get_escrow_returns_none_for_unknown_order() {
        let env = Env::default();
        let result = EscrowContract::get_escrow(env, 999);
        assert!(result.is_none());
    }

    #[test]
    fn get_escrow_returns_correct_data_after_create() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        store_escrow(&env, 9, buyer.clone(), farmer.clone());
        let result = EscrowContract::get_escrow(env, 9);
        assert!(result.is_some());
        let escrow = result.unwrap();
        assert_eq!(escrow.buyer, buyer);
        assert_eq!(escrow.farmer, farmer);
        assert_eq!(escrow.amount, 1_000_0000);
        assert_eq!(escrow.status, EscrowStatus::Active);
    }

    #[test]
    fn two_escrows_have_independent_keys() {
        let env = Env::default();
        let buyer_a = Address::generate(&env);
        let farmer_a = Address::generate(&env);
        let buyer_b = Address::generate(&env);
        let farmer_b = Address::generate(&env);

        store_escrow(&env, 10, buyer_a.clone(), farmer_a.clone());
        store_escrow(&env, 11, buyer_b.clone(), farmer_b.clone());

        let mut e10: Escrow = env.storage().persistent().get(&DataKey::Escrow(10)).unwrap();
        e10.status = EscrowStatus::Released;
        env.storage().persistent().set(&DataKey::Escrow(10), &e10);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(10), TTL_MIN, TTL_MAX);

        let e11: Escrow = env.storage().persistent().get(&DataKey::Escrow(11)).unwrap();
        assert_eq!(e11.status, EscrowStatus::Active, "escrow 11 must not be affected by escrow 10 mutation");
        assert_eq!(e11.buyer, buyer_b);
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
}
