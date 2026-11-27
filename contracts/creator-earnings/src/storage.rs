use soroban_sdk::{contracttype, Address, Env};

use crate::errors::Error;
use fm_math::compute_fee as fm_compute_fee;

/// Maximum platform fee that may ever be configured, in basis points (20%).
pub const MAX_FEE_BPS: u32 = 2_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfig {
    pub fee_bps: u32,
}

const FEE_KEY: &str = "fee_bps";

/// Read the stored platform fee in basis points. Defaults to 0 when unset.
pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&FEE_KEY)
        .unwrap_or(0u32)
}

/// Persist the platform fee in instance storage, enforcing the hard cap.
/// Emits `("creator_earnings", "fee_set")` with the old and new values.
pub fn set_fee_bps(env: &Env, fee_bps: u32) -> Result<(), Error> {
    if fee_bps > MAX_FEE_BPS {
        return Err(Error::InvalidFee);
    }

    let old_fee = get_fee_bps(env);
    env.storage().instance().set(&FEE_KEY, &fee_bps);

    env.events().publish(
        (
            soroban_sdk::symbol_short!("creator_earnings"),
            soroban_sdk::symbol_short!("fee_set"),
        ),
        (old_fee, fee_bps),
    );

    Ok(())
}

/// Split `amount` into (platform_fee, creator_share) using the stored fee.
pub fn split_with_stored_fee(env: &Env, amount: i128) -> (i128, i128) {
    let fee = fm_compute_fee(amount, get_fee_bps(env)).expect("fee calculation overflow");
    (fee, amount - fee)
}

/// Ensure the caller-supplied fee (if any) does not exceed the configured cap.
pub fn validate_fee_bps(fee_bps: u32) -> Result<(), Error> {
    if fee_bps > MAX_FEE_BPS {
        return Err(Error::InvalidFee);
    }
    Ok(())
}

/// Convenience helper used by admin entrypoints to authorise fee changes.
pub fn require_admin(env: &Env, admin: &Address) {
    admin.require_auth();
    let _ = env;
}
