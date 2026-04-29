#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String};

#[contracttype]
#[derive(Clone)]
pub struct TokenMetadata {
    pub decimal: u32,
    pub name: String,
    pub symbol: String,
}

/// Idiomatic storage key enum — stable serialisation across SDK versions (#475).
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Balance(Address),
    Admin,
    Metadata,
    TotalSupply,
    PendingAdmin,
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
        env.storage().instance().set(
            &DataKey::Metadata,
            &TokenMetadata {
                decimal,
                name,
                symbol,
            },
        );
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let balance = Self::balance(env.clone(), to.clone());

        env.storage().persistent().set(&DataKey::Balance(to.clone()), &(balance + amount));

        env.events().publish(("mint", to.clone()), amount);

        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &(supply + amount));

        token::TokenInterface::mint(&env, to, amount);
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

        env.events().publish(("burn", from.clone()), amount);
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
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

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let from_balance = Self::balance(env.clone(), from.clone());
        if from_balance < amount {
            panic!("insufficient balance");
        }

        let to_balance = Self::balance(env.clone(), to.clone());

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &(to_balance + amount));

        env.events().publish(("transfer", from.clone(), to.clone()), amount);
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
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_initialize_and_mint() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RewardToken);
        let client = RewardTokenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(
            &admin,
            &7,
            &String::from_str(&env, "Farmers Reward"),
            &String::from_str(&env, "FRT"),
        );

        assert_eq!(client.name(), String::from_str(&env, "Farmers Reward"));
        assert_eq!(client.symbol(), String::from_str(&env, "FRT"));
        assert_eq!(client.decimals(), 7);

        env.mock_all_auths();
        client.mint(&user, &1000);
        assert_eq!(client.balance(&user), 1000);
    }

    #[test]
    fn test_transfer() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RewardToken);
        let client = RewardTokenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        client.initialize(
            &admin,
            &7,
            &String::from_str(&env, "Farmers Reward"),
            &String::from_str(&env, "FRT"),
        );

        env.mock_all_auths();
        client.mint(&user1, &1000);
        client.transfer(&user1, &user2, &300);

        assert_eq!(client.balance(&user1), 700);
        assert_eq!(client.balance(&user2), 300);
    }

    #[test]
    fn test_total_supply_mint_and_burn() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RewardToken);
        let client = RewardTokenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(
            &admin,
            &7,
            &String::from_str(&env, "Farmers Reward"),
            &String::from_str(&env, "FRT"),
        );

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
        let contract_id = env.register_contract(None, RewardToken);
        let client = RewardTokenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(
            &admin,
            &7,
            &String::from_str(&env, "Farmers Reward"),
            &String::from_str(&env, "FRT"),
        );

        env.mock_all_auths();
        client.mint(&user, &50);
        client.burn(&user, &100);
    }

    #[test]
    fn test_two_step_admin_transfer() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RewardToken);
        let client = RewardTokenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);

        client.initialize(
            &admin,
            &7,
            &String::from_str(&env, "Farmers Reward"),
            &String::from_str(&env, "FRT"),
        );

        env.mock_all_auths();
        client.propose_admin(&new_admin);
        client.accept_admin();

        // New admin can now mint
        let user = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&user, &500);
        assert_eq!(client.balance(&user), 500);
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

        client.initialize(
            &admin,
            &7,
            &String::from_str(&env, "Farmers Reward"),
            &String::from_str(&env, "FRT"),
        );

        env.mock_all_auths();
        client.mint(&user, &250);

        // Write the key directly to confirm the DataKey enum serialises correctly.
        let stored: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(user.clone()))
            .unwrap_or(0);
        assert_eq!(stored, 250, "balance must be stored under DataKey::Balance");

        // Re-register at the same address (simulates upgrade) and confirm readability.
        let client2 = RewardTokenClient::new(&env, &env.register_contract(Some(contract_id), RewardToken));
        assert_eq!(client2.balance(&user), 250);
    }
}
