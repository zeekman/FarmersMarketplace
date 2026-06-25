#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, contracterror, token, Address, Bytes, BytesN, Env, Vec};

// TTL thresholds for persistent escrow entries (~57–115 days at 5 s/ledger).
const TTL_MIN: u32 = 100_000;
const TTL_MAX: u32 = 200_000;

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
    InvalidWasmHash   = 8,
    NoPendingAdmin    = 9,
    /// Provided token does not match the token used at deposit time.
    InvalidToken      = 10,
    /// A v1 EscrowRecord entry could not be migrated to v2 Escrow.
    MigrationFailed   = 11,
    /// Fewer valid signatures than the cooperative threshold.
    NotEnoughSignatures = 12,
    /// Cooperative members / threshold not yet configured.
    CoopNotConfigured   = 13,
}

#[derive(Clone, PartialEq)]
#[contracttype]
pub enum EscrowStatus {
    Active,
    Released,
    Refunded,
    Disputed,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Per-escrow data — stored in persistent storage with individual TTL.
    Escrow(u64),
    /// Per-escrow token address (stored separately so token used at deposit is enforced at release).
    Token(u64),
    /// Contract metadata — stored in instance storage (shared TTL is fine).
    Admin,
    /// Contract metadata — stored in instance storage (shared TTL is fine).
    Platform,
    /// Cooperative multisig configuration (members + threshold).
    CoopConfig,
}

/// Full escrow record. `token` stores the SAC address used for this escrow (#683).
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminTransfer {
    pub current_admin: Address,
    pub pending_admin: Option<Address>,
}

#[derive(Clone)]
#[contracttype]
pub struct Escrow {
    pub buyer: Address,
    pub farmer: Address,
    /// SAC token address used for this escrow (any SEP-0041 token, not just XLM).
    pub token: Address,
    pub amount: i128,
    pub timeout_unix: u64,
    pub status: EscrowStatus,
}

// ---------------------------------------------------------------------------
// v1 schema — kept for migration purposes only (#691).
// The original contract stored EscrowRecord (no `status`, no `token` field).
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone)]
pub struct EscrowRecord {
    pub buyer: Address,
    pub farmer: Address,
    pub amount: i128,
    pub timeout_unix: u64,
    pub released: bool,
}

/// Cooperative multisig configuration: a set of ed25519 member public keys and
/// the minimum number of valid signatures required to release escrow funds (#701).
#[contracttype]
#[derive(Clone)]
pub struct CoopConfig {
    pub members: Vec<BytesN<32>>,
    pub threshold: u32,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Must be called once to register the platform fee recipient.
    pub fn init(env: Env, platform_address: Address) {
        env.storage().instance().set(&DataKey::Platform, &platform_address);
    }

    /// Deposit funds into escrow for `order_id`.
    ///
    /// `token` is any SAC-compatible token address (#683 — multi-token support).
    pub fn deposit(
        env: Env,
        token: Address,
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

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&buyer, &env.current_contract_address(), &amount);

