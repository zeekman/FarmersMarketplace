#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol};
use fm_math::compute_fee as fm_compute_fee;

/// Ledgers per second approximation is not needed; vesting is expressed in ledgers.
const DAY_IN_LEDGERS: u32 = 17_280;

#[contracttype]
#[derive(Clone)]
pub struct AllowanceData {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct VestingSchedule {
    pub total: i128,
    pub claimed: i128,
    pub start_ledger: u32,
    pub cliff_ledger: u32,
    pub end_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct TokenConfig {
    pub name: String,
    pub symbol: String,
    pub decimals: u32,
    pub admin: Address,
    pub fee_bps: u32,
    pub fee_recipient: Address,
}

fn get_config(e: &Env) -> TokenConfig {
    e.storage().instance().get(&symbol_short!("CONFIG")).unwrap()
}

fn read_balance(e: &Env, id: &Address) -> i128 {
    e.storage().persistent().get(&id.clone()).unwrap_or(0)
}

fn write_balance(e: &Env, id: &Address, amount: i128) {
    e.storage().persistent().set(&id.clone(), &amount);
}

fn read_allowance(e: &Env, from: &Address, spender: &Address) -> AllowanceData {
    let key = (from.clone(), spender.clone());
    e.storage()
        .persistent()
        .get(&key)
        .unwrap_or(AllowanceData {
            amount: 0,
            expiration_ledger: 0,
        })
}

fn write_allowance(e: &Env, from: &Address, spender: &Address, data: &AllowanceData) {
    let key = (from.clone(), spender.clone());
    e.storage().persistent().set(&key, data);
}

fn read_vesting(e: &Env, id: &Address) -> Option<VestingSchedule> {
    e.storage().persistent().get(&(symbol_short!("VEST"), id.clone()))
}

fn vested_amount(schedule: &VestingSchedule, ledger: u32) -> i128 {
    if ledger < schedule.cliff_ledger {
        return 0;
    }
    if ledger >= schedule.end_ledger {
        return schedule.total;
    }
    let elapsed = (ledger - schedule.start_ledger) as i128;
    let duration = (schedule.end_ledger - schedule.start_ledger) as i128;
    schedule.total * elapsed / duration
}

#[contract]
pub struct RewardToken;

#[contractimpl]
impl RewardToken {
    pub fn initialize(
        e: Env,
        admin: Address,
        name: String,
        symbol: String,
        decimals: u32,
        fee_bps: u32,
        fee_recipient: Address,
    ) {
        if e.storage().instance().has(&symbol_short!("CONFIG")) {
            panic!("already initialized");
        }
        let config = TokenConfig {
            name,
            symbol,
            decimals,
            admin,
            fee_bps,
            fee_recipient,
        };
        e.storage().instance().set(&symbol_short!("CONFIG"), &config);
    }

    // ---- SEP-41 metadata ----

    pub fn name(e: Env) -> String {
        get_config(&e).name
    }

    pub fn symbol(e: Env) -> String {
        get_config(&e).symbol
    }

    pub fn decimals(e: Env) -> u32 {
        get_config(&e).decimals
    }

    pub fn balance(e: Env, id: Address) -> i128 {
        read_balance(&e, &id)
    }

    pub fn allowance(e: Env, from: Address, spender: Address) -> i128 {
        let data = read_allowance(&e, &from, &spender);
        if data.expiration_ledger != 0 && data.expiration_ledger < e.ledger().sequence() {
            return 0;
        }
        data.amount
    }

    // ---- SEP-41 approve ----

    pub fn approve(e: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        if amount > 0 && expiration_ledger < e.ledger().sequence() {
            panic!("expiration_ledger is in the past");
        }
        let data = AllowanceData {
            amount,
            expiration_ledger,
        };
        write_allowance(&e, &from, &spender, &data);
        e.events()
            .publish((symbol_short!("approve"), from, spender), amount);
    }

    // ---- SEP-41 transfer ----

    pub fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::do_transfer(&e, &from, &to, amount);
    }

    pub fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        let mut data = read_allowance(&e, &from, &spender);
        if data.expiration_ledger != 0 && data.expiration_ledger < e.ledger().sequence() {
            data.amount = 0;
        }
        if data.amount < amount {
            panic!("insufficient allowance");
        }
        data.amount -= amount;
        write_allowance(&e, &from, &spender, &data);
        Self::do_transfer(&e, &from, &to, amount);
    }

    // ---- SEP-41 burn ----

    pub fn burn(e: Env, from: Address, amount: i128) {
        from.require_auth();
        Self::do_burn(&e, &from, amount);
    }

