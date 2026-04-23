#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Escrow(u64),
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
            panic!("refund timeout has not passed");
        }

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &escrow.buyer, &escrow.amount);

        escrow.refunded = true;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
    }

    pub fn dispute(env: Env, order_id: u64, caller: Address) {
        caller.require_auth();
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .expect("escrow not found");

        if caller != escrow.buyer && caller != escrow.farmer {
            panic!("caller is not part of this escrow");
        }
        if escrow.released || escrow.refunded {
            panic!("escrow already settled");
        }

        escrow.disputed = true;
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
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn dispute_marks_escrow() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);

        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            released: false,
            refunded: false,
            disputed: false,
        };

        env.storage().persistent().set(&DataKey::Escrow(1), &escrow);

        EscrowContract::dispute(env.clone(), 1, buyer);
        let updated = EscrowContract::get(env, 1);
        assert!(updated.disputed);
    }

    #[test]
    fn get_returns_escrow_data() {
        let env = Env::default();
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

        env.storage().persistent().set(&DataKey::Escrow(2), &escrow);

        let stored = EscrowContract::get(env, 2);
        assert_eq!(stored.buyer, buyer);
        assert_eq!(stored.farmer, farmer);
        assert_eq!(stored.amount, 1_000_0000);
    }
}
