//! Unit tests for the Farmers Marketplace escrow contract.
//! Covers acceptance criteria from issues
//! #468, #469, #470, #471, #675, #676, #687, #688, #852, #853, #854, #855.

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, LedgerInfo},
    vec, Address, Bytes, Env, IntoVal,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

fn advance_past_timeout(env: &Env, timeout: u64) {
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
}

/// Convenience: initialize contract with zero fee so existing deposit/release
/// tests that don't care about fees still work without setting up a fee_destination.
fn init_zero_fee(env: &Env, client: &EscrowContractClient) {
    let admin = Address::generate(env);
    let fee_dest = Address::generate(env);
    client.initialize(&admin, &0u32, &fee_dest).unwrap();
}

fn dummy_product(env: &Env) -> (Bytes, i128) {
    (Bytes::from_array(env, b"wheat"), 1_000_000i128)
}

// ── #469 ─────────────────────────────────────────────────────────────────────

#[test]
fn test_deposit_same_buyer_and_farmer_returns_invalid_parties() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let alice = Address::generate(&env);
    let (pname, price) = dummy_product(&env);
    let result = client.try_deposit(
        &1u64, &alice, &alice, &1_000_000, &future_timeout(&env), &pname, &price,
    );
    assert_eq!(result, Err(Ok(EscrowError::InvalidParties)));
}

#[test]
fn test_deposit_different_parties_succeeds() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let (pname, price) = dummy_product(&env);
    client
        .deposit(&1u64, &buyer, &farmer, &1_000_000, &future_timeout(&env), &pname, &price)
        .unwrap();
}

// ── #470 ─────────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "timeout must be at least 1 hour in the future")]
fn test_deposit_past_timeout_panics() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let (pname, price) = dummy_product(&env);
    let past = env.ledger().timestamp() - 1;
    client
        .deposit(&2u64, &buyer, &farmer, &1_000_000, &past, &pname, &price)
        .unwrap();
}

#[test]
#[should_panic(expected = "timeout must be at least 1 hour in the future")]
fn test_deposit_timeout_less_than_one_hour_panics() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let (pname, price) = dummy_product(&env);
    let too_soon = env.ledger().timestamp() + 1_800;
    client
        .deposit(&3u64, &buyer, &farmer, &1_000_000, &too_soon, &pname, &price)
        .unwrap();
}

#[test]
fn test_deposit_future_timeout_succeeds() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let (pname, price) = dummy_product(&env);
    let just_enough = env.ledger().timestamp() + MIN_TIMEOUT_SECS + 1;
    client
        .deposit(&4u64, &buyer, &farmer, &1_000_000, &just_enough, &pname, &price)
        .unwrap();
}

// ── #471 - events ─────────────────────────────────────────────────────────────

#[test]
fn test_deposit_emits_event() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let amount: i128 = 5_000_000;
    let order_id: u64 = 10;
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &amount, &future_timeout(&env), &pname, &price)
        .unwrap();

    let events = env.events().all();
    // initialize emits no events; deposit is first
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
fn test_refund_emits_event() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let amount: i128 = 5_000_000;
    let order_id: u64 = 30;
    let timeout = future_timeout(&env);
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &amount, &timeout, &pname, &price)
        .unwrap();
    advance_past_timeout(&env, timeout);
    client.refund(&order_id, &None).unwrap();

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

// ── #468 / #688 - TTL ─────────────────────────────────────────────────────────

#[test]
fn test_ttl_extended_after_deposit_entry_is_readable() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 40;
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env), &pname, &price)
        .unwrap();

    let record = client.get_escrow(&order_id).unwrap();
    assert_eq!(record.amount, 1_000_000);
    assert_eq!(record.status, EscrowStatus::Active);
}

#[test]
fn test_ttl_extended_after_refund_entry_is_settled_not_evicted() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 55;
    let timeout = future_timeout(&env);
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &timeout, &pname, &price)
        .unwrap();
    advance_past_timeout(&env, timeout);
    client.refund(&order_id, &None).unwrap();

    let result = client.try_refund(&order_id, &None);
    assert_eq!(result, Err(Ok(EscrowError::AlreadySettled)));
}

