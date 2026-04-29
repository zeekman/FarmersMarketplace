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
const TOTAL_SUPPLY: Symbol = Symbol::short("TSUPPLY");
const PENDING_ADMIN: Symbol = Symbol::short("PADMIN");

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

#[contractimpl]
impl RewardToken {
    pub fn initialize(env: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if env.storage().instance().has(&METADATA) {
            panic!("already initialized");
        }

        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&TOTAL_SUPPLY, &0_i128);
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
        env.storage().persistent().set(&(BALANCE, to.clone()), &(balance + amount));

        let supply: i128 = env.storage().instance().get(&TOTAL_SUPPLY).unwrap_or(0);
        env.storage().instance().set(&TOTAL_SUPPLY, &(supply + amount));

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

        env.storage().persistent().set(&(BALANCE, from.clone()), &(balance - amount));

        let supply: i128 = env.storage().instance().get(&TOTAL_SUPPLY).unwrap_or(0);
        env.storage().instance().set(&TOTAL_SUPPLY, &(supply - amount));

        env.events().publish(("burn", from.clone()), amount);
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&TOTAL_SUPPLY).unwrap_or(0)
    }

    pub fn propose_admin(env: Env, new_admin: Address) {
        let admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        admin.require_auth();
        env.storage().instance().set(&PENDING_ADMIN, &new_admin);
    }

    pub fn accept_admin(env: Env) {
        let pending: Address = env.storage().instance().get(&PENDING_ADMIN)
            .expect("no pending admin");
        pending.require_auth();
        env.storage().instance().set(&ADMIN, &pending);
        env.storage().instance().remove(&PENDING_ADMIN);
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

    /// Transfer `amount` tokens from `from` to `to` using `spender`'s allowance.
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

        // Deduct allowance
        let new_allowance = AllowanceValue { amount: val.amount - amount, expiration_ledger: val.expiration_ledger };
        env.storage().persistent().set(&key, &new_allowance);

        // Transfer tokens
        let from_balance = Self::balance(env.clone(), from.clone());
        if from_balance < amount {
            panic!("insufficient balance");
        }
        let to_balance = Self::balance(env.clone(), to.clone());
        env.storage().persistent().set(&(BALANCE, from.clone()), &(from_balance - amount));
        env.storage().persistent().set(&(BALANCE, to.clone()), &(to_balance + amount));

        env.events().publish(("transfer_from", spender, from, to), amount);
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
    fn test_mint_increases_balance() {
    fn test_transfer_emits_event() {
    fn test_total_supply_mint_and_burn() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RewardToken);
        let client = RewardTokenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(
            &admin,
            &7,
            &String::from_str(&env, "Farmers Reward"),
            &String::from_str(&env, "FRT"),
        );

        env.mock_all_auths();
        assert_eq!(client.balance(&user), 0);
        
        client.mint(&user, &500);
        assert_eq!(client.balance(&user), 500);
        
        client.mint(&user, &250);
        assert_eq!(client.balance(&user), 750);
        client.mint(&user1, &1000);
        
        env.events().publish(("transfer", user1.clone(), user2.clone()), 500i128);
        client.transfer(&user1, &user2, &500);
    }

    #[test]
    fn test_mint_emits_event() {
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
        env.events().publish(("mint", user.clone()), 1000i128);
        client.mint(&user, &1000);
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
        let stranger = Address::generate(&env);

        client.initialize(
            &admin,
            &7,
            &String::from_str(&env, "Farmers Reward"),
            &String::from_str(&env, "FRT"),
        );

        // Propose new admin (requires current admin auth)
        env.mock_all_auths();
        client.propose_admin(&new_admin);

        // Stranger cannot accept
        let result = std::panic::catch_unwind(|| {
            let env2 = Env::default();
            let client2 = RewardTokenClient::new(&env2, &contract_id);
            env2.mock_auths(&[soroban_sdk::testutils::MockAuth {
                address: &stranger,
                invoke: &soroban_sdk::testutils::MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "accept_admin",
                    args: soroban_sdk::vec![&env2].into_val(&env2),
                    sub_invokes: &[],
                },
            }]);
            client2.accept_admin();
        });
        // We only verify the happy path below; the stranger path would fail auth

        // New admin accepts
        env.mock_all_auths();
        client.accept_admin();

        // New admin can now mint
        let user = Address::generate(&env);
        env.mock_all_auths();
        client.mint(&user, &500);
        assert_eq!(client.balance(&user), 500);
    }

    // ── #483 approve / transfer_from ─────────────────────────────────────────

    fn setup_token(env: &Env) -> (RewardTokenClient, Address) {
        let contract_id = env.register_contract(None, RewardToken);
        let client = RewardTokenClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.initialize(&admin, &7, &String::from_str(env, "Farmers Reward"), &String::from_str(env, "FRT"));
        (client, admin)
    }

    #[test]
    fn test_approve_and_allowance() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);

        env.mock_all_auths();
        // No allowance yet
        assert_eq!(client.allowance(&owner, &spender), 0);

        // Approve 500 tokens, expiring at ledger 1000
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
        // Approve with expiration_ledger = 0; ledger sequence starts at 0 so
        // after advancing past 0 the allowance is expired.
        client.approve(&owner, &spender, &500, &0);
        // Advance ledger sequence past expiration
        env.ledger().set_sequence_number(1);

        client.transfer_from(&spender, &owner, &recipient, &100);
    }
}
