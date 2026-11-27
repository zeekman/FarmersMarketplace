//! Coverage-guided fuzzing of the escrow contract (CT-27).
//!
//! Drives random sequences of escrow operations with arbitrary actors and
//! timestamps, checking after every step that:
//! 1. tokens are conserved (nothing minted or burned by the escrow, CT-02);
//! 2. a settled (released/refunded) escrow never changes status again;
//! 3. config cannot be changed without the admin's authorisation.
#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use soroban_escrow::{EscrowContract, EscrowContractClient, EscrowStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};
use std::collections::BTreeMap;

const ACTORS: usize = 4; // buyer-ish / farmer-ish accounts
const START_BALANCE: i128 = 1_000_000_000_000;
const MAX_ORDERS: u64 = 8;

#[derive(Arbitrary, Debug)]
enum Op {
    Deposit { order: u8, buyer: u8, farmer: u8, amount: u64, timeout_secs: u32, release_after_secs: u16 },
    Release { order: u8, caller: u8, as_admin: bool },
    Refund { order: u8 },
    TimeoutRefund { order: u8 },
    FarmerCancel { order: u8 },
    Dispute { order: u8, caller: u8 },
    Resolve { order: u8, buyer_bps: u16 },
    AutoRelease { order: u8 },
    Stream { order: u8, rate: u32, duration: u32 },
    AdvanceTime { secs: u32 },
    UnauthorisedConfig { which: u8, value: u32 },
}

#[derive(Arbitrary, Debug)]
struct Input {
    fee_bps: u16,
    ops: Vec<Op>,
}

fuzz_target!(|input: Input| {
    if input.ops.len() > 64 {
        return;
    }
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);

    let admin = Address::generate(&env);
    let fee_dest = Address::generate(&env);
    let actors: Vec<Address> = (0..ACTORS).map(|_| Address::generate(&env)).collect();

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let token_admin = StellarAssetClient::new(&env, &token);
    let token_client = TokenClient::new(&env, &token);
    for a in &actors {
        token_admin.mint(a, &START_BALANCE);
    }

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);
    if client
        .try_initialize(&admin, &u32::from(input.fee_bps % 501), &fee_dest)
        .is_err()
    {
        return;
    }

    let mut holders: Vec<Address> = actors.clone();
    holders.extend([fee_dest.clone(), contract_id.clone(), admin.clone()]);
    let total = || -> i128 { holders.iter().map(|h| token_client.balance(h)).sum() };
    let expected_total = START_BALANCE * ACTORS as i128;
    let mut settled: BTreeMap<u64, EscrowStatus> = BTreeMap::new();

    for op in input.ops {
        let pick = |i: u8| actors[i as usize % ACTORS].clone();
        let oid = |o: u8| u64::from(o) % MAX_ORDERS + 1;
        match op {
            Op::Deposit { order, buyer, farmer, amount, timeout_secs, release_after_secs } => {
                let now = env.ledger().timestamp();
                let _ = client.try_deposit(
                    &token,
                    &oid(order),
                    &pick(buyer),
                    &pick(farmer),
                    &i128::from(amount),
                    &(now + u64::from(timeout_secs)),
                    &None,
                    &0,
                    &(now + u64::from(release_after_secs)),
                );
            }
            Op::Release { order, caller, as_admin } => {
                let who = if as_admin { admin.clone() } else { pick(caller) };
                let _ = client.try_release(&oid(order), &who);
            }
            Op::Refund { order } => {
                let _ = client.try_refund(&oid(order));
            }
            Op::TimeoutRefund { order } => {
                let _ = client.try_claim_timeout_refund(&oid(order));
            }
            Op::FarmerCancel { order } => {
                let _ = client.try_cancel_by_farmer(&oid(order));
            }
            Op::Dispute { order, caller } => {
                let _ = client.try_dispute(&oid(order), &pick(caller));
            }
            Op::Resolve { order, buyer_bps } => {
                // Uses the `(order_id, buyer_bps)` signature; see CT-03 for the duplicate.
                let _ = client.try_resolve_dispute(&oid(order), &u32::from(buyer_bps % 10_001));
            }
            Op::AutoRelease { order } => {
                let _ = client.try_auto_release(&oid(order));
            }
            Op::Stream { order, rate, duration } => {
                let end = env.ledger().timestamp() + u64::from(duration);
                let _ = client.try_release_to_stream(&oid(order), &i128::from(rate), &end);
            }
            Op::AdvanceTime { secs } => {
                env.ledger().with_mut(|l| l.timestamp += u64::from(secs));
            }
            Op::UnauthorisedConfig { which, value } => {
                let before = client.get_config();
                env.set_auths(&[]); // no admin signature
                let res = match which % 4 {
                    0 => client.try_set_min_deposit(&i128::from(value)).is_ok(),
                    1 => client.try_set_reward_bps(&value).is_ok(),
                    2 => client.try_set_auto_release_days(&u64::from(value)).is_ok(),
                    _ => client.try_set_admin(&pick(value as u8)).is_ok(),
                };
                env.mock_all_auths();
                assert!(!res, "config changed without admin auth");
                assert_eq!(before, client.get_config(), "config mutated by unauthorised call");
            }
        }

        // Invariant 1: token conservation.
        assert_eq!(total(), expected_total, "token conservation violated");

        // Invariant 2: settled escrows are final.
        for o in 1..=MAX_ORDERS {
            if let Some(e) = client.get_escrow(&o) {
                match settled.get(&o) {
                    Some(prev) => assert_eq!(*prev, e.status, "settled escrow {o} changed status"),
                    None if matches!(e.status, EscrowStatus::Released | EscrowStatus::Refunded) => {
                        settled.insert(o, e.status);
                    }
                    None => {}
                }
            }
        }
    }
});