// ── #687 - ACL ────────────────────────────────────────────────────────────────

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
    let client = register_contract(&env);
    let addr = Address::generate(&env);
    assert!(!client.has_role(&addr, &Role::Arbitrator));
    assert!(!client.has_role(&addr, &Role::Platform));
}

// ── Edge cases ────────────────────────────────────────────────────────────────

#[test]
fn test_refund_before_timeout_returns_not_timed_out() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 60;
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env), &pname, &price)
        .unwrap();
    let result = client.try_refund(&order_id, &None);
    assert_eq!(result, Err(Ok(EscrowError::NotTimedOut)));
}

#[test]
fn test_duplicate_deposit_returns_already_exists() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 70;
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env), &pname, &price)
        .unwrap();
    let result = client.try_deposit(
        &order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env), &pname, &price,
    );
    assert_eq!(result, Err(Ok(EscrowError::AlreadyExists)));
}

#[test]
fn test_release_nonexistent_order_returns_not_found() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let (pname, price) = dummy_product(&env);
    let result = client.try_release(&999u64, &pname, &price);
    assert_eq!(result, Err(Ok(EscrowError::NotFound)));
}

#[test]
fn test_refund_nonexistent_order_returns_not_found() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let result = client.try_refund(&999u64, &None);
    assert_eq!(result, Err(Ok(EscrowError::NotFound)));
}

// ── #675 - Dispute flow ───────────────────────────────────────────────────────

#[test]
fn test_open_dispute_by_buyer_transitions_to_disputed() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 100;
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env), &pname, &price)
        .unwrap();
    client.open_dispute(&order_id, &buyer, &None).unwrap();

    let record = client.get_escrow(&order_id).unwrap();
    assert_eq!(record.status, EscrowStatus::Disputed);
}

#[test]
fn test_open_dispute_by_unauthorized_returns_unauthorized() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let stranger = Address::generate(&env);
    let order_id: u64 = 102;
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env), &pname, &price)
        .unwrap();
    let result = client.try_open_dispute(&order_id, &stranger, &None);
    assert_eq!(result, Err(Ok(EscrowError::Unauthorized)));
}

#[test]
fn test_resolve_dispute_to_buyer_by_global_arbitrator() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);

    let platform = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 110;
    let (pname, price) = dummy_product(&env);

    client.grant_role(&platform, &platform, &Role::Platform);
    client.grant_role(&platform, &arbitrator, &Role::Arbitrator);

    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env), &pname, &price)
        .unwrap();
    client.open_dispute(&order_id, &buyer, &None).unwrap();
    client.resolve_dispute(&order_id, &arbitrator, &true).unwrap();

    let record = client.get_escrow(&order_id).unwrap();
    assert_eq!(record.status, EscrowStatus::Refunded);
}

#[test]
fn test_resolve_dispute_by_non_arbitrator_returns_unauthorized() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let stranger = Address::generate(&env);
    let order_id: u64 = 113;
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env), &pname, &price)
        .unwrap();
    client.open_dispute(&order_id, &buyer, &None).unwrap();

    let result = client.try_resolve_dispute(&order_id, &stranger, &true);
    assert_eq!(result, Err(Ok(EscrowError::Unauthorized)));
}

// ── #676 - Partial refund ─────────────────────────────────────────────────────

#[test]
fn test_partial_refund_with_valid_amount_succeeds() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 201;
    let timeout = future_timeout(&env);
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &timeout, &pname, &price)
        .unwrap();
    advance_past_timeout(&env, timeout);
    client.refund(&order_id, &Some(400_000)).unwrap();

    let record = client.get_escrow(&order_id).unwrap();
    assert_eq!(record.status, EscrowStatus::Refunded);
    assert_eq!(record.amount, 400_000);
}

#[test]
fn test_partial_refund_exceeding_amount_returns_invalid_amount() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    init_zero_fee(&env, &client);
    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 202;
    let timeout = future_timeout(&env);
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &timeout, &pname, &price)
        .unwrap();
    advance_past_timeout(&env, timeout);
    let result = client.try_refund(&order_id, &Some(2_000_000));
    assert_eq!(result, Err(Ok(EscrowError::InvalidAmount)));
}

