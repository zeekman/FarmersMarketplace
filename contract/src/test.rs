//! Unit tests for the Farmers Marketplace escrow contract.
//!
//! Covers all acceptance criteria from issues #468, #469, #470, #471.

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, LedgerInfo},
    vec, Address, Env, IntoVal,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Returns a fresh Env with a predictable ledger timestamp.
fn setup_env() -> Env {
    let env = Env::default();
    env.ledger().set(LedgerInfo {
        timestamp: 1_000_000,          // arbitrary "now"
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

/// A timeout that is safely in the future (now + 2 hours).
fn future_timeout(env: &Env) -> u64 {
    env.ledger().timestamp() + 7_200 // 2 hours
}

// ---------------------------------------------------------------------------
// #469 — payer != farmer validation
// ---------------------------------------------------------------------------

#[test]
fn test_deposit_same_buyer_and_farmer_returns_invalid_parties() {
    let env = setup_env();
    let client = register_contract(&env);

    let alice = Address::generate(&env);
    // buyer == farmer → must fail
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

    client
        .deposit(&1u64, &buyer, &farmer, &1_000_000, &future_timeout(&env));
    // No panic / error means success
}

// ---------------------------------------------------------------------------
// #470 — timeout_unix must be in the future (≥ now + 1 hour)
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "timeout must be at least 1 hour in the future")]
fn test_deposit_past_timeout_panics() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);

    let past_timeout = env.ledger().timestamp() - 1; // in the past
    client.deposit(&2u64, &buyer, &farmer, &1_000_000, &past_timeout);
}

#[test]
#[should_panic(expected = "timeout must be at least 1 hour in the future")]
fn test_deposit_timeout_less_than_one_hour_panics() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);

    // Exactly now — still not 1 hour ahead
    let too_soon = env.ledger().timestamp() + 1_800; // 30 minutes
    client.deposit(&3u64, &buyer, &farmer, &1_000_000, &too_soon);
}

#[test]
fn test_deposit_future_timeout_succeeds() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);

    // Exactly 1 hour + 1 second ahead — should succeed
    let just_enough = env.ledger().timestamp() + MIN_TIMEOUT_SECS + 1;
    client.deposit(&4u64, &buyer, &farmer, &1_000_000, &just_enough);
}

// ---------------------------------------------------------------------------
// #471 — events are emitted with correct topics and data
// ---------------------------------------------------------------------------

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
    assert_eq!(
        data,
        (buyer.clone(), farmer.clone(), amount).into_val(&env)
    );
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
    env.events().all(); // clear deposit event

    client.release(&order_id);

    let events = env.events().all();
    // The last event should be the release
    let release_event = events.iter().last().unwrap();
    let (_, topics, data) = release_event;

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

    // Advance ledger past the timeout
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
    let refund_event = events.iter().last().unwrap();
    let (_, topics, data) = refund_event;

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

// ---------------------------------------------------------------------------
// #468 — TTL is extended; after release the entry is marked settled (not evicted,
//         since Soroban testutils don't simulate eviction, but we verify the
//         extend_ttl path is exercised by confirming the record is still readable
//         and that a second release returns AlreadySettled rather than NotFound).
// ---------------------------------------------------------------------------

#[test]
fn test_ttl_extended_after_deposit_entry_is_readable() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 40;

    client.deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env));

    // Entry must still be readable (TTL was extended, not expired)
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

    // A second release must return AlreadySettled (entry still exists, TTL extended)
    let result = client.try_release(&order_id);
    assert_eq!(result, Err(Ok(EscrowError::AlreadySettled)));
}

// ---------------------------------------------------------------------------
// Additional edge-case tests
// ---------------------------------------------------------------------------

#[test]
fn test_refund_before_timeout_returns_not_timed_out() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 60;

    client.deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env));

    // Timeout has NOT passed yet
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
