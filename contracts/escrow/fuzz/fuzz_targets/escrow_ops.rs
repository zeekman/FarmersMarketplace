//! Coverage-guided fuzzing of the escrow contract (CT-27).
//!
//! Drives random sequences of escrow operations with arbitrary actors and
//! timestamps, checking after every step that:
//! 1. tokens are conserved (nothing minted or burned by the escrow, CT-02);
//! 2. a settled (released/refunded) escrow never changes status again;
//! 3. config cannot be changed without the admin's authorisation;
//! 4. the platform fee taken by a settlement never exceeds `MAX_FEE_BPS`;
//! 5. the buyer can always exit an `Active` escrow once it has timed out;
//! 6. a multisig release only succeeds with at least `threshold` valid signatures.
#![no_main]

use arbitrary::Arbitrary;
use ed25519_dalek::{Signer, SigningKey};
use libfuzzer_sys::fuzz_target;
use soroban_escrow::{EscrowContract, EscrowContractClient, EscrowStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    xdr::ToXdr,
    Address, Bytes, BytesN, Env,
};
use std::collections::BTreeMap;

const ACTORS: usize = 4; // buyer-ish / farmer-ish accounts
const COOPS: usize = 2;
const START_BALANCE: i128 = 1_000_000_000_000;
const MAX_ORDERS: u64 = 8;
/// Mirrors `MAX_FEE_BPS` in `src/lib.rs`.
const MAX_FEE_BPS: i128 = 1_000;
const BPS_DENOMINATOR: i128 = 10_000;

#[derive(Arbitrary, Debug)]
enum Op {
    Deposit {
        order: u8,
        buyer: u8,
        farmer: u8,
        amount: u64,
        timeout_secs: u32,
        release_after_secs: u16,
        /// 0 = no cooperative, otherwise one of the `COOPS` cooperatives.
        coop: u8,
        royalty_bps: u16,
    },
    Release { order: u8, caller: u8, as_admin: bool },
    Refund { order: u8 },
    TimeoutRefund { order: u8 },
    FarmerCancel { order: u8 },
    Dispute { order: u8, caller: u8 },
    Resolve { order: u8, buyer_bps: u16 },
    AutoRelease { order: u8 },
    Stream { order: u8, rate: u32, duration: u32 },
    SetCoop { coop: u8, signers: u8, threshold: u8, seed: u8 },
    /// `signed` is a bitmask: bit `i` makes member `i` sign the release.
    MultisigRelease { order: u8, signed: u8 },
    AdvanceTime { secs: u32 },
    UnauthorisedConfig { which: u8, value: u32 },
}

#[derive(Arbitrary, Debug)]
struct Input {
    fee_bps: u16,
    ops: Vec<Op>,
}

fn signing_key(seed: u8, index: u8) -> SigningKey {
    let mut secret = [seed; 32];
    secret[0] = index;
    SigningKey::from_bytes(&secret)
}