// ── #855 - Fee rate bounds ────────────────────────────────────────────────────

#[test]
fn test_initialize_with_fee_above_max_returns_invalid_fee_rate() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);

    // 501 bps > MAX_FEE_BPS (500)
    let result = client.try_initialize(&admin, &501u32, &fee_dest);
    assert_eq!(result, Err(Ok(EscrowError::InvalidFeeRate)));
}

#[test]
fn test_initialize_at_max_fee_boundary_succeeds() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);

    // Exactly MAX_FEE_BPS = 500 should be accepted
    client.initialize(&admin, &MAX_FEE_BPS, &fee_dest).unwrap();
}

#[test]
fn test_set_fee_rate_above_max_returns_invalid_fee_rate() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    client.initialize(&admin, &250u32, &fee_dest).unwrap();

    let result = client.try_set_fee_rate(&600u32);
    assert_eq!(result, Err(Ok(EscrowError::InvalidFeeRate)));
}

#[test]
fn test_set_fee_rate_valid_emits_fee_updated_event() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    client.initialize(&admin, &250u32, &fee_dest).unwrap();

    client.set_fee_rate(&100u32).unwrap();

    let events = env.events().all();
    let (_, topics, data) = events.iter().last().unwrap();
    assert_eq!(
        topics,
        vec![
            &env,
            symbol_short!("escrow").into_val(&env),
            symbol_short!("fee_upd").into_val(&env),
        ]
    );
    // old=250, new=100
    assert_eq!(data, (250u32, 100u32).into_val(&env));
}

#[test]
fn test_release_fee_deducted_at_250_bps() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    // 250 bps = 2.5%
    client.initialize(&admin, &250u32, &fee_dest).unwrap();

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 400;
    let amount: i128 = 10_000;
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &amount, &future_timeout(&env), &pname, &price)
        .unwrap();
    client.release(&order_id, &pname, &price).unwrap();

    // Check release event carries correct split: fee=250, farmer=9750
    let events = env.events().all();
    let (_, _, data) = events.iter().last().unwrap();
    let expected_fee: i128 = 250;
    let expected_farmer: i128 = 9_750;
    assert_eq!(data, (expected_farmer, expected_fee).into_val(&env));
}

#[test]
fn test_release_fee_deducted_at_500_bps() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    // 500 bps = 5%
    client.initialize(&admin, &500u32, &fee_dest).unwrap();

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 401;
    let amount: i128 = 10_000;
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &amount, &future_timeout(&env), &pname, &price)
        .unwrap();
    client.release(&order_id, &pname, &price).unwrap();

    let events = env.events().all();
    let (_, _, data) = events.iter().last().unwrap();
    let expected_fee: i128 = 500;
    let expected_farmer: i128 = 9_500;
    assert_eq!(data, (expected_farmer, expected_fee).into_val(&env));
}

#[test]
fn test_release_zero_fee_farmer_gets_full_amount() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    client.initialize(&admin, &0u32, &fee_dest).unwrap();

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 402;
    let amount: i128 = 10_000;
    let (pname, price) = dummy_product(&env);

    client
        .deposit(&order_id, &buyer, &farmer, &amount, &future_timeout(&env), &pname, &price)
        .unwrap();
    client.release(&order_id, &pname, &price).unwrap();

    let events = env.events().all();
    let (_, _, data) = events.iter().last().unwrap();
    assert_eq!(data, (10_000i128, 0i128).into_val(&env));
}

// ── #853 - Upgrade ────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "contract not initialized")]
fn test_upgrade_on_uninitialised_contract_panics() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    // Contract is not initialized — get_admin() must panic.
    let fake_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&fake_hash).unwrap();
}

