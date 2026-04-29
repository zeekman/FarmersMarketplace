
#![no_std]

mod errors;
mod types;

use errors::EscrowError;
use types::{EscrowData, EscrowStatus};

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    token::Client as TokenClient,
    Address, Env,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Escrow(u64),
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Create a new escrow for a specific order ID. Transfers `amount` of `token` from `payer` to this contract.
    /// `deadline` is an optional ledger timestamp after which the payer may reclaim funds.
    pub fn create(
        env: Env,
        order_id: u64,
        payer: Address,
        freelancer: Address,
        token: Address,
        amount: i128,
        deadline: Option<u64>,
    ) -> Result<(), EscrowError> {
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        if env.storage().instance().has(&DataKey::Escrow(order_id)) {
            return Err(EscrowError::AlreadyExists);
        }

        payer.require_auth();

        // Transfer funds from payer into the contract
        TokenClient::new(&env, &token).transfer(
            &payer,
            &env.current_contract_address(),
            &amount,
        );

        let data = EscrowData {
            payer,
            freelancer,
            token,
            amount,
            status: EscrowStatus::Active,
            deadline,
        };

        env.storage().instance().set(&DataKey::Escrow(order_id), &data);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("created")),
            data.amount,
        );

        Ok(())
    }

    /// Freelancer signals that work is complete.
    pub fn submit_work(env: Env, order_id: u64) -> Result<(), EscrowError> {
        let mut data: EscrowData = Self::load(&env, order_id)?;

        data.freelancer.require_auth();

        if data.status != EscrowStatus::Active {
            return Err(EscrowError::NotActive);
        }

        data.status = EscrowStatus::WorkSubmitted;
        env.storage().instance().set(&DataKey::Escrow(order_id), &data);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("submitted")),
            (),
        );

        Ok(())
    }

    /// Payer approves the work and releases funds to the freelancer.
    /// Token address is read from storage — no longer passed by caller.
    pub fn approve(env: Env, order_id: u64) -> Result<(), EscrowError> {
        let mut data: EscrowData = Self::load(&env, order_id)?;

        data.payer.require_auth();

        if data.status != EscrowStatus::WorkSubmitted {
            return Err(EscrowError::WorkNotSubmitted);
        }

        TokenClient::new(&env, &data.token).transfer(
            &env.current_contract_address(),
            &data.freelancer,
            &data.amount,
        );

        data.status = EscrowStatus::Approved;
        env.storage().instance().set(&DataKey::Escrow(order_id), &data);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("approved")),
            data.amount,
        );

        Ok(())
    }

    /// Payer cancels the escrow and reclaims funds (only while Active).
    /// Token address is read from storage — no longer passed by caller.
    pub fn cancel(env: Env, order_id: u64) -> Result<(), EscrowError> {
        let mut data: EscrowData = Self::load(&env, order_id)?;

        data.payer.require_auth();

        if data.status != EscrowStatus::Active {
            return Err(EscrowError::NotActive);
        }

        TokenClient::new(&env, &data.token).transfer(
            &env.current_contract_address(),
            &data.payer,
            &data.amount,
        );

        data.status = EscrowStatus::Cancelled;
        env.storage().instance().set(&DataKey::Escrow(order_id), &data);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("cancelled")),
            data.amount,
        );

        Ok(())
    }

    /// Payer reclaims funds after the deadline has passed.
    /// Fails if no deadline was set or deadline has not been reached yet.
    pub fn expire(env: Env, order_id: u64) -> Result<(), EscrowError> {
        let mut data: EscrowData = Self::load(&env, order_id)?;

        data.payer.require_auth();

        if data.status != EscrowStatus::Active {
            return Err(EscrowError::NotActive);
        }

        let deadline = data.deadline.ok_or(EscrowError::NoDeadline)?;

        if env.ledger().timestamp() <= deadline {
            return Err(EscrowError::DeadlineNotReached);
        }

        TokenClient::new(&env, &data.token).transfer(
            &env.current_contract_address(),
            &data.payer,
            &data.amount,
        );

        data.status = EscrowStatus::Expired;
        env.storage().instance().set(&DataKey::Escrow(order_id), &data);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("expired")),
            data.amount,
        );

        Ok(())
    }

    /// Returns the full escrow record for a specific order ID.
    pub fn get_escrow(env: Env, order_id: u64) -> Result<EscrowData, EscrowError> {
        Self::load(&env, order_id)
    }

    /// Returns only the current status — lightweight for UIs.
    pub fn get_status(env: Env, order_id: u64) -> Result<EscrowStatus, EscrowError> {
        Ok(Self::load(&env, order_id)?.status)
    }

    // ── Internal helpers ────────────────────────────────────────────────────

    fn load(env: &Env, order_id: u64) -> Result<EscrowData, EscrowError> {
        env.storage()
            .instance()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotActive)
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Env,
    };

    /// Deploy a test token and mint `amount` to `to`.
    fn setup_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_addr = token_id.address();
        StellarAssetClient::new(env, &token_addr).mint(to, &amount);
        token_addr
    }

    fn setup() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let payer     = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let admin     = Address::generate(&env);
        let token     = setup_token(&env, &admin, &payer, 1_000);
        let contract  = env.register_contract(None, EscrowContract);
        (env, payer, freelancer, token, contract)
    }

    // ── create ───────────────────────────────────────────────────────────────

    #[test]
    fn test_create_success() {
        let (env, payer, freelancer, token, contract) = setup();
        let client = EscrowContractClient::new(&env, &contract);
        client.create(&1, &payer, &freelancer, &token, &500, &None);
        assert_eq!(client.get_status(&1), EscrowStatus::Active);
    }

    #[test]
    fn test_create_invalid_amount() {
        let (env, payer, freelancer, token, contract) = setup();
        let client = EscrowContractClient::new(&env, &contract);
        let err = client.try_create(&1, &payer, &freelancer, &token, &0, &None).unwrap_err().unwrap();
        assert_eq!(err, EscrowError::InvalidAmount);
    }

    #[test]
    fn test_create_already_exists() {
        let (env, payer, freelancer, token, contract) = setup();
        let client = EscrowContractClient::new(&env, &contract);
        client.create(&1, &payer, &freelancer, &token, &100, &None);
        let err = client.try_create(&1, &payer, &freelancer, &token, &100, &None).unwrap_err().unwrap();
        assert_eq!(err, EscrowError::AlreadyExists);
    }

    #[test]
    fn test_create_with_deadline() {
        let (env, payer, freelancer, token, contract) = setup();
        let client = EscrowContractClient::new(&env, &contract);
        client.create(&1, &payer, &freelancer, &token, &200, &Some(9999));
        let data = client.get_escrow(&1);
        assert_eq!(data.deadline, Some(9999));
    }

    #[test]
    fn test_multiple_order_ids_coexist() {
        let (env, payer, freelancer, token, contract) = setup();
        let client = EscrowContractClient::new(&env, &contract);
        
        // Create escrow for order 1
        client.create(&1, &payer, &freelancer, &token, &100, &None);
        assert_eq!(client.get_status(&1), EscrowStatus::Active);
        
        // Create escrow for order 2 with same parties but different amount
        client.create(&2, &payer, &freelancer, &token, &200, &None);
        assert_eq!(client.get_status(&2), EscrowStatus::Active);
        
        // Both escrows should exist independently
        let data1 = client.get_escrow(&1);
        let data2 = client.get_escrow(&2);
        assert_eq!(data1.amount, 100);
        assert_eq!(data2.amount, 200);
    }

    // ── submit_work ──────────────────────────────────────────────────────────

    #[test]
    fn test_submit_work() {
        let (env, payer, freelancer, token, contract) = setup();
        let client = EscrowContractClient::new(&env, &contract);
        client.create(&1, &payer, &freelancer, &token, &500, &None);
        client.submit_work(&1);
        assert_eq!(client.get_status(&1), EscrowStatus::WorkSubmitted);
    }

    #[test]
    fn test_submit_work_not_active() {
        let (env, payer, freelancer, token, contract) = setup();
        let client = EscrowContractClient::new(&env, &contract);
        client.create(&1, &payer, &freelancer, &token, &500, &None);
        client.submit_work(&1);
        // Submitting again should fail — no longer Active
        let err = client.try_submit_work(&1).unwrap_err().unwrap();
        assert_eq!(err, EscrowError::NotActive);
    }

    // ── approve ──────────────────────────────────────────────────────────────

    #[test]
    fn test_approve_releases_funds() {
        let (env, payer, freelancer, token, contract) = setup();
        let client = EscrowContractClient::new(&env, &contract);
        client.create(&1, &payer, &freelancer, &token, &500, &None);
        client.submit_work(&1);
        client.approve(&1);
        assert_eq!(client.get_status(&1), EscrowStatus::Approved);
        assert_eq!(TokenClient::new(&env, &token).balance(&freelancer), 500);
    }

    #[test]
    fn test_approve_without_submission_fails() {
        let (env, payer, freelancer, token, contract) = setup();
        let client = EscrowContractClient::new(&env, &contract);
        client.create(&1, &payer, &freelancer, &token, &500, &None);
        let err = client.try_approve(&1).unwrap_err().unwrap();
        assert_eq!(err, EscrowError::WorkNotSubmitted);
    }

    // ── cancel ───────────────────────────────────────────────────────────────

    #[test]
    fn test_cancel_refunds_payer() {
        let (env, payer, freelancer, token, contract) = setup();
        let client = EscrowContractClient::new(&env, &contract);
        client.create(&1, &payer, &freelancer, &token, &500, &None);
        client.cancel(&1);
        assert_eq!(client.get_status(&1), EscrowStatus::Cancelled);
        assert_eq!(TokenClient::new(&env, &token).balance(&payer), 1_000);
    }

    #[test]
    fn test_cancel_after_submission_fails() {
        let (env, payer, freelancer, token, contract) = setup();
        let client = EscrowContractClient::new(&env, &contract);
        client.create(&1, &payer, &freelancer, &token, &500, &None);
        client.submit_work(&1);
        let err = client.try_cancel(&1).unwrap_err().unwrap();
        assert_eq!(err, EscrowError::NotActive);
    }

    // ── expire ───────────────────────────────────────────────────────────────

    #[test]
    fn test_expire_before_deadline_fails() {
        let (env, payer, freelancer, token, contract) = setup();
        env.ledger().set_timestamp(1000);
        let client = EscrowContractClient::new(&env, &contract);
        client.create(&1, &payer, &freelancer, &token, &500, &Some(2000));
        // Timestamp 1000 <= deadline 2000 — should fail
        let err = client.try_expire(&1).unwrap_err().unwrap();
        assert_eq!(err, EscrowError::DeadlineNotReached);
    }

    #[test]
    fn test_expire_after_deadline_succeeds() {
        let (env, payer, freelancer, token, contract) = setup();
        env.ledger().set_timestamp(1000);
        let client = EscrowContractClient::new(&env, &contract);
        client.create(&1, &payer, &freelancer, &token, &500, &Some(999));
        // Timestamp 1000 > deadline 999 — should succeed
        client.expire(&1);
        assert_eq!(client.get_status(&1), EscrowStatus::Expired);
        assert_eq!(TokenClient::new(&env, &token).balance(&payer), 1_000);
    }

    #[test]
    fn test_expire_no_deadline_fails() {
        let (env, payer, freelancer, token, contract) = setup();
        let client = EscrowContractClient::new(&env, &contract);
        client.create(&1, &payer, &freelancer, &token, &500, &None);
        let err = client.try_expire(&1).unwrap_err().unwrap();
        assert_eq!(err, EscrowError::NoDeadline);
    }

    // ── get_status ───────────────────────────────────────────────────────────

    #[test]
    fn test_get_status_lifecycle() {
        let (env, payer, freelancer, token, contract) = setup();
        let client = EscrowContractClient::new(&env, &contract);

        client.create(&1, &payer, &freelancer, &token, &500, &None);
        assert_eq!(client.get_status(&1), EscrowStatus::Active);

        client.submit_work(&1);
        assert_eq!(client.get_status(&1), EscrowStatus::WorkSubmitted);

        client.approve(&1);
        assert_eq!(client.get_status(&1), EscrowStatus::Approved);
    }
}
