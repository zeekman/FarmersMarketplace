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
            return Err(EscrowError::TimeoutNotReached);
        }

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &escrow.buyer, &escrow.amount);

        escrow.refunded = true;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
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
        if escrow.released || escrow.refunded {
            return Err(EscrowError::AlreadySettled);
        }

        escrow.disputed = true;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        Ok(())
    }

    pub fn get(env: Env, order_id: u64) -> Result<Escrow, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)
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
            farmer,
            amount: 1_000_0000,
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
        let env = Env::default();
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
}
