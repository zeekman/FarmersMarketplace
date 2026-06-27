//! Farmers Marketplace Reward Token (FRT)
//!
//! SEP-0041 compliant Soroban fungible token for marketplace rewards.
//!
//! Issues addressed:
//!   #475 - Idiomatic DataKey enum for stable serialisation across SDK versions.
//!   #483 - approve / transfer_from / burn_from support.
//!   #685 - Optional burn-on-transfer fee, configurable by admin.
//!   #696 - Total supply cap: max_supply set at init, mint rejects overflow, remaining_supply() exposed.

#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

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
    /// Vesting lock entry: maps (address, mint_ledger) → VestingEntry (#693).
    Vesting(Address, u32),
    /// Global vesting period in ledgers (#693).
    VestingPeriod,
    /// Maximum mintable supply cap (#696). Set once at initialize; 0 = uncapped.
    MaxSupply,
    /// Burn-on-transfer fee in basis points (#685).
    TransferFeeBps,
    /// Reward tokens minted per 10,000 XLM spent (#846). Admin-configurable.
    RewardRateBps,
    /// Minter address authorized to mint tokens (#849).
    Minter,
    /// Maximum redemption percentage per order in basis points (e.g. 2000 = 20%). (#879)
    MaxRedemptionBps,
}

/// A single vesting lock created at mint time (#693).
#[contracttype]
#[derive(Clone)]
pub struct VestingEntry {
    /// Amount of tokens locked in this entry.
    pub locked_amount: i128,
    /// Ledger sequence number at which the tokens become transferable.
    pub unlock_ledger: u32,
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
    /// Initialise the token.  `max_supply` is the hard cap on total mintable
    /// tokens (#696).  Pass `0` to leave the supply uncapped.
    /// `minter` is the address authorized to mint tokens (#849).
    pub fn initialize(env: Env, admin: Address, minter: Address, decimal: u32, name: String, symbol: String, max_supply: i128) {
        if env.storage().instance().has(&DataKey::Metadata) {
            panic!("already initialized");
        }
        if max_supply < 0 {
            panic!("max_supply must be non-negative");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Minter, &minter);
        env.storage().instance().set(&DataKey::TotalSupply, &0_i128);
        env.storage().instance().set(&DataKey::TransferFeeBps, &0_u32);
        env.storage().instance().set(&DataKey::MaxSupply, &max_supply);
        env.storage().instance().set(&DataKey::RewardRateBps, &0_u32);
        env.storage().instance().set(&DataKey::MaxRedemptionBps, &2000_u32);
        env.storage().instance().set(
            &DataKey::Metadata,
            &TokenMetadata { decimal, name, symbol },
        );
    }

    // TTL buffer added on top of the vesting period when extending vesting entry TTL.
    const fn vesting_ttl_buffer() -> u32 { 10_000 }

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

