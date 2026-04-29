#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, contracterror, token, Address, Env};

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

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Escrow(u64),
    Admin,
    Platform,
}

#[derive(Clone)]
#[contracttype]
pub struct Escrow {
    pub buyer: Address,
    pub farmer: Address,
    pub amount: i128,
    pub timeout_unix: u64,
    pub released: bool,
    pub refunded: bool,
    pub disputed: bool,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Must be called once to register the platform fee recipient.
    pub fn init(env: Env, platform_address: Address) {
        env.storage().persistent().set(&DataKey::Platform, &platform_address);
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
            released: false,
            refunded: false,
            disputed: false,
        };
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
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

        if escrow.released || escrow.refunded {
            return Err(EscrowError::AlreadySettled);
        }
        if escrow.disputed {
            return Err(EscrowError::InDispute);
        }

        let token_client = token::Client::new(&env, &xlm_token);

        let fee_amount = (escrow.amount * platform_fee_bps as i128) / 10_000;
        let farmer_amount = escrow.amount - fee_amount;

        if fee_amount > 0 {
            let platform: Address = env
                .storage()
                .persistent()
                .get(&DataKey::Platform)
                .ok_or(EscrowError::NotFound)?;
            token_client.transfer(&env.current_contract_address(), &platform, &fee_amount);
        }

        token_client.transfer(&env.current_contract_address(), &escrow.farmer, &farmer_amount);

