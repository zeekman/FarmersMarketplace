//! Farmers Marketplace Reward Token (FRT)
//!
//! SEP-0041 compliant Soroban fungible token for marketplace rewards.
//!
//! Issues addressed:
//!   #475 - Idiomatic DataKey enum for stable serialisation across SDK versions.
//!   #483 - approve / transfer_from / burn_from support.
//!   #685 - Optional burn-on-transfer fee, configurable by admin.

#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

#[contracttype]
#[derive(Clone)]
pub struct TokenMetadata {
    pub decimal: u32,
    pub name: String,
    pub symbol: String,
}

/// Idiomatic storage key enum - stable serialisation across SDK versions (#475).
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Balance(Address),
    Admin,
    Metadata,
    TotalSupply,
    PendingAdmin,
    /// Transfer fee in basis points (0-10000). 100 bps = 1%. (#685)
    TransferFeeBps,
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contract]
pub struct RewardToken;

#[contractimpl]
impl RewardToken {
    pub fn initialize(env: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if env.storage().instance().has(&DataKey::Metadata) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TotalSupply, &0_i128);
        env.storage().instance().set(&DataKey::TransferFeeBps, &0_u32);
        env.storage().instance().set(
            &DataKey::Metadata,
            &TokenMetadata { decimal, name, symbol },
        );
    }

    /// Sets the burn-on-transfer fee in basis points (#685).
    /// 0 = disabled, 100 = 1%, 10000 = 100% (max).
    /// Only the admin may call this.
    pub fn set_transfer_fee(env: Env, fee_bps: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if fee_bps > 10_000 {
            panic!("fee_bps must be <= 10000");
        }
        env.storage().instance().set(&DataKey::TransferFeeBps, &fee_bps);
        env.events().publish(("set_transfer_fee",), fee_bps);
    }

    /// Returns the current transfer fee in basis points (#685).
    pub fn transfer_fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::TransferFeeBps).unwrap_or(0)
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let balance = Self::balance(env.clone(), to.clone());
        env.storage().persistent().set(&DataKey::Balance(to.clone()), &(balance + amount));
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &(supply + amount));
        env.events().publish(("mint", to), amount);
    }

    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let balance = Self::balance(env.clone(), from.clone());
        if balance < amount {
            panic!("insufficient balance to burn");
        }
        env.storage().persistent().set(&DataKey::Balance(from.clone()), &(balance - amount));
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &(supply - amount));
        env.events().publish(("burn", from), amount);
    }

    /// Burn tokens on behalf of a holder using spender allowance (#483).
    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let key = AllowanceKey { from: from.clone(), spender: spender.clone() };
        let val: AllowanceValue = env.storage().persistent().get(&key)
            .unwrap_or(AllowanceValue { amount: 0, expiration_ledger: 0 });
        if env.ledger().sequence() > val.expiration_ledger {
            panic!("allowance expired");
        }
        if val.amount < amount {
            panic!("insufficient allowance");
        }
        let balance = Self::balance(env.clone(), from.clone());
        if balance < amount {
            panic!("insufficient balance to burn");
        }
        env.storage().persistent().set(&key, &AllowanceValue {
            amount: val.amount - amount,
            expiration_ledger: val.expiration_ledger,
        });
        env.storage().persistent().set(&DataKey::Balance(from.clone()), &(balance - amount));
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &(supply - amount));
        env.events().publish(("burn_from", spender, from), amount);
    }

    /// Transfer tokens from `from` to `to` (#685: applies burn-on-transfer fee when fee_bps > 0).
    ///
    /// Fee calculation: burn_amount = amount * fee_bps / 10_000
    /// Recipient receives: amount - burn_amount
    /// burn_amount is permanently destroyed (total supply decreases).
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let from_balance = Self::balance(env.clone(), from.clone());
        if from_balance < amount {
            panic!("insufficient balance");
        }

        let fee_bps: u32 = env.storage().instance().get(&DataKey::TransferFeeBps).unwrap_or(0);
        let burn_amount: i128 = if fee_bps > 0 { amount * fee_bps as i128 / 10_000 } else { 0 };
        let net_amount = amount - burn_amount;

        env.storage().persistent().set(&DataKey::Balance(from.clone()), &(from_balance - amount));

        let to_balance = Self::balance(env.clone(), to.clone());
        env.storage().persistent().set(&DataKey::Balance(to.clone()), &(to_balance + net_amount));

        if burn_amount > 0 {
            let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
            env.storage().instance().set(&DataKey::TotalSupply, &(supply - burn_amount));
            env.events().publish(("transfer_burn", from.clone()), burn_amount);
        }

        env.events().publish(("transfer", from, to), amount);
    }

    /// Transfer tokens using spender allowance (#483, #685: applies burn-on-transfer fee).
    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let key = AllowanceKey { from: from.clone(), spender: spender.clone() };
        let val: AllowanceValue = env.storage().persistent().get(&key)
            .unwrap_or(AllowanceValue { amount: 0, expiration_ledger: 0 });
        if env.ledger().sequence() > val.expiration_ledger {
            panic!("allowance expired");
        }
        if val.amount < amount {
            panic!("insufficient allowance");
        }
        env.storage().persistent().set(&key, &AllowanceValue {
            amount: val.amount - amount,
            expiration_ledger: val.expiration_ledger,
        });

        let from_balance = Self::balance(env.clone(), from.clone());
        if from_balance < amount {
            panic!("insufficient balance");
        }

        let fee_bps: u32 = env.storage().instance().get(&DataKey::TransferFeeBps).unwrap_or(0);
        let burn_amount: i128 = if fee_bps > 0 { amount * fee_bps as i128 / 10_000 } else { 0 };
        let net_amount = amount - burn_amount;

        env.storage().persistent().set(&DataKey::Balance(from.clone()), &(from_balance - amount));

        let to_balance = Self::balance(env.clone(), to.clone());
        env.storage().persistent().set(&DataKey::Balance(to.clone()), &(to_balance + net_amount));

        if burn_amount > 0 {
            let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
            env.storage().instance().set(&DataKey::TotalSupply, &(supply - burn_amount));
            env.events().publish(("transfer_burn", from.clone()), burn_amount);
        }

        env.events().publish(("transfer_from", spender, from, to), amount);
    }

    /// Approve `spender` to spend up to `amount` tokens from `from` (#483).
    /// Allow the admin to update the token name and symbol (#690).
    /// Emits a `metadata_updated` event on success.
    pub fn update_metadata(env: Env, name: String, symbol: String) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut metadata: TokenMetadata = env.storage().instance().get(&DataKey::Metadata).unwrap();
        metadata.name = name.clone();
        metadata.symbol = symbol.clone();
        env.storage().instance().set(&DataKey::Metadata, &metadata);

        env.events().publish(("metadata_updated",), (name, symbol));
    }

    /// Approve `spender` to spend up to `amount` tokens from `from`'s balance.
    /// The allowance expires at `expiration_ledger` (inclusive).
    pub fn approve(env: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        if amount < 0 {
            panic!("amount must be non-negative");
        }
        let key = AllowanceKey { from: from.clone(), spender: spender.clone() };
        let value = AllowanceValue { amount, expiration_ledger };
        env.storage().persistent().set(&key, &value);
        env.storage().persistent().extend_ttl(&key, expiration_ledger, expiration_ledger);
        env.events().publish(("approve", from, spender), (amount, expiration_ledger));
    }

    /// Returns the current allowance for `spender` to spend from `from`.
    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        let key = AllowanceKey { from, spender };
        let val: Option<AllowanceValue> = env.storage().persistent().get(&key);
        match val {
            Some(a) if env.ledger().sequence() <= a.expiration_ledger => a.amount,
            _ => 0,
        }
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Balance(id)).unwrap_or(0)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn decimals(env: Env) -> u32 {
        let metadata: TokenMetadata = env.storage().instance().get(&DataKey::Metadata).unwrap();
        metadata.decimal
    }

    pub fn name(env: Env) -> String {
        let metadata: TokenMetadata = env.storage().instance().get(&DataKey::Metadata).unwrap();
        metadata.name
    }

    pub fn symbol(env: Env) -> String {
        let metadata: TokenMetadata = env.storage().instance().get(&DataKey::Metadata).unwrap();
        metadata.symbol
    }

    pub fn propose_admin(env: Env, new_admin: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
    }

    pub fn accept_admin(env: Env) {
        let pending: Address = env.storage().instance().get(&DataKey::PendingAdmin)
            .expect("no pending admin");
        pending.require_auth();
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup_token(env: &Env) -> (RewardTokenClient, Address) {
        let contract_id = env.register_contract(None, RewardToken);
        let client = RewardTokenClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.initialize(&admin, &7, &String::from_str(env, "Farmers Reward"), &String::from_str(env, "FRT"));
        (client, admin)
    }

    #[test]
    fn test_initialize_and_mint() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let user = Address::generate(&env);
        assert_eq!(client.name(), String::from_str(&env, "Farmers Reward"));
        assert_eq!(client.symbol(), String::from_str(&env, "FRT"));
        assert_eq!(client.decimals(), 7);
        env.mock_all_auths();
        client.mint(&user, &1000);
        assert_eq!(client.balance(&user), 1000);
    }

    #[test]
    fn test_transfer_no_fee() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&user1, &1000);
        client.transfer(&user1, &user2, &300);
        assert_eq!(client.balance(&user1), 700);
        assert_eq!(client.balance(&user2), 300);
        assert_eq!(client.total_supply(), 1000);
    }

    #[test]
    fn test_total_supply_mint_and_burn() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let user = Address::generate(&env);
        assert_eq!(client.total_supply(), 0);
        env.mock_all_auths();
        client.mint(&user, &100);
        assert_eq!(client.total_supply(), 100);
        client.burn(&user, &30);
        assert_eq!(client.total_supply(), 70);
        assert_eq!(client.balance(&user), 70);
    }

    #[test]
    #[should_panic(expected = "insufficient balance to burn")]
    fn test_burn_more_than_balance_panics() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let user = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&user, &50);
        client.burn(&user, &100);
    }

    // #685 - burn-on-transfer fee

    #[test]
    fn test_transfer_fee_defaults_to_zero() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        assert_eq!(client.transfer_fee_bps(), 0);
    }

    #[test]
    fn test_set_transfer_fee_by_admin() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        env.mock_all_auths();
        client.set_transfer_fee(&100);
        assert_eq!(client.transfer_fee_bps(), 100);
    }

    #[test]
    #[should_panic(expected = "fee_bps must be <= 10000")]
    fn test_set_transfer_fee_above_max_panics() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        env.mock_all_auths();
        client.set_transfer_fee(&10_001);
    }

    #[test]
    fn test_transfer_with_fee_burns_correct_amount() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&sender, &10_000);
        client.set_transfer_fee(&200); // 2%
        // Transfer 1000; 2% = 20 burned, 980 received
        client.transfer(&sender, &recipient, &1000);
        assert_eq!(client.balance(&sender), 9_000);
        assert_eq!(client.balance(&recipient), 980);
        assert_eq!(client.total_supply(), 9_980);
    }

    #[test]
    fn test_transfer_with_zero_fee_no_burn() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&sender, &1000);
        client.set_transfer_fee(&0);
        client.transfer(&sender, &recipient, &500);
        assert_eq!(client.balance(&recipient), 500);
        assert_eq!(client.total_supply(), 1000);
    }

    #[test]
    fn test_transfer_from_with_fee_burns_correct_amount() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&owner, &10_000);
        client.set_transfer_fee(&100); // 1%
        client.approve(&owner, &spender, &2000, &1000);
        // Transfer 1000; 1% = 10 burned, 990 received
        client.transfer_from(&spender, &owner, &recipient, &1000);
        assert_eq!(client.balance(&owner), 9_000);
        assert_eq!(client.balance(&recipient), 990);
        assert_eq!(client.total_supply(), 9_990);
        assert_eq!(client.allowance(&owner, &spender), 1000);
    }

    // burn_from

    #[test]
    fn test_burn_from_with_valid_allowance() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&owner, &1000);
        client.approve(&owner, &spender, &500, &1000);
        client.burn_from(&spender, &owner, &300);
        assert_eq!(client.balance(&owner), 700);
        assert_eq!(client.total_supply(), 700);
        assert_eq!(client.allowance(&owner, &spender), 200);
    }

    #[test]
    #[should_panic(expected = "insufficient allowance")]
    fn test_burn_from_exceeding_allowance_panics() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&owner, &1000);
        client.approve(&owner, &spender, &100, &1000);
        client.burn_from(&spender, &owner, &200);
    }

    #[test]
    #[should_panic(expected = "insufficient balance to burn")]
    fn test_burn_from_insufficient_balance_panics() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&owner, &100);
        client.approve(&owner, &spender, &500, &1000);
        client.burn_from(&spender, &owner, &200);
    }

    #[test]
    #[should_panic(expected = "allowance expired")]
    fn test_burn_from_expired_allowance_panics() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&owner, &1000);
        client.approve(&owner, &spender, &500, &0);
        env.ledger().set_sequence_number(1);
        client.burn_from(&spender, &owner, &100);
    }

    // admin transfer

    #[test]
    fn test_two_step_admin_transfer() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let new_admin = Address::generate(&env);
        env.mock_all_auths();
        client.propose_admin(&new_admin);
        client.accept_admin();
        let user = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&user, &500);
        assert_eq!(client.balance(&user), 500);
    }

    // approve / transfer_from (#483)

    #[test]
    fn test_approve_and_allowance() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        env.mock_all_auths();
        assert_eq!(client.allowance(&owner, &spender), 0);
        client.approve(&owner, &spender, &500, &1000);
        assert_eq!(client.allowance(&owner, &spender), 500);
    }

    #[test]
    fn test_transfer_from_within_allowance() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&owner, &1000);
        client.approve(&owner, &spender, &400, &1000);
        client.transfer_from(&spender, &owner, &recipient, &300);
        assert_eq!(client.balance(&owner), 700);
        assert_eq!(client.balance(&recipient), 300);
        assert_eq!(client.allowance(&owner, &spender), 100);
    }

    #[test]
    #[should_panic(expected = "insufficient allowance")]
    fn test_transfer_from_exceeding_allowance_panics() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&owner, &1000);
        client.approve(&owner, &spender, &100, &1000);
        client.transfer_from(&spender, &owner, &recipient, &200);
    }

    #[test]
    #[should_panic(expected = "allowance expired")]
    fn test_transfer_from_expired_allowance_panics() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&owner, &1000);
        client.approve(&owner, &spender, &500, &0);
        env.ledger().set_sequence_number(1);
        client.transfer_from(&spender, &owner, &recipient, &100);
    }

    // #475 - DataKey upgrade simulation

    // ── #690 update_metadata ─────────────────────────────────────────────────

    #[test]
    fn test_update_metadata_changes_name_and_symbol() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);

        env.mock_all_auths();
        client.update_metadata(
            &String::from_str(&env, "New Name"),
            &String::from_str(&env, "NEW"),
        );

        assert_eq!(client.name(), String::from_str(&env, "New Name"));
        assert_eq!(client.symbol(), String::from_str(&env, "NEW"));
    }

    #[test]
    #[should_panic]
    fn test_update_metadata_requires_admin() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        // No mock_all_auths — auth will fail for non-admin.
        client.update_metadata(
            &String::from_str(&env, "Hacked"),
            &String::from_str(&env, "HCK"),
        );
    }

    // ── #475 — DataKey upgrade simulation ────────────────────────────────────
    // Verify that a balance written under DataKey::Balance(addr) is retrievable
    // after the contract is re-registered (simulating an upgrade).
    #[test]
    fn test_balance_retrievable_after_upgrade_simulation() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RewardToken);
        let client = RewardTokenClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        client.initialize(&admin, &7, &String::from_str(&env, "Farmers Reward"), &String::from_str(&env, "FRT"));
        env.mock_all_auths();
        client.mint(&user, &250);
        let stored: i128 = env.storage().persistent().get(&DataKey::Balance(user.clone())).unwrap_or(0);
        assert_eq!(stored, 250, "balance must be stored under DataKey::Balance");
        let client2 = RewardTokenClient::new(&env, &env.register_contract(Some(contract_id), RewardToken));
        assert_eq!(client2.balance(&user), 250);
    }
}