#[test]
fn test_upgrade_preserves_existing_escrow_state() {
    // After a successful upgrade call the persistent escrow entries are
    // still readable (upgrade only swaps WASM; storage is untouched).
    // In the test environment update_current_contract_wasm is a no-op so
    // we verify the state-preservation contract by confirming the record
    // survives a round-trip through initialize → deposit → upgrade → get_escrow.
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    client.initialize(&admin, &0u32, &fee_dest).unwrap();

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 500;
    let (pname, price) = dummy_product(&env);
    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env), &pname, &price)
        .unwrap();

    // Simulate upgrade with a dummy hash (no-op in testutils).
    let dummy_hash = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);
    client.upgrade(&dummy_hash).unwrap();

    // All escrow state must still be intact.
    let record = client.get_escrow(&order_id).unwrap();
    assert_eq!(record.buyer, buyer);
    assert_eq!(record.amount, 1_000_000);
    assert_eq!(record.status, EscrowStatus::Active);
}

// ── #854 - Circuit breaker ────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_deposit() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    client.initialize(&admin, &0u32, &fee_dest).unwrap();
    client.pause().unwrap();

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let (pname, price) = dummy_product(&env);
    let result = client.try_deposit(
        &1u64, &buyer, &farmer, &1_000_000, &future_timeout(&env), &pname, &price,
    );
    assert_eq!(result, Err(Ok(EscrowError::ContractPaused)));
}

#[test]
fn test_pause_blocks_release() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    client.initialize(&admin, &0u32, &fee_dest).unwrap();

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 600;
    let (pname, price) = dummy_product(&env);
    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env), &pname, &price)
        .unwrap();

    client.pause().unwrap();
    let result = client.try_release(&order_id, &pname, &price);
    assert_eq!(result, Err(Ok(EscrowError::ContractPaused)));
}

#[test]
fn test_pause_blocks_refund() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    client.initialize(&admin, &0u32, &fee_dest).unwrap();

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 601;
    let timeout = future_timeout(&env);
    let (pname, price) = dummy_product(&env);
    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &timeout, &pname, &price)
        .unwrap();
    advance_past_timeout(&env, timeout);

    client.pause().unwrap();
    let result = client.try_refund(&order_id, &None);
    assert_eq!(result, Err(Ok(EscrowError::ContractPaused)));
}

#[test]
fn test_is_paused_reflects_state() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    client.initialize(&admin, &0u32, &fee_dest).unwrap();

    assert!(!client.is_paused());
    client.pause().unwrap();
    assert!(client.is_paused());
}

#[test]
fn test_unpause_requires_two_platform_votes() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);

    // Set up two Platform holders
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    client.initialize(&admin, &0u32, &fee_dest).unwrap();

    let signer2 = Address::generate(&env);
    client.grant_role(&admin, &signer2, &Role::Platform);

    client.pause().unwrap();
    assert!(client.is_paused());

    // First vote — not enough yet
    client.unpause(&admin).unwrap();
    assert!(client.is_paused(), "should still be paused after 1 vote");

    // Second vote — threshold reached
    client.unpause(&signer2).unwrap();
    assert!(!client.is_paused(), "should be unpaused after 2 votes");
}

#[test]
fn test_unpause_by_non_platform_returns_unauthorized() {
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    client.initialize(&admin, &0u32, &fee_dest).unwrap();
    client.pause().unwrap();

    let stranger = Address::generate(&env);
    let result = client.try_unpause(&stranger);
    assert_eq!(result, Err(Ok(EscrowError::Unauthorized)));
}

#[test]
fn test_get_escrow_readable_while_paused() {
    // Read-only calls must still work during a pause.
    let env = setup_env();
    env.mock_all_auths();
    let client = register_contract(&env);
    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    client.initialize(&admin, &0u32, &fee_dest).unwrap();

    let buyer = Address::generate(&env);
    let farmer = Address::generate(&env);
    let order_id: u64 = 700;
    let (pname, price) = dummy_product(&env);
    client
        .deposit(&order_id, &buyer, &farmer, &1_000_000, &future_timeout(&env), &pname, &price)
        .unwrap();

    client.pause().unwrap();

    // get_escrow must still work
    let record = client.get_escrow(&order_id).unwrap();
    assert_eq!(record.amount, 1_000_000);
}