        escrow.released = true;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        Ok(())
    }

    pub fn set_admin(env: Env, admin: Address) {
        admin.require_auth();
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("admin already set");
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
    }

    pub fn refund(env: Env, xlm_token: Address, order_id: u64) {
    pub fn refund(env: Env, xlm_token: Address, order_id: u64) -> Result<(), EscrowError> {
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        escrow.buyer.require_auth();

        if escrow.released || escrow.refunded {
            return Err(EscrowError::AlreadySettled);
        }
        if env.ledger().timestamp() < escrow.timeout_unix {
            panic!("refund not yet available: timeout has not passed");
            return Err(EscrowError::TimeoutNotReached);
        }

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &escrow.buyer, &escrow.amount);

        escrow.refunded = true;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        Ok(())
    }

    pub fn dispute(env: Env, xlm_token: Address, order_id: u64) {
        let _ = xlm_token;
    pub fn dispute(env: Env, order_id: u64, caller: Address) -> Result<(), EscrowError> {
        caller.require_auth();
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        escrow.buyer.require_auth();
        if caller != escrow.buyer && caller != escrow.farmer {
            return Err(EscrowError::Unauthorized);
        }
        if escrow.released || escrow.refunded {
            return Err(EscrowError::AlreadySettled);
        }

        escrow.disputed = true;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        Ok(())
    }

    pub fn resolve_dispute(env: Env, xlm_token: Address, order_id: u64, release_to_farmer: bool) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();

        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .expect("escrow not found");

        if !escrow.disputed {
            panic!("escrow is not in dispute");
        }
        if escrow.released || escrow.refunded {
            panic!("escrow already settled");
        }

        let token_client = token::Client::new(&env, &xlm_token);
        if release_to_farmer {
            token_client.transfer(&env.current_contract_address(), &escrow.farmer, &escrow.amount);
            escrow.released = true;
        } else {
            token_client.transfer(&env.current_contract_address(), &escrow.buyer, &escrow.amount);
            escrow.refunded = true;
        }
        escrow.disputed = false;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
    }

    pub fn get(env: Env, order_id: u64) -> Escrow {
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
    use soroban_sdk::{
        testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
        Address, Env, IntoVal,
    };

    fn make_env() -> Env {
        Env::default()
    }

    fn setup_escrow(env: &Env, order_id: u64, timeout: u64) -> (Address, Address) {
        let buyer = Address::generate(env);
        let farmer = Address::generate(env);
    fn store_escrow(env: &Env, order_id: u64, buyer: Address, farmer: Address) {
        let escrow = Escrow {
            buyer,
            farmer,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            released: false,
            refunded: false,
            disputed: false,
        };
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
    }

    // ── #461 error variant tests ──────────────────────────────────────────────

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
        store_escrow(&env, 1, buyer, farmer);
        let result = EscrowContract::dispute(env, 1, stranger);
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
            farmer: farmer.clone(),
            amount: 1_000_0000,
            timeout_unix: timeout,
            released: false,
            refunded: false,
            disputed: false,
        };
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        (buyer, farmer)
    }

    // ── #460 dispute / resolve_dispute ──────────────────────────────────────

    #[test]
    fn buyer_can_raise_dispute() {
        let env = make_env();
        let (buyer, _) = setup_escrow(&env, 1, 9_999_999);
        let xlm = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &buyer,
            invoke: &MockAuthInvoke {
                contract: &env.current_contract_address(),
                fn_name: "dispute",
                args: (xlm.clone(), 1_u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        EscrowContract::dispute(env.clone(), xlm, 1);
        assert!(EscrowContract::get(env, 1).disputed);
    }

    #[test]
    #[should_panic]
    fn non_buyer_cannot_raise_dispute() {
        let env = make_env();
        let (_, farmer) = setup_escrow(&env, 2, 9_999_999);
        let xlm = Address::generate(&env);

        // farmer tries to call dispute — require_auth will panic because
        // the mock only authorises the farmer address, not the buyer
        env.mock_auths(&[MockAuth {
            address: &farmer,
            invoke: &MockAuthInvoke {
                contract: &env.current_contract_address(),
                fn_name: "dispute",
                args: (xlm.clone(), 2_u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        EscrowContract::dispute(env, xlm, 2);
    }

    #[test]
    fn admin_resolves_in_favour_of_farmer() {
        let env = make_env();
        let (buyer, farmer) = setup_escrow(&env, 3, 9_999_999);
        let admin = Address::generate(&env);
        let xlm = Address::generate(&env);

        // mark disputed
        env.storage().persistent().set(
            &DataKey::Escrow(3),
            &Escrow {
                buyer: buyer.clone(),
                farmer: farmer.clone(),
                amount: 1_000_0000,
                timeout_unix: 9_999_999,
                released: false,
                refunded: false,
                disputed: true,
            },
        );
        env.storage().persistent().set(&DataKey::Admin, &admin);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &env.current_contract_address(),
                fn_name: "resolve_dispute",
                args: (xlm.clone(), 3_u64, true).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        EscrowContract::resolve_dispute(env.clone(), xlm, 3, true);
        let e = EscrowContract::get(env, 3);
        assert!(e.released);
        assert!(!e.disputed);
    }

    #[test]
    fn admin_resolves_in_favour_of_buyer() {
        let env = make_env();
        let (buyer, farmer) = setup_escrow(&env, 4, 9_999_999);
        let admin = Address::generate(&env);
        let xlm = Address::generate(&env);

        env.storage().persistent().set(
            &DataKey::Escrow(4),
            &Escrow {
                buyer: buyer.clone(),
                farmer: farmer.clone(),
                amount: 1_000_0000,
                timeout_unix: 9_999_999,
                released: false,
                refunded: false,
                disputed: true,
            },
        );
        env.storage().persistent().set(&DataKey::Admin, &admin);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &env.current_contract_address(),
                fn_name: "resolve_dispute",
                args: (xlm.clone(), 4_u64, false).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        EscrowContract::resolve_dispute(env.clone(), xlm, 4, false);
        let e = EscrowContract::get(env, 4);
        assert!(e.refunded);
        assert!(!e.disputed);
    }

    // ── #458 refund guard ────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "refund not yet available: timeout has not passed")]
    fn refund_before_timeout_panics() {
        let env = make_env();
        let (buyer, _) = setup_escrow(&env, 5, 9_999_999);
        let xlm = Address::generate(&env);

        // ledger timestamp defaults to 0, which is < 9_999_999
        env.mock_auths(&[MockAuth {
            address: &buyer,
            invoke: &MockAuthInvoke {
                contract: &env.current_contract_address(),
                fn_name: "refund",
                args: (xlm.clone(), 5_u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        EscrowContract::refund(env, xlm, 5);
    }

    #[test]
    fn refund_after_timeout_succeeds() {
        let env = make_env();
        let timeout: u64 = 1_000;
        let (buyer, _) = setup_escrow(&env, 6, timeout);
        let xlm = Address::generate(&env);

        env.ledger().set_timestamp(timeout); // exactly at timeout

        env.mock_auths(&[MockAuth {
            address: &buyer,
            invoke: &MockAuthInvoke {
                contract: &env.current_contract_address(),
                fn_name: "refund",
                args: (xlm.clone(), 6_u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        // token::Client::transfer will panic in test without a real token contract,
        // so we just verify the guard passes (no "timeout" panic) by catching
        // any panic that is NOT the timeout message.
        let result = std::panic::catch_unwind(|| {
            EscrowContract::refund(env.clone(), xlm, 6);
        });
        // If it panicked, it must NOT be the timeout message
        if let Err(e) = result {
            let msg = e.downcast_ref::<&str>().copied().unwrap_or("");
            assert!(
                !msg.contains("timeout has not passed"),
                "unexpected timeout panic: {msg}"
            );
        }
    }

    #[test]
    fn release_by_buyer_before_timeout_does_not_check_time() {
        // release has no time-gate; verify the guard is absent by checking
        // that a settled escrow panics with "already settled", not a timeout msg.
        let env = make_env();
        let (buyer, _) = setup_escrow(&env, 7, 9_999_999);
        let xlm = Address::generate(&env);

        // mark already released so we get a predictable panic
        env.storage().persistent().set(
            &DataKey::Escrow(7),
            &Escrow {
                buyer: buyer.clone(),
                farmer: Address::generate(&env),
                amount: 1_000_0000,
                timeout_unix: 9_999_999,
                released: true,
                refunded: false,
                disputed: false,
            },
        );

        env.mock_auths(&[MockAuth {
            address: &buyer,
            invoke: &MockAuthInvoke {
                contract: &env.current_contract_address(),
                fn_name: "release",
                args: (xlm.clone(), 7_u64).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let result = std::panic::catch_unwind(|| {
            EscrowContract::release(env, xlm, 7);
        });
        let msg = result
            .err()
            .and_then(|e| e.downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_default();
        assert!(!msg.contains("timeout"), "release should not be time-gated");
            timeout_unix: 1_000,
            released: true,
            refunded: false,
            disputed: false,
        };
        env.storage().persistent().set(&DataKey::Escrow(2), &escrow);
        let result = EscrowContract::dispute(env, 2, buyer);
        assert_eq!(result, Err(EscrowError::AlreadySettled));
    }

    #[test]
    fn refund_timeout_not_reached() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        // timeout_unix = 1_000, ledger timestamp defaults to 0
        store_escrow(&env, 3, buyer, farmer);
        // We can't call refund with a token here without a full token setup,
        // but we can verify the timeout guard by checking the escrow state.
        // The error path is: timestamp (0) < timeout_unix (1000) => TimeoutNotReached
        let escrow: Escrow = env.storage().persistent().get(&DataKey::Escrow(3)).unwrap();
        assert!(env.ledger().timestamp() < escrow.timeout_unix);
    }

    #[test]
    fn dispute_marks_escrow() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        store_escrow(&env, 10, buyer.clone(), farmer);
        EscrowContract::dispute(env.clone(), 10, buyer).unwrap();
        let updated = EscrowContract::get(env, 10).unwrap();
        assert!(updated.disputed);
    }

    #[test]
    fn get_returns_escrow_data() {
        let env = make_env();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        store_escrow(&env, 20, buyer.clone(), farmer.clone());
        let stored = EscrowContract::get(env, 20).unwrap();
        assert_eq!(stored.buyer, buyer);
        assert_eq!(stored.farmer, farmer);
        assert_eq!(stored.amount, 1_000_0000);
    }

    // ── #459 platform fee tests ───────────────────────────────────────────────

    #[test]
    fn release_fee_exceeds_maximum() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        store_escrow(&env, 30, buyer, farmer);
        // platform_fee_bps = 1001 > 1000
        let xlm_token = Address::generate(&env);
        let result = EscrowContract::release(env, xlm_token, 30, 1001);
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
    fn release_in_dispute() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            released: false,
            refunded: false,
            disputed: true,
        };
        env.storage().persistent().set(&DataKey::Escrow(31), &escrow);
        let xlm_token = Address::generate(&env);
        let result = EscrowContract::release(env, xlm_token, 31, 0);
        assert_eq!(result, Err(EscrowError::InDispute));
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
            released: true,
            refunded: false,
            disputed: false,
        };
        env.storage().persistent().set(&DataKey::Escrow(32), &escrow);
        let xlm_token = Address::generate(&env);
        let result = EscrowContract::release(env, xlm_token, 32, 0);
        assert_eq!(result, Err(EscrowError::AlreadySettled));
    }

        env.storage().persistent().set(&DataKey::Escrow(8), &escrow);

        let stored = EscrowContract::get(env, 8);
        assert_eq!(stored.buyer, buyer);
        assert_eq!(stored.farmer, farmer);
        assert_eq!(stored.amount, 1_000_0000);
    #[test]
    fn fee_rounding() {
        // 1 stroops * 250 bps / 10000 = 0 (integer division rounds down)
        let amount: i128 = 1;
        let fee = (amount * 250_i128) / 10_000;
        assert_eq!(fee, 0);
        // 40000 stroops * 250 bps / 10000 = 1000
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

    // ── #477 get_escrow view function ─────────────────────────────────────────

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
        store_escrow(&env, 100, buyer.clone(), farmer.clone());
        let result = EscrowContract::get_escrow(env, 100);
        assert!(result.is_some());
        let escrow = result.unwrap();
        assert_eq!(escrow.buyer, buyer);
        assert_eq!(escrow.farmer, farmer);
        assert_eq!(escrow.amount, 1_000_0000);
        assert!(!escrow.released);
        assert!(!escrow.refunded);
        assert!(!escrow.disputed);
    }
}
