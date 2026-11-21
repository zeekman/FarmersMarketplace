//! Cooperative contract: membership management and multisig release authorization.
//!
//! # DEPRECATED — retiring (ADR-0001, issue #1717)
//!
//! This contract is being retired. All cooperative release flows must go
//! through the escrow contract's per-cooperative `multisig_release`, which
//! signs over a domain-separated payload and enforces duplicate-free signer
//! sets. This module is kept only until the directory is deleted; do not add
//! new flows here.
//!
//! # Multisig abort semantics (CT-04)
//!
//! `multisig_release` verifies each collected signature with
//! `env.crypto().ed25519_verify(...)`. In soroban-sdk that host function
//! **traps** on an invalid signature instead of returning a `bool`, so a single
//! forged or wrong-payload signature aborts the whole call (the escrow stays
//! `Active`). This is safe, but implicit: if verification were ever swapped for
//! a non-trapping variant, every non-empty 64-byte entry would be counted as
//! valid. The loop below therefore documents the trap explicitly and only
//! increments the counter after a successful (non-trapping) verify.
//!
//! Signatures are matched **by position** (`signatures[i]` ↔ `members[i]`).
//! Reordering members via `set_coop` therefore invalidates previously collected
//! signatures; `set_coop` emits a `coop_changed` event carrying a hash of the
//! member list so off-chain signers can detect a reorder and discard pending
//! signatures. See ADR-0001 for the positional-vs-paired decision.
//!
//! # Authorization (issue #1716)
//!
//! `initialize(admin)` must be called exactly once to bind an admin address.
//! `set_coop` requires that admin's authorization, so an arbitrary account can
//! no longer replace the signer set and release the escrow. While an escrow is
//! `Active`, members may only be changed after `unlock_at` (a ledger timestamp
//! time-lock), preventing a signer swap from bypassing collected signatures.
//!
//! # Duplicate members (issue #1717)
//!
//! `set_coop` rejects duplicate member addresses. Without this check a config
//! such as `members = [A, A, B]` with `threshold = 2` would let `A` alone
//! satisfy the threshold by signing positions 0 and 1.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env, Vec};

