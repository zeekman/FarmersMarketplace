use soroban_sdk::{contracttype, Address};

/// Lifecycle states of an escrow.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    Active,
    WorkSubmitted,
    Approved,
    Cancelled,
    Expired,
}

/// Full escrow record stored on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowData {
    /// The party funding the escrow.
    pub payer: Address,
    /// The party doing the work.
    pub freelancer: Address,
    /// Token used for payment (stored at create time).
    pub token: Address,
    /// Amount locked in escrow.
    pub amount: i128,
    /// Current lifecycle state.
    pub status: EscrowStatus,
    /// Optional deadline (ledger timestamp). After this, payer can call expire().
    pub deadline: Option<u64>,
}
