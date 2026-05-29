use soroban_sdk::contracterror;

/// Typed error codes returned by the escrow contract.
/// Callers can match on these instead of parsing string messages.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum EscrowError {
    /// An escrow already exists for this contract instance.
    AlreadyExists = 1,
    /// The escrow is not in the Active state for this operation.
    NotActive = 2,
    /// Freelancer has not submitted work yet.
    WorkNotSubmitted = 3,
    /// Amount must be greater than zero.
    InvalidAmount = 4,
    /// Deadline has not passed yet; cannot expire.
    DeadlineNotReached = 5,
    /// No deadline was set on this escrow.
    NoDeadline = 6,
}