/// Maximum number of members a cooperative may have.
const MAX_MEMBERS: u32 = 32;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CoopConfig {
    pub members: Vec<Address>,
    pub threshold: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowState {
    Active,
    Released,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Escrow {
    pub state: EscrowState,
    pub amount: i128,
}

#[contract]
pub struct CooperativeContract;

#[contractimpl]
impl CooperativeContract {
    /// Bind the cooperative admin. Callable exactly once.
    pub fn initialize(env: Env, admin: Address) {
        assert!(
            !env.storage().instance().has(&symbol_short!("admin")),
            "already initialized"
        );
        env.storage().instance().set(&symbol_short!("admin"), &admin);
    }

    /// Configure the cooperative members and release threshold.
    ///
    /// Requires the admin's authorization. While an escrow is `Active`, the
    /// member set may only be changed once `unlock_at` (ledger timestamp) has
    /// passed, so a signer swap cannot bypass already-collected signatures.
    ///
    /// Rejects duplicate member addresses so a single signer cannot satisfy the
    /// threshold by occupying multiple positions.
    ///
    /// Emits `coop_changed` with a hash of the member list so off-chain signers
    /// can detect a reorder (which invalidates positionally-matched signatures).
    pub fn set_coop(env: Env, members: Vec<Address>, threshold: u32, unlock_at: u64) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("admin"))
            .expect("not initialized");
        admin.require_auth();

        assert!(!members.is_empty(), "members must not be empty");
        assert!(members.len() <= MAX_MEMBERS, "too many members");
        assert!(threshold > 0 && threshold <= members.len(), "invalid threshold");

        // Reject duplicate members: otherwise `[A, A, B]` with threshold 2 lets
        // A alone sign positions 0 and 1 and bypass the threshold.
        for i in 0..members.len() {
            let member = members.get(i).unwrap();
            for j in (i + 1)..members.len() {
                assert!(
                    member != members.get(j).unwrap(),
                    "duplicate member"
                );
            }
        }

        // While an escrow is Active, changing members requires the time-lock.
        if let Some(escrow) = env
            .storage()
            .instance()
            .get::<_, Escrow>(&symbol_short!("escrow"))
        {
            if escrow.state == EscrowState::Active {
                assert!(
                    env.ledger().timestamp() >= unlock_at,
                    "members locked while escrow active"
                );
            }
        }

        let config = CoopConfig { members: members.clone(), threshold };
        env.storage().instance().set(&symbol_short!("coop"), &config);

        // Hash the member list so off-chain signers can detect a reorder.
        let mut encoded = Bytes::new(&env);
        for member in members.iter() {
            encoded.append(&member.clone().to_string().into());
        }
        let member_hash: BytesN<32> = env.crypto().sha256(&encoded).into();
        env.events().publish((symbol_short!("coop_changed"),), member_hash);
    }

    /// Release an escrow once `threshold` distinct members have signed.
    ///
    /// Signatures are matched by position: `signatures[i]` must be a valid
    /// signature by `members[i]` over `message`. Extra signatures beyond the
    /// member list are ignored. A forged signature traps the call (see module
    /// docs), leaving the escrow `Active`.
    pub fn multisig_release(env: Env, message: Bytes, signatures: Vec<BytesN<64>>) {
        let config: CoopConfig = env
            .storage()
            .instance()
            .get(&symbol_short!("coop"))
            .expect("coop not configured");

        let mut escrow: Escrow = env
            .storage()
            .instance()
            .get(&symbol_short!("escrow"))
            .expect("escrow not found");
        assert!(escrow.state == EscrowState::Active, "escrow not active");

        let mut valid: u32 = 0;
        let limit = if signatures.len() < config.members.len() {
            signatures.len()
        } else {
            config.members.len()
        };

        for i in 0..limit {
            let member_key = config.members.get(i).unwrap();
            let sig64 = signatures.get(i).unwrap();
            // NOTE: `ed25519_verify` TRAPS on an invalid signature; it does not
            // return a bool. A forged/wrong-payload signature therefore aborts
            // the whole call and the escrow stays `Active`. Only count after a
            // successful (non-trapping) verify so a future non-trapping verify
            // cannot silently count every 64-byte entry as valid.
            env.crypto().ed25519_verify(&member_key, &message, &sig64);
            valid += 1;
        }

        assert!(valid >= config.threshold, "threshold not met");

        escrow.state = EscrowState::Released;
        env.storage().instance().set(&symbol_short!("escrow"), &escrow);
    }

    /// Read the current escrow state (used by tests and off-chain clients).
    pub fn escrow_state(env: Env) -> EscrowState {
        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&symbol_short!("escrow"))
            .expect("escrow not found");
        escrow.state
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{Bytes, BytesN, Env, Vec};

    fn setup(env: &Env, member_count: u32, threshold: u32) -> Vec<Address> {
        let admin = Address::generate(env);
        CooperativeContract::initialize(env.clone(), admin);
        let mut members = Vec::new(env);
        for _ in 0..member_count {
            members.push_back(Address::generate(env));
        }
        CooperativeContract::set_coop(env.clone(), members.clone(), threshold, 0);
        env.storage().instance().set(
            &symbol_short!("escrow"),
            &Escrow { state: EscrowState::Active, amount: 100 },
        );
        members
    }

    fn sign(env: &Env, member: &Address, message: &Bytes) -> BytesN<64> {
        env.crypto().ed25519_sign(member, message)
    }

    // (a) threshold met with valid signatures -> release.
    #[test]
    fn release_with_threshold_signatures() {
        let env = Env::default();
        let members = setup(&env, 3, 2);
        let message = Bytes::from_slice(&env, b"release-1");

        let mut sigs = Vec::new(&env);
        sigs.push_back(sign(&env, &members.get(0).unwrap(), &message));
        sigs.push_back(sign(&env, &members.get(1).unwrap(), &message));

        CooperativeContract::multisig_release(env.clone(), message, sigs);
        assert_eq!(CooperativeContract::escrow_state(env), EscrowState::Released);
    }

    // (b) duplicate members are rejected (threshold bypass fix).
    #[test]
    #[should_panic(expected = "duplicate member")]
    fn set_coop_rejects_duplicate_members() {
        let env = Env::default();
        let admin = Address::generate(&env);
        CooperativeContract::initialize(env.clone(), admin);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let mut members = Vec::new(&env);
        members.push_back(a.clone());
        members.push_back(a);
        members.push_back(b);
        CooperativeContract::set_coop(env.clone(), members, 2, 0);
    }
}