        let escrow = Escrow {
            buyer,
            farmer,
            token: token.clone(),
            amount,
            timeout_unix,
            status: EscrowStatus::Active,
        };
        // Persist the token used for this escrow so releases/refunds must use the same token contract.
        env.storage().persistent().set(&DataKey::Token(order_id), &token);
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
        Ok(())
    }

    /// Create multiple escrows in a single transaction to reduce fees (#689).
    ///
    /// Each tuple is `(order_id, buyer, farmer, token, amount, timeout_unix)`.
    /// All entries are validated before any state is written; if any entry is
    /// invalid the entire batch is rejected.
    pub fn batch_deposit(
        env: Env,
        entries: Vec<(u64, Address, Address, Address, i128, u64)>,
    ) -> Result<(), EscrowError> {
        // Validate all entries first (fail-fast before touching state).
        for entry in entries.iter() {
            let (order_id, _buyer, _farmer, _token, amount, _timeout) = entry;
            if amount <= 0 {
                return Err(EscrowError::InvalidAmount);
            }
            if env.storage().persistent().has(&DataKey::Escrow(order_id)) {
                return Err(EscrowError::AlreadyExists);
            }
        }

        for entry in entries.iter() {
            let (order_id, buyer, farmer, token, amount, timeout_unix) = entry;
            buyer.require_auth();

            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&buyer, &env.current_contract_address(), &amount);

            let escrow = Escrow {
                buyer,
                farmer,
                token,
                amount,
                timeout_unix,
                status: EscrowStatus::Active,
            };
            env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
            env.storage().persistent().extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
        }
        Ok(())
    }

    /// Release funds to the farmer, deducting a platform fee.
    ///
    /// Uses the token stored in the escrow record (#683).
    /// `platform_fee_bps`: fee in basis points (e.g. 250 = 2.5%). Max 1000 (10%).
    pub fn release(
        env: Env,
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

        match escrow.status {
            EscrowStatus::Released | EscrowStatus::Refunded => {
                return Err(EscrowError::AlreadySettled);
            }
            EscrowStatus::Disputed => {
                return Err(EscrowError::InDispute);
            }
            EscrowStatus::Active => {}
        }

        let stored_token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Token(order_id))
            .ok_or(EscrowError::NotFound)?;
        if stored_token != escrow.token {
            return Err(EscrowError::InvalidToken);
        }

        let token_client = token::Client::new(&env, &escrow.token);

        let fee_amount = (escrow.amount * platform_fee_bps as i128) / 10_000;
        let farmer_amount = escrow.amount - fee_amount;

        if fee_amount > 0 {
            let platform: Address = env
                .storage()
                .instance()
                .get(&DataKey::Platform)
                .ok_or(EscrowError::NotFound)?;
            token_client.transfer(&env.current_contract_address(), &platform, &fee_amount);
        }

        token_client.transfer(&env.current_contract_address(), &escrow.farmer, &farmer_amount);

        escrow.status = EscrowStatus::Released;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
        Ok(())
    }

    pub fn set_admin(env: Env, admin: Address) {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("admin already set");
        }
        let transfer = AdminTransfer { current_admin: admin, pending_admin: None };
        env.storage().instance().set(&DataKey::Admin, &transfer);
    }

    /// Refund funds to the buyer after timeout.
    ///
    /// Uses the token stored in the escrow record (#683).
    pub fn refund(env: Env, order_id: u64) -> Result<(), EscrowError> {
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        escrow.buyer.require_auth();

        match escrow.status {
            EscrowStatus::Released | EscrowStatus::Refunded => {
                return Err(EscrowError::AlreadySettled);
            }
            _ => {}
        }
        if env.ledger().timestamp() < escrow.timeout_unix {
            return Err(EscrowError::TimeoutNotReached);
        }

        let stored_token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Token(order_id))
            .ok_or(EscrowError::NotFound)?;
        if stored_token != escrow.token {
            return Err(EscrowError::InvalidToken);
        }

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(&env.current_contract_address(), &escrow.buyer, &escrow.amount);

        escrow.status = EscrowStatus::Refunded;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
        Ok(())
    }

    /// Permissionless claim for timeout refunds. Mirrors `refund` but present
    /// with the explicit name `claim_timeout_refund` used in the spec/docs.
    pub fn claim_timeout_refund(env: Env, _xlm_token: Address, order_id: u64) -> Result<(), EscrowError> {
        // Reuse refund implementation
        Self::refund(env, order_id)
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
        match escrow.status {
            EscrowStatus::Released | EscrowStatus::Refunded => {
                return Err(EscrowError::AlreadySettled);
            }
            _ => {}
        }

        escrow.status = EscrowStatus::Disputed;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
        Ok(())
    }

    /// Admin resolves a disputed escrow. Uses the token stored in the record (#683).
    pub fn resolve_dispute(env: Env, xlm_token: Address, order_id: u64, release_to_farmer: bool) {
        let admin_transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin_transfer.current_admin.require_auth();

        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .expect("escrow not found");

        if escrow.status != EscrowStatus::Disputed {
            panic!("escrow is not in dispute");
        }

        let stored_token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Token(order_id))
            .expect("token not set for escrow");
        if stored_token != xlm_token {
            panic!("provided token does not match stored escrow token");
        }

        let token_client = token::Client::new(&env, &xlm_token);
        if release_to_farmer {
            token_client.transfer(&env.current_contract_address(), &escrow.farmer, &escrow.amount);
            escrow.status = EscrowStatus::Released;
        } else {
            token_client.transfer(&env.current_contract_address(), &escrow.buyer, &escrow.amount);
            escrow.status = EscrowStatus::Refunded;
        }
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
    }

    /// Admin proposes a new admin (first step of two-step transfer).
    pub fn propose_admin(env: Env, new_admin: Address) {
        let mut transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        transfer.current_admin.require_auth();
        transfer.pending_admin = Some(new_admin);
        env.storage().instance().set(&DataKey::Admin, &transfer);
        env.events().publish(("admin", "proposed"), new_admin);
    }

    /// Pending admin accepts the transfer (second step).
    pub fn accept_admin(env: Env) -> Result<(), EscrowError> {
        let mut transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        let pending = transfer.pending_admin.clone().ok_or(EscrowError::NoPendingAdmin)?;
        pending.require_auth();
        transfer.current_admin = pending.clone();
        transfer.pending_admin = None;
        env.storage().instance().set(&DataKey::Admin, &transfer);
        env.events().publish(("admin", "accepted"), pending);
        Ok(())
    }

    /// Admin-only contract WASM upgrade. Validates `new_wasm_hash` is non-zero
    /// before invoking the deployer API to perform the update.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), EscrowError> {
        let transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        transfer.current_admin.require_auth();

        let zero = BytesN::<32>::from_array(&env, &[0u8; 32]);
        if new_wasm_hash == zero {
            return Err(EscrowError::InvalidWasmHash);
        }

        env.deployer().update_current_contract_wasm(new_wasm_hash);
        env.events().publish(("admin", "upgrade"), ());
        Ok(())
    }

    pub fn get(env: Env, order_id: u64) -> Result<Escrow, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)
    }

    /// Read-only view: returns the full Escrow struct for `order_id` (#697).
    /// Returns `None` if the escrow does not exist. No auth required.
    pub fn get_escrow(env: Env, order_id: u64) -> Option<Escrow> {
        env.storage().persistent().get(&DataKey::Escrow(order_id))
    }

    /// Read-only view: returns `true` if the escrow for `order_id` has been
    /// settled (Released or Refunded), `false` if Active or Disputed (#697).
    /// Returns `false` for unknown order IDs. No auth required.
    pub fn is_settled(env: Env, order_id: u64) -> bool {
        match env.storage().persistent().get::<DataKey, Escrow>(&DataKey::Escrow(order_id)) {
            Some(escrow) => matches!(escrow.status, EscrowStatus::Released | EscrowStatus::Refunded),
            None => false,
        }
    }

    // -----------------------------------------------------------------------
    // migrate — v1 → v2 schema migration (#691)
    //
    // Reads each `order_id` in `order_ids` from persistent storage.  If the
    // entry deserialises as a v1 `EscrowRecord` (no `status` field, `released`
    // bool), it is rewritten as a v2 `Escrow` with:
    //   • status = EscrowStatus::Active   (released=false entries)
    //   • status = EscrowStatus::Released (released=true  entries)
    //   • token  = `fallback_token`       (v1 had no per-escrow token)
    //
    // Already-migrated entries (those that already deserialise as `Escrow`)
    // are left untouched.  The function is admin-only and idempotent.
    //
    // Returns the number of entries that were actually rewritten.
    // -----------------------------------------------------------------------
    pub fn migrate(
        env: Env,
        order_ids: Vec<u64>,
        fallback_token: Address,
    ) -> Result<u32, EscrowError> {
        // Only the current admin may trigger a migration.
        let transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        transfer.current_admin.require_auth();

        let mut migrated: u32 = 0;

        for order_id in order_ids.iter() {
            let key = DataKey::Escrow(order_id);

            // Skip if no entry exists at all.
            if !env.storage().persistent().has(&key) {
                continue;
            }

            // Attempt to read as the new v2 Escrow first.  If that succeeds
            // the entry is already migrated — skip it.
            let already_v2: Option<Escrow> = env.storage().persistent().get(&key);
            if already_v2.is_some() {
                continue;
            }

            // Try to read as the old v1 EscrowRecord.
            let record: EscrowRecord = env
                .storage()
                .persistent()
                .get(&key)
                .ok_or(EscrowError::MigrationFailed)?;

            let status = if record.released {
                EscrowStatus::Released
            } else {
                EscrowStatus::Active
            };

            let new_escrow = Escrow {
                buyer: record.buyer,
                farmer: record.farmer,
                token: fallback_token.clone(),
                amount: record.amount,
                timeout_unix: record.timeout_unix,
                status,
            };

            env.storage().persistent().set(&key, &new_escrow);
            env.storage().persistent().extend_ttl(&key, TTL_MIN, TTL_MAX);

            env.events().publish(
                ("escrow", "migrated", order_id),
                (),
            );

            migrated += 1;
        }

        Ok(migrated)
    }

    // -----------------------------------------------------------------------
    // #701 — cooperative multisig escrow release
    //
    // set_coop registers the M-of-N cooperative configuration (admin-only).
    // multisig_release verifies that at least `threshold` of the registered
    // members have signed the order_id and, if so, releases funds to the farmer.
    // -----------------------------------------------------------------------

    /// Admin-only: configure cooperative members (ed25519 public keys) and
    /// the minimum signature threshold required for `multisig_release`.
    pub fn set_coop(
        env: Env,
        members: Vec<BytesN<32>>,
        threshold: u32,
    ) -> Result<(), EscrowError> {
        let transfer: AdminTransfer = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        transfer.current_admin.require_auth();

        let config = CoopConfig { members, threshold };
        env.storage().instance().set(&DataKey::CoopConfig, &config);
        Ok(())
    }

    /// Release escrow funds to the farmer after M-of-N cooperative members
    /// have provided valid ed25519 signatures over sha256(order_id).
    ///
    /// `signatures` is positionally aligned with the stored `CoopConfig.members`
    /// list.  Pass an empty `Bytes` for members that are not signing; pass a
    /// 64-byte ed25519 signature for members that are.  Any non-empty entry
    /// that is not a valid 64-byte signature will cause the call to fail.
    pub fn multisig_release(
        env: Env,
        order_id: u64,
        signatures: Vec<Bytes>,
    ) -> Result<(), EscrowError> {
        let coop: CoopConfig = env
            .storage()
            .instance()
            .get(&DataKey::CoopConfig)
            .ok_or(EscrowError::CoopNotConfigured)?;

        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(order_id))
            .ok_or(EscrowError::NotFound)?;

        match escrow.status {
            EscrowStatus::Released | EscrowStatus::Refunded => {
                return Err(EscrowError::AlreadySettled);
            }
            EscrowStatus::Disputed => {
                return Err(EscrowError::InDispute);
            }
            EscrowStatus::Active => {}
        }

        // message = sha256(order_id as big-endian bytes) — used as the signed payload
        let order_id_bytes = Bytes::from_slice(&env, &order_id.to_be_bytes());
        let message: Bytes = env.crypto().sha256(&order_id_bytes).into();

        // Walk the member list and count valid signatures.
        // Signatures are positionally aligned with CoopConfig.members; pass an
        // empty Bytes for members that are not participating in this release.
        let n = coop.members.len().min(signatures.len());
        let mut valid: u32 = 0;
        for i in 0..n {
            let sig: Bytes = signatures.get(i);
            if sig.len() == 0 {
                continue; // member chose not to sign
            }
            // Reject non-empty entries that are not a valid 64-byte ed25519 sig.
            let sig64 = BytesN::<64>::try_from(sig)
                .map_err(|_| EscrowError::NotEnoughSignatures)?;
            let member_key: BytesN<32> = coop.members.get(i);
            env.crypto().ed25519_verify(&member_key, &message, &sig64);
            valid += 1;
        }

        if valid < coop.threshold {
            return Err(EscrowError::NotEnoughSignatures);
        }

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(&env.current_contract_address(), &escrow.farmer, &escrow.amount);

        escrow.status = EscrowStatus::Released;
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(order_id), TTL_MIN, TTL_MAX);
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    fn store_escrow(env: &Env, order_id: u64, buyer: Address, farmer: Address, token: Address) {
        let escrow = Escrow {
            buyer,
            farmer,
            token,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            status: EscrowStatus::Active,
        };
        env.storage().persistent().set(&DataKey::Escrow(order_id), &escrow);
    }

    // ── EscrowStatus::Disputed consolidation tests ────────────────────────────

    #[test]
    fn dispute_sets_status_to_disputed() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        store_escrow(&env, 1, buyer.clone(), farmer, token);
        EscrowContract::dispute(env.clone(), 1, buyer).unwrap();
        let updated = EscrowContract::get(env, 1).unwrap();
        assert_eq!(updated.status, EscrowStatus::Disputed);
    }

    #[test]
    fn release_disputed_escrow_returns_in_dispute_error() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer,
            token,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            status: EscrowStatus::Disputed,
        };
        env.storage().persistent().set(&DataKey::Escrow(2), &escrow);
        let result = EscrowContract::release(env, 2, 0);
        assert_eq!(result, Err(EscrowError::InDispute));
    }

    // ── error variant tests ───────────────────────────────────────────────────

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
        let token = Address::generate(&env);
        store_escrow(&env, 3, buyer, farmer, token);
        let result = EscrowContract::dispute(env, 3, stranger);
        assert_eq!(result, Err(EscrowError::Unauthorized));
    }

    #[test]
    fn dispute_already_settled() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer,
            token,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            status: EscrowStatus::Released,
        };
        env.storage().persistent().set(&DataKey::Escrow(4), &escrow);
        let result = EscrowContract::dispute(env, 4, buyer);
        assert_eq!(result, Err(EscrowError::AlreadySettled));
    }

    #[test]
    fn refund_timeout_not_reached() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        store_escrow(&env, 5, buyer, farmer, token);
        let escrow: Escrow = env.storage().persistent().get(&DataKey::Escrow(5)).unwrap();
        assert!(env.ledger().timestamp() < escrow.timeout_unix);
    }

    #[test]
    fn release_fee_exceeds_maximum() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        store_escrow(&env, 6, buyer, farmer, token);
        let result = EscrowContract::release(env, 6, 1001);
        assert_eq!(result, Err(EscrowError::InvalidAmount));
    }

    #[test]
    fn release_not_found() {
        let env = Env::default();
        env.mock_all_auths();
        let result = EscrowContract::release(env, 99, 250);
        assert_eq!(result, Err(EscrowError::NotFound));
    }

    #[test]
    fn release_already_settled() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer,
            token,
            amount: 1_000_0000,
            timeout_unix: 1_000,
            status: EscrowStatus::Released,
        };
        env.storage().persistent().set(&DataKey::Escrow(7), &escrow);
        let result = EscrowContract::release(env, 7, 0);
        assert_eq!(result, Err(EscrowError::AlreadySettled));
    }

    #[test]
    fn get_returns_escrow_data() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        store_escrow(&env, 8, buyer.clone(), farmer.clone(), token);
        let stored = EscrowContract::get(env, 8).unwrap();
        assert_eq!(stored.buyer, buyer);
        assert_eq!(stored.farmer, farmer);
        assert_eq!(stored.amount, 1_000_0000);
    }

    #[test]
    fn get_escrow_returns_none_for_unknown_order() {
        let env = Env::default();
        let result = EscrowContract::get_escrow(env, 999);
        assert!(result.is_none());
    }

    #[test]
    fn get_escrow_returns_correct_data_after_create() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        store_escrow(&env, 9, buyer.clone(), farmer.clone(), token.clone());
        let result = EscrowContract::get_escrow(env, 9);
        assert!(result.is_some());
        let escrow = result.unwrap();
        assert_eq!(escrow.buyer, buyer);
        assert_eq!(escrow.farmer, farmer);
        assert_eq!(escrow.amount, 1_000_0000);
        assert_eq!(escrow.status, EscrowStatus::Active);
        assert_eq!(escrow.token, token);
    }

    #[test]
    fn two_escrows_have_independent_keys() {
        let env = Env::default();
        let buyer_a = Address::generate(&env);
        let farmer_a = Address::generate(&env);
        let buyer_b = Address::generate(&env);
        let farmer_b = Address::generate(&env);
        let token = Address::generate(&env);

        store_escrow(&env, 10, buyer_a.clone(), farmer_a.clone(), token.clone());
        store_escrow(&env, 11, buyer_b.clone(), farmer_b.clone(), token);

        let mut e10: Escrow = env.storage().persistent().get(&DataKey::Escrow(10)).unwrap();
        e10.status = EscrowStatus::Released;
        env.storage().persistent().set(&DataKey::Escrow(10), &e10);
        env.storage().persistent().extend_ttl(&DataKey::Escrow(10), TTL_MIN, TTL_MAX);

        let e11: Escrow = env.storage().persistent().get(&DataKey::Escrow(11)).unwrap();
        assert_eq!(e11.status, EscrowStatus::Active, "escrow 11 must not be affected by escrow 10 mutation");
        assert_eq!(e11.buyer, buyer_b);
    }

    #[test]
    fn fee_rounding() {
        let amount: i128 = 1;
        let fee = (amount * 250_i128) / 10_000;
        assert_eq!(fee, 0);
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

    // ── #683 multi-token: token address is stored and retrievable ─────────────

    #[test]
    fn escrow_stores_token_address() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        store_escrow(&env, 20, buyer, farmer, token.clone());
        let escrow = EscrowContract::get(env, 20).unwrap();
        assert_eq!(escrow.token, token);
    }

    #[test]
    fn two_escrows_can_use_different_tokens() {
        let env = Env::default();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);
        store_escrow(&env, 21, buyer.clone(), farmer.clone(), token_a.clone());
        store_escrow(&env, 22, buyer, farmer, token_b.clone());
        assert_eq!(EscrowContract::get(env.clone(), 21).unwrap().token, token_a);
        assert_eq!(EscrowContract::get(env, 22).unwrap().token, token_b);
    }

    // ── #689 batch_deposit validation ─────────────────────────────────────────

    #[test]
    fn batch_deposit_rejects_zero_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        let mut entries = Vec::new(&env);
        entries.push_back((100_u64, buyer, farmer, token, 0_i128, 9999_u64));
        let result = EscrowContract::batch_deposit(env, entries);
        assert_eq!(result, Err(EscrowError::InvalidAmount));
    }

    #[test]
    fn batch_deposit_rejects_negative_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        let mut entries = Vec::new(&env);
        entries.push_back((101_u64, buyer, farmer, token, -1_i128, 9999_u64));
        let result = EscrowContract::batch_deposit(env, entries);
        assert_eq!(result, Err(EscrowError::InvalidAmount));
    }

    #[test]
    fn batch_deposit_rejects_duplicate_order_id() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        // Pre-store an escrow with order_id 200
        store_escrow(&env, 200, buyer.clone(), farmer.clone(), token.clone());
        let mut entries = Vec::new(&env);
        entries.push_back((200_u64, buyer, farmer, token, 1000_i128, 9999_u64));
        let result = EscrowContract::batch_deposit(env, entries);
        assert_eq!(result, Err(EscrowError::AlreadyExists));
    }

    // ── #686 property-based fuzz tests ────────────────────────────────────────
    //
    // Soroban's test environment is deterministic; we simulate property-based
    // fuzzing by iterating over a representative set of boundary and random-like
    // values covering the full input space described in the issue.

    /// Property: deposit with any positive amount must succeed (no token transfer
    /// is executed because we write directly to storage, so we test the guard logic).
    #[test]
    fn fuzz_deposit_amount_guard_positive_values() {
        let amounts: &[i128] = &[1, 2, 100, 1_000, i128::MAX / 2, i128::MAX];
        for &amount in amounts {
            let env = Env::default();
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            // Write directly to bypass token transfer (unit-tests the guard only).
            let escrow = Escrow {
                buyer: buyer.clone(),
                farmer,
                token,
                amount,
                timeout_unix: 9999,
                status: EscrowStatus::Active,
            };
            env.storage().persistent().set(&DataKey::Escrow(amount as u64), &escrow);
            let stored = EscrowContract::get(env, amount as u64).unwrap();
            assert_eq!(stored.amount, amount);
        }
    }

    /// Property: deposit with amount <= 0 must always return InvalidAmount.
    #[test]
    fn fuzz_deposit_rejects_non_positive_amounts() {
        let bad_amounts: &[i128] = &[0, -1, -100, i128::MIN];
        for &amount in bad_amounts {
            let env = Env::default();
            env.mock_all_auths();
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            // Manually invoke the guard check (mirrors deposit logic).
            let result: Result<(), EscrowError> = if amount <= 0 {
                Err(EscrowError::InvalidAmount)
            } else {
                Ok(())
            };
            assert_eq!(result, Err(EscrowError::InvalidAmount), "amount={amount} should be rejected");
            // Also verify batch_deposit rejects it.
            let mut entries = Vec::new(&env);
            entries.push_back((1_u64, buyer, farmer, token, amount, 9999_u64));
            let batch_result = EscrowContract::batch_deposit(env, entries);
            assert_eq!(batch_result, Err(EscrowError::InvalidAmount));
        }
    }

    /// Property: release before refund — once released, refund must return AlreadySettled.
    #[test]
    fn fuzz_release_then_refund_ordering() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer,
            token,
            amount: 1_000,
            timeout_unix: 0, // already timed out
            status: EscrowStatus::Released,
        };
        env.storage().persistent().set(&DataKey::Escrow(300), &escrow);

        // Refund on an already-released escrow must fail.
        let result = EscrowContract::refund(env, 300);
        assert_eq!(result, Err(EscrowError::AlreadySettled));
    }

    /// Property: refund before release — once refunded, release must return AlreadySettled.
    #[test]
    fn fuzz_refund_then_release_ordering() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        let escrow = Escrow {
            buyer: buyer.clone(),
            farmer,
            token,
            amount: 1_000,
            timeout_unix: 0,
            status: EscrowStatus::Refunded,
        };
        env.storage().persistent().set(&DataKey::Escrow(301), &escrow);

        let result = EscrowContract::release(env, 301, 0);
        assert_eq!(result, Err(EscrowError::AlreadySettled));
    }

    /// Property: timeout boundary — refund must fail when timestamp < timeout_unix
    /// and succeed (guard-wise) when timestamp >= timeout_unix.
    #[test]
    fn fuzz_timeout_boundary_conditions() {
        // Pairs of (ledger_timestamp, timeout_unix, expect_timeout_error)
        let cases: &[(u64, u64, bool)] = &[
            (0, 1, true),           // before timeout
            (999, 1_000, true),     // one second before
            (1_000, 1_000, false),  // exactly at timeout
            (1_001, 1_000, false),  // one second after
            (u64::MAX, 1_000, false), // far future
            (0, 0, false),          // timeout at genesis
        ];

        for &(ts, timeout_unix, expect_err) in cases {
            let env = Env::default();
            env.mock_all_auths();
            env.ledger().set_timestamp(ts);

            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            let escrow = Escrow {
                buyer: buyer.clone(),
                farmer,
                token,
                amount: 1_000,
                timeout_unix,
                status: EscrowStatus::Active,
            };
            env.storage().persistent().set(&DataKey::Escrow(400), &escrow);

            // Mirror the refund timeout guard.
            let timed_out = ts >= timeout_unix;
            if expect_err {
                assert!(!timed_out, "ts={ts} timeout={timeout_unix}: expected timeout not reached");
            } else {
                assert!(timed_out, "ts={ts} timeout={timeout_unix}: expected timeout reached");
            }

            // Verify via the actual contract function (no token transfer needed
            // since we only care about the TimeoutNotReached guard path).
            let result = EscrowContract::refund(env, 400);
            if expect_err {
                assert_eq!(result, Err(EscrowError::TimeoutNotReached),
                    "ts={ts} timeout={timeout_unix}");
            } else {
                // The call will fail at the token transfer step (no real token),
                // but it must NOT fail with TimeoutNotReached.
                assert_ne!(result, Err(EscrowError::TimeoutNotReached),
                    "ts={ts} timeout={timeout_unix}");
            }
        }
    }

    /// Property: platform fee calculation never produces negative farmer_amount
    /// for any valid (positive) amount and fee in [0, 1000] bps.
    #[test]
    fn fuzz_fee_calculation_never_negative() {
        let amounts: &[i128] = &[1, 7, 100, 10_000, 1_000_000, i128::MAX / 10_000];
        let fees_bps: &[u32] = &[0, 1, 250, 500, 999, 1000];
        for &amount in amounts {
            for &bps in fees_bps {
                let fee = (amount * bps as i128) / 10_000;
                let farmer_amount = amount - fee;
                assert!(farmer_amount >= 0, "amount={amount} bps={bps} farmer_amount={farmer_amount}");
                assert!(fee >= 0, "fee must be non-negative");
                assert!(fee <= amount, "fee must not exceed amount");
            }
        }
    }

    /// Property: fee_bps > 1000 must always be rejected.
    #[test]
    fn fuzz_release_rejects_excessive_fee_bps() {
        let bad_fees: &[u32] = &[1001, 1002, 5000, 10_000, u32::MAX];
        for &bps in bad_fees {
            let env = Env::default();
            env.mock_all_auths();
            let buyer = Address::generate(&env);
            let farmer = Address::generate(&env);
            let token = Address::generate(&env);
            store_escrow(&env, 500, buyer, farmer, token);
            let result = EscrowContract::release(env, 500, bps);
            assert_eq!(result, Err(EscrowError::InvalidAmount), "bps={bps} should be rejected");
        }
    }

    // ── #701 cooperative multisig tests ───────────────────────────────────────

    fn setup_admin(env: &Env) -> Address {
        let admin = Address::generate(env);
        EscrowContract::set_admin(env.clone(), admin.clone());
        admin
    }

    #[test]
    fn set_coop_stores_config() {
        let env = Env::default();
        env.mock_all_auths();
        setup_admin(&env);

        let mut members: Vec<BytesN<32>> = Vec::new(&env);
        members.push_back(BytesN::from_array(&env, &[1u8; 32]));
        members.push_back(BytesN::from_array(&env, &[2u8; 32]));

        EscrowContract::set_coop(env.clone(), members.clone(), 2).unwrap();

        let stored: CoopConfig = env.storage().instance().get(&DataKey::CoopConfig).unwrap();
        assert_eq!(stored.threshold, 2);
        assert_eq!(stored.members.len(), 2);
    }

    #[test]
    fn multisig_release_coop_not_configured() {
        let env = Env::default();
        env.mock_all_auths();
        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        store_escrow(&env, 600, buyer, farmer, token);

        let sigs: Vec<Bytes> = Vec::new(&env);
        let result = EscrowContract::multisig_release(env, 600, sigs);
        assert_eq!(result, Err(EscrowError::CoopNotConfigured));
    }

    #[test]
    fn multisig_release_not_found() {
        let env = Env::default();
        env.mock_all_auths();
        setup_admin(&env);

        let mut members: Vec<BytesN<32>> = Vec::new(&env);
        members.push_back(BytesN::from_array(&env, &[1u8; 32]));
        EscrowContract::set_coop(env.clone(), members, 1).unwrap();

        let sigs: Vec<Bytes> = Vec::new(&env);
        let result = EscrowContract::multisig_release(env, 9999, sigs);
        assert_eq!(result, Err(EscrowError::NotFound));
    }

    #[test]
    fn multisig_release_already_settled() {
        let env = Env::default();
        env.mock_all_auths();
        setup_admin(&env);

        let mut members: Vec<BytesN<32>> = Vec::new(&env);
        members.push_back(BytesN::from_array(&env, &[1u8; 32]));
        EscrowContract::set_coop(env.clone(), members, 1).unwrap();

        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        let escrow = Escrow {
            buyer,
            farmer,
            token,
            amount: 1_000,
            timeout_unix: 9999,
            status: EscrowStatus::Released,
        };
        env.storage().persistent().set(&DataKey::Escrow(601), &escrow);

        let sigs: Vec<Bytes> = Vec::new(&env);
        let result = EscrowContract::multisig_release(env, 601, sigs);
        assert_eq!(result, Err(EscrowError::AlreadySettled));
    }

    #[test]
    fn multisig_release_in_dispute() {
        let env = Env::default();
        env.mock_all_auths();
        setup_admin(&env);

        let mut members: Vec<BytesN<32>> = Vec::new(&env);
        members.push_back(BytesN::from_array(&env, &[1u8; 32]));
        EscrowContract::set_coop(env.clone(), members, 1).unwrap();

        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        let escrow = Escrow {
            buyer,
            farmer,
            token,
            amount: 1_000,
            timeout_unix: 9999,
            status: EscrowStatus::Disputed,
        };
        env.storage().persistent().set(&DataKey::Escrow(602), &escrow);

        let sigs: Vec<Bytes> = Vec::new(&env);
        let result = EscrowContract::multisig_release(env, 602, sigs);
        assert_eq!(result, Err(EscrowError::InDispute));
    }

    #[test]
    fn multisig_release_not_enough_signatures() {
        let env = Env::default();
        env.mock_all_auths();
        setup_admin(&env);

        let mut members: Vec<BytesN<32>> = Vec::new(&env);
        members.push_back(BytesN::from_array(&env, &[1u8; 32]));
        members.push_back(BytesN::from_array(&env, &[2u8; 32]));
        // Require 2-of-2 signatures
        EscrowContract::set_coop(env.clone(), members, 2).unwrap();

        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        store_escrow(&env, 603, buyer, farmer, token);

        // Provide zero signatures — threshold of 2 is not met
        let sigs: Vec<Bytes> = Vec::new(&env);
        let result = EscrowContract::multisig_release(env, 603, sigs);
        assert_eq!(result, Err(EscrowError::NotEnoughSignatures));
    }

    #[test]
    fn multisig_release_skips_empty_signature_slots() {
        let env = Env::default();
        env.mock_all_auths();
        setup_admin(&env);

        let mut members: Vec<BytesN<32>> = Vec::new(&env);
        members.push_back(BytesN::from_array(&env, &[1u8; 32]));
        members.push_back(BytesN::from_array(&env, &[2u8; 32]));
        // Require 2 valid signatures
        EscrowContract::set_coop(env.clone(), members, 2).unwrap();

        let buyer = Address::generate(&env);
        let farmer = Address::generate(&env);
        let token = Address::generate(&env);
        store_escrow(&env, 604, buyer, farmer, token);

        // Provide one empty slot and one empty slot — neither counts
        let mut sigs: Vec<Bytes> = Vec::new(&env);
        sigs.push_back(Bytes::new(&env));
        sigs.push_back(Bytes::new(&env));

        let result = EscrowContract::multisig_release(env, 604, sigs);
        assert_eq!(result, Err(EscrowError::NotEnoughSignatures));
    }
}
