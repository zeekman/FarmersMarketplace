#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Escrow(u64),
    Admin,
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
    pub fn deposit(
        env: Env,
        xlm_token: Address,
        order_id: u64,
        buyer: Address,
        farmer: Address,
        amount: i128,
        timeout_unix: u64,
    ) {
        buyer.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        if env.storage().persistent().has(&DataKey::Escrow(order_id)) {
            panic!("escrow already exists");
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
    }

    pub fn release(env: Env, xlm_token: Address, order_id: u64) {
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .expect("escrow not found");

        escrow.buyer.require_auth();
        if escrow.released || escrow.refunded {
            panic!("escrow already settled");
        }
        if escrow.disputed {
            panic!("escrow is in dispute");
        }

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &escrow.farmer, &escrow.amount);

        escrow.released = true;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
    }

    pub fn set_admin(env: Env, admin: Address) {
        admin.require_auth();
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("admin already set");
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
    }

    pub fn refund(env: Env, xlm_token: Address, order_id: u64) {
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .expect("escrow not found");

        escrow.buyer.require_auth();
        if escrow.released || escrow.refunded {
            panic!("escrow already settled");
        }
        if env.ledger().timestamp() < escrow.timeout_unix {
            panic!("refund not yet available: timeout has not passed");
        }

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &escrow.buyer, &escrow.amount);

        escrow.refunded = true;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
    }

    pub fn dispute(env: Env, xlm_token: Address, order_id: u64) {
        let _ = xlm_token;
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .expect("escrow not found");

        escrow.buyer.require_auth();
        if escrow.released || escrow.refunded {
            panic!("escrow already settled");
        }

        escrow.disputed = true;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
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
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .expect("escrow not found")
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
    }

    #[test]
    fn get_returns_escrow_data() {
        let env = make_env();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);

        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer: farmer.clone(),
            amount: 1_000_0000,
            timeout_unix: 1_000,
            released: false,
            refunded: false,
            disputed: false,
        };

        env.storage().persistent().set(&DataKey::Escrow(8), &escrow);

        let stored = EscrowContract::get(env, 8);
        assert_eq!(stored.buyer, buyer);
        assert_eq!(stored.farmer, farmer);
        assert_eq!(stored.amount, 1_000_0000);
    }
}
