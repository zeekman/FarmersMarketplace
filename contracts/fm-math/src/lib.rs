//! Basis-point fee arithmetic for the FarmersMarketplace Soroban contracts.
//!
//! This crate is `no_std` and contains no Soroban SDK dependency — it is pure
//! integer arithmetic that can be linked into any contract in the workspace.
//!
//! # Rounding policy
//!
//! All results are **floor-rounded** (truncated toward zero), consistent with
//! Rust's built-in integer division.  This means:
//! - The computed fee is never larger than the true fractional value.
//! - The remainder (amount − fee) is never smaller than the true fractional value.
//! - `fee + remainder == amount` exactly, so no strops are stranded.
//!
//! # Overflow guard
//!
//! `compute_fee` uses `checked_mul` and returns `Err(MathError::Overflow)` when
//! the intermediate product `amount * bps` would overflow `i128`.  This can
//! only happen when `amount > i128::MAX / bps`, i.e. for amounts exceeding
//! roughly `i128::MAX / 10_000 ≈ 1.7 × 10^34` stroops.  Real XLM balances are
//! far below this threshold.
#![no_std]

/// The basis-point denominator: 10 000 bps == 100 %.
pub const BPS_DENOMINATOR: u32 = 10_000;

/// Errors returned by the fee math functions.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum MathError {
    /// `amount * bps` overflowed `i128`.
    Overflow,
}

/// Compute `floor(amount * bps / BPS_DENOMINATOR)`.
///
/// Returns `Err(MathError::Overflow)` when the intermediate product would
/// overflow `i128`.  For contract code that has already validated its inputs
/// against the Soroban ledger limits (amounts ≤ `i64::MAX` stroops for XLM,
/// fee rates ≤ 10 000 bps) this will never error in practice.
///
/// # Arguments
///
/// * `amount` — the base amount in the smallest token unit (e.g. stroops).
/// * `bps` — the fee or share expressed in basis points (0–10 000).
///
/// # Examples
///
/// ```
/// use fm_math::{compute_fee, BPS_DENOMINATOR};
/// assert_eq!(compute_fee(1_000_000, 250).unwrap(), 25_000);  // 2.5 %
/// assert_eq!(compute_fee(1_000_001, 250).unwrap(), 25_000);  // floored
/// assert_eq!(compute_fee(0, 500).unwrap(), 0);
/// ```
pub fn compute_fee(amount: i128, bps: u32) -> Result<i128, MathError> {
    amount
        .checked_mul(bps as i128)
        .ok_or(MathError::Overflow)
        .map(|product| product / BPS_DENOMINATOR as i128)
}

/// Split `amount` into `(fee, remainder)` using `bps` basis points.
///
/// Equivalent to `let fee = compute_fee(amount, bps)?; (fee, amount - fee)`.
/// Guarantees `fee + remainder == amount` with no stranded balance.
///
/// # Examples
///
/// ```
/// use fm_math::split;
/// let (fee, remainder) = split(1_000_000, 300).unwrap(); // 3 %
/// assert_eq!(fee, 30_000);
/// assert_eq!(remainder, 970_000);
/// assert_eq!(fee + remainder, 1_000_000);
/// ```
pub fn split(amount: i128, bps: u32) -> Result<(i128, i128), MathError> {
    let fee = compute_fee(amount, bps)?;
    Ok((fee, amount - fee))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn zero_bps_yields_zero_fee() {
        assert_eq!(compute_fee(1_000_000, 0).unwrap(), 0);
    }

    #[test]
    fn full_bps_yields_full_amount() {
        assert_eq!(compute_fee(1_000_000, BPS_DENOMINATOR).unwrap(), 1_000_000);
    }

    #[test]
    fn two_point_five_percent() {
        assert_eq!(compute_fee(1_000_000, 250).unwrap(), 25_000);
    }

    #[test]
    fn floor_rounding() {
        // 1 * 1 / 10_000 = 0.0001 → floor → 0
        assert_eq!(compute_fee(1, 1).unwrap(), 0);
        // 9_999 * 1 / 10_000 = 0.9999 → floor → 0
        assert_eq!(compute_fee(9_999, 1).unwrap(), 0);
        // 10_000 * 1 / 10_000 = 1 → floor → 1
        assert_eq!(compute_fee(10_000, 1).unwrap(), 1);
    }

    #[test]
    fn split_sums_to_amount() {
        let amount = 123_456_789_i128;
        let bps = 375_u32;
        let (fee, remainder) = split(amount, bps).unwrap();
        assert_eq!(fee + remainder, amount);
    }

    #[test]
    fn split_zero_bps() {
        let (fee, remainder) = split(1_000_000, 0).unwrap();
        assert_eq!(fee, 0);
        assert_eq!(remainder, 1_000_000);
    }

    #[test]
    fn split_full_bps() {
        let (fee, remainder) = split(1_000_000, BPS_DENOMINATOR).unwrap();
        assert_eq!(fee, 1_000_000);
        assert_eq!(remainder, 0);
    }

    #[test]
    fn overflow_detected() {
        // i128::MAX * 10_000 overflows i128
        assert_eq!(compute_fee(i128::MAX, BPS_DENOMINATOR), Err(MathError::Overflow));
    }

    #[test]
    fn safe_boundary_no_overflow() {
        // amount = i128::MAX / 10_000 is the highest safe value
        let safe = i128::MAX / BPS_DENOMINATOR as i128;
        assert!(compute_fee(safe, BPS_DENOMINATOR).is_ok());
    }

    #[test]
    fn zero_amount() {
        assert_eq!(compute_fee(0, 500).unwrap(), 0);
        let (fee, rem) = split(0, 500).unwrap();
        assert_eq!(fee, 0);
        assert_eq!(rem, 0);
    }
}