    /// Sets reward_rate_bps: tokens minted per 10,000 XLM spent (#846). Admin-only.
    pub fn set_reward_rate(env: Env, new_rate: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::RewardRateBps, &new_rate);
        env.events().publish(("set_reward_rate",), new_rate);
    }

    /// Returns the current reward rate in basis points (#846).
    pub fn reward_rate_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::RewardRateBps).unwrap_or(0)
    }

    /// Mint reward tokens proportional to `xlm_amount` using reward_rate_bps (#846).
    /// tokens = xlm_amount * reward_rate_bps / 10000
    /// Returns MaxSupplyExceeded error code (via panic) if minting would exceed the cap.
    /// Admin must authorize this call.
    pub fn mint_for_order(env: Env, to: Address, xlm_amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if xlm_amount <= 0 {
            panic!("xlm_amount must be positive");
        }
        let rate: u32 = env.storage().instance().get(&DataKey::RewardRateBps).unwrap_or(0);
        if rate == 0 {
            return; // reward rate not configured, no-op
        }
        let amount = xlm_amount * rate as i128 / 10_000;
        if amount <= 0 {
            return;
        }

        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        let max_supply: i128 = env.storage().instance().get(&DataKey::MaxSupply).unwrap_or(0);
        if max_supply > 0 && supply + amount > max_supply {
            panic!("MaxSupplyExceeded");
        }

        let balance = Self::balance(env.clone(), to.clone());
        env.storage().persistent().set(&DataKey::Balance(to.clone()), &(balance + amount));
        env.storage().instance().set(&DataKey::TotalSupply, &(supply + amount));
        env.events().publish(("mint", to.clone()), amount);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let minter: Address = env.storage().instance().get(&DataKey::Minter).expect("minter not set");
        if env.invoker() != minter {
            panic!("unauthorized: only minter can mint");
        }
        if amount <= 0 {
            panic!("amount must be positive");
        }

        // #696 — enforce total supply cap if one is set.
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        let max_supply: i128 = env.storage().instance().get(&DataKey::MaxSupply).unwrap_or(0);
        if max_supply > 0 && supply + amount > max_supply {
            panic!("mint would exceed max_supply cap");
        }

        let balance = Self::balance(env.clone(), to.clone());
        env.storage().persistent().set(&DataKey::Balance(to.clone()), &(balance + amount));

        // #693 — record a vesting lock if a vesting period is configured.
        let vesting_period: u32 = env
            .storage()
            .instance()
            .get(&DataKey::VestingPeriod)
            .unwrap_or(0);
        if vesting_period > 0 {
            let current_ledger = env.ledger().sequence();
            let unlock_ledger = current_ledger.saturating_add(vesting_period);
            let vesting_key = DataKey::Vesting(to.clone(), current_ledger);
            let entry = VestingEntry { locked_amount: amount, unlock_ledger };
            env.storage().persistent().set(&vesting_key, &entry);
            // Keep the vesting entry alive at least until it unlocks.
            let ttl = vesting_period.saturating_add(Self::vesting_ttl_buffer());
            env.storage().persistent().extend_ttl(&vesting_key, ttl, ttl);
        }

        env.events().publish(("mint", to.clone()), amount);

        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &(supply + amount));
    }

    // -----------------------------------------------------------------------
    // Vesting helpers (#693)
    // -----------------------------------------------------------------------

    /// Set the global vesting period (in ledgers).  Admin-only.
    /// Pass 0 to disable vesting (newly minted tokens are immediately liquid).
    pub fn set_vesting_period(env: Env, ledgers: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::VestingPeriod, &ledgers);
        env.events().publish(("vesting_period_set",), ledgers);
    }

    /// Returns the current vesting period in ledgers (0 = no vesting).
    pub fn vesting_period(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::VestingPeriod).unwrap_or(0)
    }

    /// Returns the vested (transferable) balance for `id` at the current ledger.
    ///
    /// `mint_ledgers` is the list of ledger sequence numbers at which tokens
    /// were minted to `id` (used as the second component of the `Vesting` key).
    ///
    /// vested_balance = total_balance − Σ locked_amount for all unexpired entries
    pub fn vested_balance(env: Env, id: Address, mint_ledgers: Vec<u32>) -> i128 {
        let total = Self::balance(env.clone(), id.clone());
        let current = env.ledger().sequence();
        let mut locked: i128 = 0;
        for mint_ledger in mint_ledgers.iter() {
            let key = DataKey::Vesting(id.clone(), mint_ledger);
            if let Some(entry) = env.storage().persistent().get::<DataKey, VestingEntry>(&key) {
                if current < entry.unlock_ledger {
                    locked = locked.saturating_add(entry.locked_amount);
                }
            }
        }
        (total - locked).max(0)
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

    /// Admin-callable burn for reward reclamation on refund/dispute (#847).
    /// Burns up to `amount` from `from`; if balance < amount the burn is capped
    /// at the available balance (safe, never panics on insufficient balance).
    /// Emits ("reward", "burn", from, actual_amount).
    pub fn burn_reward(env: Env, from: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let balance = Self::balance(env.clone(), from.clone());
        if balance == 0 {
            return;
        }
        let actual = if amount > balance { balance } else { amount };
        env.storage().persistent().set(&DataKey::Balance(from.clone()), &(balance - actual));
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &(supply - actual));
        env.events().publish(("reward", "burn", from), actual);
    }

    /// Admin-callable burn for reward reclamation on refund/dispute (#847).
    /// Burns up to `amount` tokens from `from`; if balance < amount the burn is
    /// capped at the available balance (safe, non-panicking).
    /// Emits ("reward", "burn", from, actual_amount).
    pub fn burn_reward(env: Env, from: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let balance = Self::balance(env.clone(), from.clone());
        if balance == 0 {
            return; // nothing to burn
        }
        // Cap at available balance (#847 acceptance criterion)
        let actual = if amount > balance { balance } else { amount };
        env.storage().persistent().set(&DataKey::Balance(from.clone()), &(balance - actual));
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &(supply - actual));
        env.events().publish(("reward", "burn", from), actual);
    }

    // ── #879: On-chain redemption for marketplace discounts ────────────────────────

    /// Default maximum redemption percentage per order (20% = 2000 basis points). (#879)
    const DEFAULT_MAX_REDEMPTION_BPS: u32 = 2000;

    /// Set the max redemption basis points (admin only). (#879)
    pub fn set_max_redemption_bps(env: Env, bps: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if bps > 10_000 {
            panic!("max_redemption_bps must be <= 10000");
        }
        env.storage().instance().set(&DataKey::MaxRedemptionBps, &bps);
        env.events().publish(("set_max_redemption_bps",), bps);
    }

    /// Returns the current max redemption basis points. (#879)
    pub fn max_redemption_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::MaxRedemptionBps).unwrap_or(DEFAULT_MAX_REDEMPTION_BPS)
    }

    /// Redeem reward tokens for a discount on an order. (#879)
    ///
    /// Burns `token_amount` tokens from `buyer` and emits a redemption event
    /// that the backend can verify before applying a discount to the order total.
    /// Maximum redemption per order is `max_redemption_bps` (default 20% of order value).
    ///
    /// If the order fails and refund is issued, the escrow contract should re-mint
    /// the redeemed tokens back to the buyer.
    pub fn redeem(env: Env, buyer: Address, order_id: u64, token_amount: i128) {
        buyer.require_auth();
        if token_amount <= 0 {
            panic!("token_amount must be positive");
        }

        let balance = Self::balance(env.clone(), buyer.clone());
        if balance < token_amount {
            panic!("insufficient balance to redeem");
        }

        // Burn the tokens
        env.storage().persistent().set(&DataKey::Balance(buyer.clone()), &(balance - token_amount));
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &(supply - token_amount));

        // Emit redemption event for backend verification
        env.events().publish(
            ("reward", "redeemed", buyer, order_id),
            token_amount,
        );
    }

    /// Re-mint tokens after a failed order (refund path). (#879)
    /// Only callable by admin (escrow contract or platform).
    pub fn reissue_redeemed(env: Env, buyer: Address, order_id: u64, token_amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if token_amount <= 0 {
            panic!("token_amount must be positive");
        }

        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        let max_supply: i128 = env.storage().instance().get(&DataKey::MaxSupply).unwrap_or(0);
        if max_supply > 0 && supply + token_amount > max_supply {
            panic!("reissue would exceed max_supply cap");
        }

        let balance = Self::balance(env.clone(), buyer.clone());
        env.storage().persistent().set(&DataKey::Balance(buyer.clone()), &(balance + token_amount));
        env.storage().instance().set(&DataKey::TotalSupply, &(supply + token_amount));
        env.events().publish(("reward", "reissued", buyer, order_id), token_amount);
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

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(from_balance - amount));

        let to_balance = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &(to_balance + net_amount));

        if burn_amount > 0 {
            let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
            env.storage().instance().set(&DataKey::TotalSupply, &(supply - burn_amount));
            env.events().publish(("transfer_burn", from.clone()), burn_amount);
        }

        env.events().publish(("transfer", from.clone(), to.clone()), amount);
    }

    /// Transfer tokens while explicitly checking vesting locks (#693).
    ///
    /// `mint_ledgers` is the list of ledger sequence numbers at which tokens
    /// were minted to `from`.  The contract uses these to look up vesting
    /// entries and compute the locked amount.  The transfer is rejected if
    /// `amount` exceeds the vested (unlocked) balance.
    pub fn transfer_vested(
        env: Env,
        from: Address,
        to: Address,
        amount: i128,
        mint_ledgers: Vec<u32>,
    ) {
        from.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let vested = Self::vested_balance(env.clone(), from.clone(), mint_ledgers);
        if amount > vested {
            panic!("transfer amount exceeds vested balance");
        }

        let from_balance = Self::balance(env.clone(), from.clone());
        let to_balance = Self::balance(env.clone(), to.clone());

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(from_balance - amount));
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &(to_balance + amount));

        env.events().publish(("transfer_vested", from, to), amount);
    }

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

    /// Returns the maximum mintable supply cap (#696).  0 means uncapped.
    pub fn max_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::MaxSupply).unwrap_or(0)
    }

    /// Returns how many tokens can still be minted before hitting the cap (#696).
    /// Returns `i128::MAX` when the supply is uncapped.
    pub fn remaining_supply(env: Env) -> i128 {
        let max: i128 = env.storage().instance().get(&DataKey::MaxSupply).unwrap_or(0);
        if max == 0 {
            return i128::MAX;
        }
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        (max - supply).max(0)
    }

    /// Admin-only: update the max supply cap (#849).
    /// Can only be called by the current admin.
    pub fn set_max_supply(env: Env, new_max_supply: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if new_max_supply < 0 {
            panic!("max_supply must be non-negative");
        }
        env.storage().instance().set(&DataKey::MaxSupply, &new_max_supply);
        env.events().publish(("max_supply_updated",), new_max_supply);
    }

    /// Admin-only: update the minter address (#849).
    /// Can only be called by the current admin.
    pub fn set_minter(env: Env, new_minter: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Minter, &new_minter);
        env.events().publish(("minter_updated",), new_minter);
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

    fn setup_token(env: &Env) -> (RewardTokenClient, Address, Address) {
        let contract_id = env.register_contract(None, RewardToken);
        let client = RewardTokenClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let minter = Address::generate(env);
        client.initialize(&admin, &minter, &7, &String::from_str(env, "Farmers Reward"), &String::from_str(env, "FRT"), &0);
        (client, admin, minter)
    }

    #[test]
    fn test_initialize_and_mint() {
        let env = Env::default();
        let (client, _admin, minter) = setup_token(&env);
        let user = Address::generate(&env);
        assert_eq!(client.name(), String::from_str(&env, "Farmers Reward"));
        assert_eq!(client.symbol(), String::from_str(&env, "FRT"));
        assert_eq!(client.decimals(), 7);
        env.mock_auths(&[&minter]);
        client.mint(&user, &1000);
        assert_eq!(client.balance(&user), 1000);
    }

    #[test]
    fn test_transfer_no_fee() {
        let env = Env::default();
        let (client, _admin, minter) = setup_token(&env);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        env.mock_auths(&[&minter, &user1]);
        client.mint(&user1, &1000);
        client.transfer(&user1, &user2, &300);
        assert_eq!(client.balance(&user1), 700);
        assert_eq!(client.balance(&user2), 300);
        assert_eq!(client.total_supply(), 1000);
    }

    #[test]
    fn test_total_supply_mint_and_burn() {
        let env = Env::default();
        let (client, _admin, minter) = setup_token(&env);
        let user = Address::generate(&env);
        assert_eq!(client.total_supply(), 0);
        env.mock_auths(&[&minter, &user]);
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
        let (client, _admin, minter) = setup_token(&env);
        let user = Address::generate(&env);
        env.mock_auths(&[&minter, &user]);
        client.mint(&user, &50);
        client.burn(&user, &100);
    }

    // #685 - burn-on-transfer fee

    #[test]
    fn test_transfer_fee_defaults_to_zero() {
        let env = Env::default();
        let (client, _admin, _minter) = setup_token(&env);
        assert_eq!(client.transfer_fee_bps(), 0);
    }

    #[test]
    fn test_set_transfer_fee_by_admin() {
        let env = Env::default();
        let (client, admin, _minter) = setup_token(&env);
        env.mock_auths(&[&admin]);
        client.set_transfer_fee(&100);
        assert_eq!(client.transfer_fee_bps(), 100);
    }

    #[test]
    #[should_panic(expected = "fee_bps must be <= 10000")]
    fn test_set_transfer_fee_above_max_panics() {
        let env = Env::default();
        let (client, admin, _minter) = setup_token(&env);
        env.mock_auths(&[&admin]);
        client.set_transfer_fee(&10_001);
    }

    #[test]
    fn test_transfer_with_fee_burns_correct_amount() {
        let env = Env::default();
        let (client, admin, minter) = setup_token(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_auths(&[&minter, &admin, &sender]);
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
        let (client, admin, minter) = setup_token(&env);
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_auths(&[&minter, &admin, &sender]);
        client.mint(&sender, &1000);
        client.set_transfer_fee(&0);
        client.transfer(&sender, &recipient, &500);
        assert_eq!(client.balance(&recipient), 500);
        assert_eq!(client.total_supply(), 1000);
    }

    #[test]
    fn test_transfer_from_with_fee_burns_correct_amount() {
        let env = Env::default();
        let (client, admin, minter) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_auths(&[&minter, &admin, &owner, &spender]);
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
        let (client, _admin, minter) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        env.mock_auths(&[&minter, &owner, &spender]);
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
        let (client, _admin, minter) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        env.mock_auths(&[&minter, &owner, &spender]);
        client.mint(&owner, &1000);
        client.approve(&owner, &spender, &100, &1000);
        client.burn_from(&spender, &owner, &200);
    }

    #[test]
    #[should_panic(expected = "insufficient balance to burn")]
    fn test_burn_from_insufficient_balance_panics() {
        let env = Env::default();
        let (client, _admin, minter) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        env.mock_auths(&[&minter, &owner, &spender]);
        client.mint(&owner, &100);
        client.approve(&owner, &spender, &500, &1000);
        client.burn_from(&spender, &owner, &200);
    }

    #[test]
    #[should_panic(expected = "allowance expired")]
    fn test_burn_from_expired_allowance_panics() {
        let env = Env::default();
        let (client, _admin, minter) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        env.mock_auths(&[&minter, &owner, &spender]);
        client.mint(&owner, &1000);
        client.approve(&owner, &spender, &500, &0);
        env.ledger().set_sequence_number(1);
        client.burn_from(&spender, &owner, &100);
    }

    // admin transfer

    #[test]
    fn test_two_step_admin_transfer() {
        let env = Env::default();
        let (client, admin, minter) = setup_token(&env);
        let new_admin = Address::generate(&env);
        env.mock_auths(&[&admin, &new_admin, &minter]);
        client.propose_admin(&new_admin);
        client.accept_admin();
        let user = Address::generate(&env);
        client.mint(&user, &500);
        assert_eq!(client.balance(&user), 500);
    }

    // approve / transfer_from (#483)

    #[test]
    fn test_approve_and_allowance() {
        let env = Env::default();
        let (client, _admin, _minter) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        env.mock_auths(&[&owner]);
        assert_eq!(client.allowance(&owner, &spender), 0);
        client.approve(&owner, &spender, &500, &1000);
        assert_eq!(client.allowance(&owner, &spender), 500);
    }

    #[test]
    fn test_transfer_from_within_allowance() {
        let env = Env::default();
        let (client, _admin, minter) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_auths(&[&minter, &owner, &spender]);
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
        let (client, _admin, minter) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_auths(&[&minter, &owner, &spender]);
        client.mint(&owner, &1000);
        client.approve(&owner, &spender, &100, &1000);
        client.transfer_from(&spender, &owner, &recipient, &200);
    }

    #[test]
    #[should_panic(expected = "allowance expired")]
    fn test_transfer_from_expired_allowance_panics() {
        let env = Env::default();
        let (client, _admin, minter) = setup_token(&env);
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_auths(&[&minter, &owner, &spender]);
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
        let (client, admin, _minter) = setup_token(&env);

        env.mock_auths(&[&admin]);
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
        let minter = Address::generate(&env);
        let user = Address::generate(&env);
        client.initialize(&admin, &minter, &7, &String::from_str(&env, "Farmers Reward"), &String::from_str(&env, "FRT"));
        env.mock_auths(&[&minter]);
        client.mint(&user, &250);
        let stored: i128 = env.storage().persistent().get(&DataKey::Balance(user.clone())).unwrap_or(0);
        assert_eq!(stored, 250, "balance must be stored under DataKey::Balance");
        let client2 = RewardTokenClient::new(&env, &env.register_contract(Some(contract_id), RewardToken));
        assert_eq!(client2.balance(&user), 250);
    }

    // ── #846 — reward_rate_bps and mint_for_order ─────────────────────────────

    #[test]
    fn test_reward_rate_bps_defaults_to_zero() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        assert_eq!(client.reward_rate_bps(), 0);
    }

    #[test]
    fn test_set_reward_rate_by_admin() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        env.mock_all_auths();
        client.set_reward_rate(&500); // 5%
        assert_eq!(client.reward_rate_bps(), 500);
    }

    #[test]
    fn test_mint_for_order_rate_calculation() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let user = Address::generate(&env);
        env.mock_all_auths();
        client.set_reward_rate(&100); // 1% = 100 bps
        // 10,000 XLM * 100 bps / 10,000 = 100 tokens
        client.mint_for_order(&user, &10_000);
        assert_eq!(client.balance(&user), 100);
        assert_eq!(client.total_supply(), 100);
    }

    #[test]
    fn test_mint_for_order_zero_rate_is_noop() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        let user = Address::generate(&env);
        env.mock_all_auths();
        // rate = 0 (default) → no tokens minted
        client.mint_for_order(&user, &10_000);
        assert_eq!(client.balance(&user), 0);
        assert_eq!(client.total_supply(), 0);
    }

    #[test]
    #[should_panic(expected = "MaxSupplyExceeded")]
    fn test_mint_for_order_exceeds_max_supply_panics() {
        let env = Env::default();
        let contract_id = env.register_contract(None, RewardToken);
        let client = RewardTokenClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        // cap = 50 tokens
        client.initialize(&admin, &7, &String::from_str(&env, "FRT"), &String::from_str(&env, "FRT"), &50);
        env.mock_all_auths();
        client.set_reward_rate(&10_000); // 100% rate → 1 XLM = 1 token
        client.mint_for_order(&user, &100); // would mint 100 tokens, cap is 50
    }

    #[test]
    #[should_panic]
    fn test_set_reward_rate_requires_admin() {
        let env = Env::default();
        let (client, _admin) = setup_token(&env);
        // No mock_all_auths — auth will fail for non-admin
        client.set_reward_rate(&100);
    // ── #849 minter role tests ─────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "unauthorized: only minter can mint")]
    fn test_unauthorized_mint_panics() {
        let env = Env::default();
        let (client, _admin, _minter) = setup_token(&env);
        let user = Address::generate(&env);
        let unauthorized = Address::generate(&env);
        env.mock_auths(&[&unauthorized]); // Not the minter
        client.mint(&user, &100);
    }

    #[test]
    fn test_set_minter_by_admin() {
        let env = Env::default();
        let (client, admin, minter) = setup_token(&env);
        let new_minter = Address::generate(&env);
        env.mock_auths(&[&admin]);
        client.set_minter(&new_minter);
        // Verify new minter can mint
        env.mock_auths(&[&new_minter]);
        let user = Address::generate(&env);
        client.mint(&user, &500);
        assert_eq!(client.balance(&user), 500);
    }

    #[test]
    #[should_panic]
    fn test_set_minter_requires_admin() {
        let env = Env::default();
        let (client, _admin, _minter) = setup_token(&env);
        let new_minter = Address::generate(&env);
        let unauthorized = Address::generate(&env);
        env.mock_auths(&[&unauthorized]); // Not admin
        client.set_minter(&new_minter);
    }

    #[test]
    fn test_set_max_supply_by_admin() {
        let env = Env::default();
        let (client, admin, minter) = setup_token(&env);
        env.mock_auths(&[&admin]);
        client.set_max_supply(&1_000_000);
        assert_eq!(client.max_supply(), 1_000_000);
        // Verify mint respects new cap
        env.mock_auths(&[&minter]);
        let user = Address::generate(&env);
        client.mint(&user, &500_000);
        assert_eq!(client.remaining_supply(), 500_000);
    }

    #[test]
    #[should_panic]
    fn test_set_max_supply_requires_admin() {
        let env = Env::default();
        let (client, _admin, _minter) = setup_token(&env);
        let unauthorized = Address::generate(&env);
        env.mock_auths(&[&unauthorized]); // Not admin
        client.set_max_supply(&1_000_000);
    }

    #[test]
    fn test_admin_transfer_maintains_minter_access() {
        let env = Env::default();
        let (client, admin, minter) = setup_token(&env);
        let new_admin = Address::generate(&env);
        
        // Original admin can mint via minter
        env.mock_auths(&[&minter]);
        let user1 = Address::generate(&env);
        client.mint(&user1, &100);
        
        // Transfer admin
        env.mock_auths(&[&admin, &new_admin]);
        client.propose_admin(&new_admin);
        client.accept_admin();
        
        // New admin can still use minter to mint
        env.mock_auths(&[&minter]);
        let user2 = Address::generate(&env);
        client.mint(&user2, &200);
        assert_eq!(client.balance(&user2), 200);
    }
}