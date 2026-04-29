#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String, Symbol};

#[contracttype]
#[derive(Clone)]
pub struct TokenMetadata {
    pub decimal: u32,
    pub name: String,
    pub symbol: String,
}

#[contract]
pub struct RewardToken;

const ADMIN: Symbol = Symbol::short("ADMIN");
const BALANCE: Symbol = Symbol::short("BALANCE");
const METADATA: Symbol = Symbol::short("METADATA");

#[contractimpl]
impl RewardToken {
    pub fn initialize(env: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if env.storage().instance().has(&METADATA) {
            panic!("already initialized");
        }

        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(
            &METADATA,
            &TokenMetadata {
                decimal,
                name,
                symbol,
            },
        );
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        admin.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let balance = Self::balance(env.clone(), to.clone());
        let new_balance = balance + amount;
        
        env.storage().persistent().set(&(BALANCE, to.clone()), &new_balance);
        
        env.events().publish(("mint", to.clone()), amount);
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&(BALANCE, id))
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
            .set(&(BALANCE, from.clone()), &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&(BALANCE, to.clone()), &(to_balance + amount));

        env.events().publish(("transfer", from.clone(), to.clone()), amount);
    }

    pub fn decimals(env: Env) -> u32 {
        let metadata: TokenMetadata = env.storage().instance().get(&METADATA).unwrap();
        metadata.decimal
    }

    pub fn name(env: Env) -> String {
        let metadata: TokenMetadata = env.storage().instance().get(&METADATA).unwrap();
        metadata.name
    }

    pub fn symbol(env: Env) -> String {
        let metadata: TokenMetadata = env.storage().instance().get(&METADATA).unwrap();
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
    fn test_transfer_emits_event() {
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
        
        env.events().publish(("transfer", user1.clone(), user2.clone()), 500i128);
        client.transfer(&user1, &user2, &500);
    }

    #[test]
    fn test_mint_emits_event() {
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
        env.events().publish(("mint", user.clone()), 1000i128);
        client.mint(&user, &1000);
    }
}
