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
    /// payer and farmer addresses must be different.
    InvalidParties = 6,
}