/// `sha256(contract_address_xdr || order_id_be)`, as verified by `multisig_release`.
fn multisig_digest(env: &Env, contract: &Address, order_id: u64) -> [u8; 32] {
    let mut payload = contract.clone().to_xdr(env);
    payload.extend_from_slice(&order_id.to_be_bytes());
    let digest: Bytes = env.crypto().sha256(&payload).into();
    let mut raw = [0u8; 32];
    digest.copy_into_slice(&mut raw);
    raw
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
    let coops: Vec<Address> = (0..COOPS).map(|_| Address::generate(&env)).collect();
    // Signing keys and threshold of each cooperative as last accepted by `set_coop`.
    let mut coop_cfg: Vec<Option<(Vec<SigningKey>, u32)>> = (0..COOPS).map(|_| None).collect();

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
    holders.extend(coops.iter().cloned());
    let total = || -> i128 { holders.iter().map(|h| token_client.balance(h)).sum() };
    let expected_total = START_BALANCE * ACTORS as i128;
    let mut settled: BTreeMap<u64, EscrowStatus> = BTreeMap::new();

    for op in input.ops {
        let pick = |i: u8| actors[i as usize % ACTORS].clone();
        let oid = |o: u8| u64::from(o) % MAX_ORDERS + 1;

        // Settlements must pay the fee destination at most MAX_FEE_BPS of the escrow.
        let settling = match &op {
            Op::Release { order, .. }
            | Op::AutoRelease { order }
            | Op::Resolve { order, .. }
            | Op::MultisigRelease { order, .. } => Some(oid(*order)),
            _ => None,
        };
        let (amount_before, fee_before) = match settling {
            Some(o) => (
                client.get_escrow(&o).map_or(0, |e| e.amount),
                token_client.balance(&fee_dest),
            ),
            None => (0, 0),
        };

        match op {
            Op::Deposit {
                order,
                buyer,
                farmer,
                amount,
                timeout_secs,
                release_after_secs,
                coop,
                royalty_bps,
            } => {
                let now = env.ledger().timestamp();
                let coop_addr = (coop as usize % (COOPS + 1))
                    .checked_sub(1)
                    .map(|i| coops[i].clone());
                let _ = client.try_deposit(
                    &token,
                    &oid(order),
                    &pick(buyer),
                    &pick(farmer),
                    &i128::from(amount),
                    &(now + u64::from(timeout_secs)),
                    &coop_addr,
                    &u32::from(royalty_bps % 1_001),
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
                let _ = client.try_resolve_dispute(&oid(order), &u32::from(buyer_bps % 10_001));
            }
            Op::AutoRelease { order } => {
                let _ = client.try_auto_release(&oid(order));
            }
            Op::Stream { order, rate, duration } => {
                let end = env.ledger().timestamp() + u64::from(duration);
                let _ = client.try_release_to_stream(&oid(order), &i128::from(rate), &end);
            }
            Op::SetCoop { coop, signers, threshold, seed } => {
                let idx = coop as usize % COOPS;
                let keys: Vec<SigningKey> =
                    (0..=(signers % 4)).map(|i| signing_key(seed, i)).collect();
                let mut members = soroban_sdk::Vec::<BytesN<32>>::new(&env);
                for k in &keys {
                    members.push_back(BytesN::from_array(&env, k.verifying_key().as_bytes()));
                }
                let threshold = u32::from(threshold % 5);
                if client.try_set_coop(&coops[idx], &members, &threshold).is_ok() {
                    coop_cfg[idx] = Some((keys, threshold));
                }
            }
            Op::MultisigRelease { order, signed } => {
                let o = oid(order);
                let idx = client
                    .get_escrow(&o)
                    .and_then(|e| e.cooperative_address)
                    .and_then(|a| coops.iter().position(|c| *c == a));
                let mut sigs = soroban_sdk::Vec::<Bytes>::new(&env);
                let mut valid = 0u32;
                let mut threshold = u32::MAX;
                if let Some((keys, t)) = idx.and_then(|i| coop_cfg[i].as_ref()) {
                    threshold = *t;
                    let digest = multisig_digest(&env, &contract_id, o);
                    for (i, key) in keys.iter().enumerate() {
                        if signed & (1u8 << i) != 0 {
                            sigs.push_back(Bytes::from_slice(&env, &key.sign(&digest).to_bytes()));
                            valid += 1;
                        } else {
                            sigs.push_back(Bytes::new(&env));
                        }
                    }
                }
                let res = client.try_multisig_release(&o, &sigs);
                if res.is_ok() {
                    assert!(
                        valid >= threshold,
                        "multisig released with {valid} signature(s), threshold {threshold}"
                    );
                }
            }
            Op::AdvanceTime { secs } => {
                env.ledger().with_mut(|l| l.timestamp += u64::from(secs));
            }
            Op::UnauthorisedConfig { which, value } => {
                let before = client.get_config();
                env.set_auths(&[]); // no admin signature
                let res = match which % 5 {
                    0 => client.try_set_min_deposit(&i128::from(value)).is_ok(),
                    1 => client.try_set_reward_bps(&value).is_ok(),
                    2 => client.try_set_auto_release_days(&u64::from(value)).is_ok(),
                    3 => client.try_propose_admin(&pick(value as u8)).is_ok(),
                    _ => {
                        let members = soroban_sdk::vec![&env, BytesN::from_array(&env, &[1u8; 32])];
                        client
                            .try_set_coop(&coops[value as usize % COOPS], &members, &1)
                            .is_ok()
                    }
                };
                env.mock_all_auths();
                assert!(!res, "config changed without admin auth");
                assert_eq!(before, client.get_config(), "config mutated by unauthorised call");
            }
        }

        if settling.is_some() {
            let fee = token_client.balance(&fee_dest) - fee_before;
            let cap = amount_before * MAX_FEE_BPS / BPS_DENOMINATOR;
            assert!(fee <= cap, "fee {fee} exceeds {MAX_FEE_BPS} bps cap {cap}");
        }

        // Invariant 5: an Active escrow past its timeout can always be refunded to the buyer.
        let now = env.ledger().timestamp();
        for o in 1..=MAX_ORDERS {
            let Some(e) = client.get_escrow(&o) else { continue };
            if e.status == EscrowStatus::Active && now >= e.timeout_unix {
                let before = token_client.balance(&e.buyer);
                assert!(
                    client.try_claim_timeout_refund(&o).is_ok(),
                    "buyer cannot exit timed-out Active escrow {o}"
                );
                assert_eq!(
                    token_client.balance(&e.buyer) - before,
                    e.amount,
                    "timeout refund of escrow {o} did not return the full amount"
                );
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
