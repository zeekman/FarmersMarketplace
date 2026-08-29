use soroban_sdk::contracterror;

/// Typed error codes returned by the escrow contract.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum EscrowError {
    /// An escrow already exists for this order_id.
    AlreadyExists = 1,
    /// No escrow record found for this order_id.
    NotFound = 2,
    /// Caller is not authorised to perform this action.
    Unauthorized = 3,
    /// The escrow has not yet timed out.
    NotTimedOut = 4,
    /// The escrow has already been settled (released or refunded).
    AlreadySettled = 5,
    /// buyer and farmer addresses must be different.
    InvalidParties = 6,
    /// Contract has already been initialized. (#837)
    AlreadyInitialized = 7,
    /// Snapshot not found or product hash mismatch. (#703)
    SnapshotNotFound = 8,
    /// Deposit/refund amount must be greater than zero and within bounds. (#838, #676)
    InvalidAmount = 9,
    /// Contract is currently paused; all state-changing calls are rejected. (#854)
    ContractPaused = 10,
    /// fee_bps exceeds MAX_FEE_BPS (500 = 5%). (#855)
    InvalidFeeRate = 11,
}
