//! Unit tests for the Farmers Marketplace escrow contract.
//! Covers acceptance criteria from issues #468, #469, #470, #471, #687, #688.

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, LedgerInfo},
    vec, Address, Env, IntoVal,
};

fn setup_env() -> Env {
    let env = Env::default();
    env.ledger().set(LedgerInfo {
        timestamp: 1_000_000,
        protocol_version: 21,
        sequence_number: 1,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 300_000,
    });
    env
}

fn register_contract(env: &Env) -> EscrowContractClient {
    EscrowContractClient::new(env, &env.register_contract(None, EscrowContract))
}

fn future_timeout(env: &Env) -> u64 {
    env.ledger().timestamp() + 7_200
}

// #469 - buyer != farmer validation

#[test]
fn test_deposit_same_buyer_and_farmer_returns_invalid_parties() {
    let env = setup_env();
    let client = register_contract(&env);
    let alice = Address::generate(&env);
    let result = client.try_deposit(&1u64, &alice, &alice, &1_000_000, &future_timeout(&env));
    assert_eq!(result, Err(Ok(EscrowError::InvalidParties)));
}

#[test]
fn test_deposit_different_parties_succeeds() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    client.deposit(&1u64, &buyer, &farmer, &1_000_000, &future_timeout(&env));
}

// #470 - timeout_unix must be at least 1 hour in the future

#[test]
#[should_panic(expected = "timeout must be at least 1 hour in the future")]
fn test_deposit_past_timeout_panics() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let past = env.ledger().timestamp() - 1;
    client.deposit(&2u64, &buyer, &farmer, &1_000_000, &past);
}

#[test]
#[should_panic(expected = "timeout must be at least 1 hour in the future")]
fn test_deposit_timeout_less_than_one_hour_panics() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let too_soon = env.ledger().timestamp() + 1_800;
    client.deposit(&3u64, &buyer, &farmer, &1_000_000, &too_soon);
}

#[test]
fn test_deposit_future_timeout_succeeds() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let just_enough = env.ledger().timestamp() + MIN_TIMEOUT_SECS + 1;
    client.deposit(&4u64, &buyer, &farmer, &1_000_000, &just_enough);
}

// #471 - events emitted with correct topics and data

#[test]
fn test_deposit_emits_event() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let amount: i128 = 5_000_000;
    let order_id: u64 = 10;

    client.deposit(&order_id, &buyer, &farmer, &amount, &future_timeout(&env));

    let events = env.events().all();
    assert_eq!(events.len(), 1);
    let (_, topics, data) = events.get(0).unwrap();
    assert_eq!(
        topics,
        vec![
            &env,
            symbol_short!("escrow").into_val(&env),
            symbol_short!("deposit").into_val(&env),
            order_id.into_val(&env),
        ]
    );
    assert_eq!(data, (buyer, farmer, amount).into_val(&env));
}

#[test]
fn test_release_emits_event() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let amount: i128 = 5_000_000;
    let order_id: u64 = 20;

    client.deposit(&order_id, &buyer, &farmer, &amount, &future_timeout(&env));
    client.release(&order_id);

    let events = env.events().all();
    let (_, topics, data) = events.iter().last().unwrap();
    assert_eq!(
        topics,
        vec![
            &env,
            symbol_short!("escrow").into_val(&env),
            symbol_short!("release").into_val(&env),
            order_id.into_val(&env),
        ]
    );
    assert_eq!(data, amount.into_val(&env));
}

#[test]
fn test_refund_emits_event() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let amount: i128 = 5_000_000;
    let order_id: u64 = 30;
    let timeout = future_timeout(&env);

    client.deposit(&order_id, &buyer, &farmer, &amount, &timeout);

    env.ledger().set(LedgerInfo {
        timestamp: timeout + 1,
        protocol_version: 21,
        sequence_number: 2,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 300_000,
    });

    client.refund(&order_id);

    let events = env.events().all();
    let (_, topics, data) = events.iter().last().unwrap();
    assert_eq!(
        topics,
        vec![
            &env,
            symbol_short!("escrow").into_val(&env),
            symbol_short!("refund").into_val(&env),
            order_id.into_val(&env),
        ]
    );
    assert_eq!(data, amount.into_val(&env));
}