    pub fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        let mut data = read_allowance(&e, &from, &spender);
        if data.expiration_ledger != 0 && data.expiration_ledger < e.ledger().sequence() {
            data.amount = 0;
        }
        if data.amount < amount {
            panic!("insufficient allowance");
        }
        data.amount -= amount;
        write_allowance(&e, &from, &spender, &data);
        Self::do_burn(&e, &from, amount);
    }

    // ---- admin mint ----

    pub fn mint(e: Env, to: Address, amount: i128) {
        let config = get_config(&e);
        config.admin.require_auth();
        let balance = read_balance(&e, &to);
        write_balance(&e, &to, balance + amount);
        e.events()
            .publish((symbol_short!("mint"), config.admin, to), amount);
    }

    // ---- vesting ----

    pub fn set_vesting(
        e: Env,
        account: Address,
        total: i128,
        start_ledger: u32,
        cliff_ledger: u32,
        end_ledger: u32,
    ) {
        let config = get_config(&e);
        config.admin.require_auth();
        let schedule = VestingSchedule {
            total,
            claimed: 0,
            start_ledger,
            cliff_ledger,
            end_ledger,
        };
        e.storage()
            .persistent()
            .set(&(symbol_short!("VEST"), account), &schedule);
    }

    pub fn vested_balance(e: Env, account: Address) -> i128 {
        match read_vesting(&e, &account) {
            Some(schedule) => vested_amount(&schedule, e.ledger().sequence()) - schedule.claimed,
            None => 0,
        }
    }

    // ---- internal helpers ----

    fn do_transfer(e: &Env, from: &Address, to: &Address, amount: i128) {
        if amount < 0 {
            panic!("amount must be non-negative");
        }
        let from_balance = read_balance(e, from);
        if from_balance < amount {
            panic!("insufficient balance");
        }
        let config = get_config(e);
        let fee = fm_compute_fee(amount, config.fee_bps).expect("fee calculation overflow");
        let net = amount - fee;

        write_balance(e, from, from_balance - amount);
        let to_balance = read_balance(e, to);
        write_balance(e, to, to_balance + net);
        if fee > 0 {
            let fee_balance = read_balance(e, &config.fee_recipient);
            write_balance(e, &config.fee_recipient, fee_balance + fee);
        }

        e.events()
            .publish((symbol_short!("transfer"), from.clone(), to.clone()), amount);
    }

    fn do_burn(e: &Env, from: &Address, amount: i128) {
        if amount < 0 {
            panic!("amount must be non-negative");
        }
        let balance = read_balance(e, from);
        if balance < amount {
            panic!("insufficient balance");
        }
        write_balance(e, from, balance - amount);
        e.events()
            .publish((symbol_short!("burn"), from.clone()), amount);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::token::TokenClient;
    use soroban_sdk::{Env, String};

    fn setup(e: &Env) -> (Address, Address, Address, Address) {
        let admin = Address::generate(e);
        let user = Address::generate(e);
        let spender = Address::generate(e);
        let fee_recipient = Address::generate(e);
        let contract_id = e.register(RewardToken, ());
        let client = RewardTokenClient::new(e, &contract_id);
        client.initialize(
            &admin,
            &String::from_str(e, "Reward Token"),
            &String::from_str(e, "RWD"),
            &7u32,
            &0u32,
            &fee_recipient,
        );
        (contract_id, admin, user, spender)
    }

    #[test]
    fn sep41_compliance() {
        let e = Env::default();
        e.mock_all_auths();
        let (contract_id, admin, user, spender) = setup(&e);

        let token = TokenClient::new(&e, &contract_id);

        assert_eq!(token.name(), String::from_str(&e, "Reward Token"));
        assert_eq!(token.symbol(), String::from_str(&e, "RWD"));
        assert_eq!(token.decimals(), 7u32);

        let client = RewardTokenClient::new(&e, &contract_id);
        client.mint(&user, &1_000i128);
        assert_eq!(token.balance(&user), 1_000i128);

        token.transfer(&user, &spender, &100i128);
        assert_eq!(token.balance(&user), 900i128);
        assert_eq!(token.balance(&spender), 100i128);

        token.approve(&user, &spender, &200i128, &(e.ledger().sequence() + 100));
        assert_eq!(token.allowance(&user, &spender), 200i128);

        token.transfer_from(&spender, &user, &spender, &50i128);
        assert_eq!(token.allowance(&user, &spender), 150i128);
        assert_eq!(token.balance(&spender), 150i128);

        token.burn(&user, &100i128);
        assert_eq!(token.balance(&user), 750i128);

        token.approve(&user, &spender, &100i128, &(e.ledger().sequence() + 100));
        token.burn_from(&spender, &user, &100i128);
        assert_eq!(token.balance(&user), 650i128);
        assert_eq!(token.allowance(&user, &spender), 0i128);

        let _ = admin;
    }

    #[test]
    #[should_panic]
    fn approve_past_expiration_rejected() {
        let e = Env::default();
        e.mock_all_auths();
        let (contract_id, _admin, user, spender) = setup(&e);
        let token = TokenClient::new(&e, &contract_id);
        token.approve(&user, &spender, &100i128, &0u32);
    }
}