// ---------------------------------------------------------------------------
// Proptest suite
// ---------------------------------------------------------------------------

#[cfg(test)]
mod prop_tests {
    use super::*;
    use proptest::prelude::*;

    /// Generates amounts in the safe range: 0 ..= i128::MAX / BPS_DENOMINATOR.
    fn safe_amount() -> impl Strategy<Value = i128> {
        0_i128..=(i128::MAX / BPS_DENOMINATOR as i128)
    }

    /// Generates bps values in 0..=10_000.
    fn valid_bps() -> impl Strategy<Value = u32> {
        0_u32..=BPS_DENOMINATOR
    }

    proptest! {
        /// fee is always between 0 and amount (inclusive).
        #[test]
        fn prop_fee_bounds(amount in safe_amount(), bps in valid_bps()) {
            let fee = compute_fee(amount, bps).expect("should not overflow in safe range");
            prop_assert!(fee >= 0, "fee must be non-negative");
            prop_assert!(fee <= amount, "fee must not exceed amount");
        }

        /// fee + remainder == amount exactly (no stranded balance).
        #[test]
        fn prop_split_sums_to_amount(amount in safe_amount(), bps in valid_bps()) {
            let (fee, remainder) = split(amount, bps).expect("should not overflow in safe range");
            prop_assert_eq!(fee + remainder, amount, "fee + remainder must equal amount");
        }

        /// remainder is non-negative.
        #[test]
        fn prop_remainder_non_negative(amount in safe_amount(), bps in valid_bps()) {
            let (_, remainder) = split(amount, bps).expect("should not overflow in safe range");
            prop_assert!(remainder >= 0, "remainder must be non-negative");
        }

        /// fee is monotonically non-decreasing in bps for a fixed amount.
        #[test]
        fn prop_monotonic_in_bps(amount in safe_amount(), lo in 0_u32..=10_000_u32, hi in 0_u32..=10_000_u32) {
            let (lo_bps, hi_bps) = if lo <= hi { (lo, hi) } else { (hi, lo) };
            let fee_lo = compute_fee(amount, lo_bps).expect("no overflow");
            let fee_hi = compute_fee(amount, hi_bps).expect("no overflow");
            prop_assert!(fee_lo <= fee_hi, "fee must be non-decreasing as bps increases");
        }

        /// fee is monotonically non-decreasing in amount for a fixed bps > 0.
        #[test]
        fn prop_monotonic_in_amount(
            lo in 0_i128..=(i128::MAX / BPS_DENOMINATOR as i128 / 2),
            delta in 0_i128..=(i128::MAX / BPS_DENOMINATOR as i128 / 2),
            bps in 1_u32..=BPS_DENOMINATOR,
        ) {
            let hi = lo + delta;
            let fee_lo = compute_fee(lo, bps).expect("no overflow");
            let fee_hi = compute_fee(hi, bps).expect("no overflow");
            prop_assert!(fee_lo <= fee_hi, "fee must be non-decreasing as amount increases");
        }

        /// No overflow for any amount in 0..=i128::MAX/BPS_DENOMINATOR with any valid bps.
        #[test]
        fn prop_no_overflow_in_safe_range(amount in safe_amount(), bps in valid_bps()) {
            prop_assert!(
                compute_fee(amount, bps).is_ok(),
                "must not overflow for amount <= i128::MAX / BPS_DENOMINATOR"
            );
        }

        /// split bps=0 always returns (0, amount).
        #[test]
        fn prop_zero_bps(amount in safe_amount()) {
            let (fee, remainder) = split(amount, 0).unwrap();
            prop_assert_eq!(fee, 0);
            prop_assert_eq!(remainder, amount);
        }

        /// split bps=10_000 always returns (amount, 0).
        #[test]
        fn prop_full_bps(amount in safe_amount()) {
            let (fee, remainder) = split(amount, BPS_DENOMINATOR).unwrap();
            prop_assert_eq!(fee, amount);
            prop_assert_eq!(remainder, 0);
        }
    }
}