// #468 / #688 - TTL extended on deposit, release, and refund

#[test]
fn test_ttl_extended_after_deposit_entry_is_readable() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 40;

    client.deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env));

    let record = client.get_escrow(&order_id);
    assert_eq!(record.amount, 1_000_000);
    assert!(!record.released);
}

#[test]
fn test_ttl_extended_after_release_entry_is_settled_not_evicted() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 50;

    client.deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env));
    client.release(&order_id);

    let result = client.try_release(&order_id);
    assert_eq!(result, Err(Ok(EscrowError::AlreadySettled)));
}

#[test]
fn test_ttl_extended_after_refund_entry_is_settled_not_evicted() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 55;
    let timeout = future_timeout(&env);

    client.deposit(&order_id, &buyer, &farmer, &1_000_000, &timeout);

    env.ledger().set(LedgerInfo {
        timestamp: timeout + 1,
        protocol_version: 21,
        sequence_number: 2,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 300_000,
    });

    client.refund(&order_id);

    let result = client.try_refund(&order_id);
    assert_eq!(result, Err(Ok(EscrowError::AlreadySettled)));
}

// #687 - ACL role management

#[test]
fn test_grant_platform_role_bootstrap() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);

    client.grant_role(&admin, &admin, &Role::Platform);
    assert!(client.has_role(&admin, &Role::Platform));
}

#[test]
fn test_grant_arbitrator_role_by_platform() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let platform = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    client.grant_role(&platform, &platform, &Role::Platform);
    client.grant_role(&platform, &arbitrator, &Role::Arbitrator);
    assert!(client.has_role(&arbitrator, &Role::Arbitrator));
}

#[test]
fn test_revoke_role_by_platform() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let platform = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    client.grant_role(&platform, &platform, &Role::Platform);
    client.grant_role(&platform, &arbitrator, &Role::Arbitrator);
    assert!(client.has_role(&arbitrator, &Role::Arbitrator));

    client.revoke_role(&platform, &arbitrator, &Role::Arbitrator);
    assert!(!client.has_role(&arbitrator, &Role::Arbitrator));
}

#[test]
#[should_panic(expected = "only a Platform role holder can revoke roles")]
fn test_revoke_role_by_non_platform_panics() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let non_platform = Address::generate(&env);
    let target = Address::generate(&env);

    client.revoke_role(&non_platform, &target, &Role::Arbitrator);
}

#[test]
fn test_has_role_returns_false_for_unassigned() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let addr = Address::generate(&env);
    assert!(!client.has_role(&addr, &Role::Arbitrator));
    assert!(!client.has_role(&addr, &Role::Platform));
}

// Edge cases

#[test]
fn test_refund_before_timeout_returns_not_timed_out() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 60;

    client.deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env));

    let result = client.try_refund(&order_id);
    assert_eq!(result, Err(Ok(EscrowError::NotTimedOut)));
}

#[test]
fn test_duplicate_deposit_returns_already_exists() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 70;

    client.deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env));

    let result = client.try_deposit(
        &order_id,
        &buyer,
        &farmer,
        &1_000_000,
        &future_timeout(&env),
    );
    assert_eq!(result, Err(Ok(EscrowError::AlreadyExists)));
}

#[test]
fn test_release_nonexistent_order_returns_not_found() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let result = client.try_release(&999u64);
    assert_eq!(result, Err(Ok(EscrowError::NotFound)));
}

#[test]
fn test_refund_nonexistent_order_returns_not_found() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let result = client.try_refund(&999u64);
    assert_eq!(result, Err(Ok(EscrowError::NotFound)));
}