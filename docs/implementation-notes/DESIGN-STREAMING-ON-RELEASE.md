# Design Decision: Payment Streaming on Escrow Release (#973)

## Status
**APPROVED FOR IMPLEMENTATION**

## Problem Statement

The escrow contract supports two independent features:
1. **Escrow release**: Immediate lump-sum payout when buyer releases escrowed funds
2. **Payment streams**: Continuous token flow from sender to recipient at a configurable rate

Currently, when `release()` is called on an escrow, funds transfer directly to the farmer as a single atomic transfer. For subscription-style use cases (recurring harvest boxes, recurring services), a buyer may want escrowed funds to be paid out continuously over time rather than as a lump sum—especially if the farmer provides ongoing services.

The backend's `subscriptions.js` already models recurring payments off-chain. An on-chain equivalent would provide:
- Transparent audit trail on Stellar ledger
- Automated streaming without backend intervention
- Optionality at the transaction level (buyer can choose per-order)

## Design

### Option 1: Add `release_to_stream()` Function (CHOSEN)

A new public function alongside `release()`:

```rust
pub fn release_to_stream(
    env: Env,
    order_id: u64,
    platform_fee_bps: u32,
    stream_rate_per_second: i128,  // stroops/sec
    stream_end_time: u64,            // ledger timestamp
) -> Result<(), EscrowError>
```

**Behavior:**
1. Validate order exists, is Active, and caller is buyer (identical to `release()`)
2. Deduct platform fee (identical to `release()`)
3. Deduct cooperative royalty if applicable (identical to `release()`)
4. Create a new `PaymentStream` in the stream.rs module with:
   - sender: this contract
   - recipient: escrow.farmer
   - rate_per_second: caller-provided rate
   - deposit: farmer_amount (after fee/royalty)
   - end_time: caller-provided timestamp
5. Mark escrow as Released (identical to `release()`)
6. Emit release event (identical to `release()`)
7. Do NOT call reward token mint (streamed payouts complicate per-second reward timing)

**Why this approach:**
- Mirrors the contract's existing cross-contract call pattern (`try_invoke_contract` in current `release()`)
- Reuses stream.rs's proven checkpoint/accrual logic
- Caller controls timing explicitly (rate + end_time), reducing trust on contract upgrades
- Supports immediate adoption: no off-chain coordination required

### Option 2: Parameter on `release()` (Not Chosen)

Add `stream_params: Option<StreamParams>` to the existing `release()` function.

**Why rejected:**
- Adds parameter explosion to an already complex function
- Mixes two distinct payoff models in one code path
- Harder to test and reason about

### Option 3: Defer to Future Batch (Not Chosen)

Document the design and ship only the spec.

**Why rejected:**
- Acceptance criteria expect a working implementation
- Stream infrastructure already exists; this is plumbing work
- Backend subscriptions route already models this; parity is valuable

## Implementation Scope

### What's Included
- `release_to_stream()` function in `EscrowContract`
- Integration tests using `soroban.js` test helpers (see #975)
- Docstring explaining streaming terms and reward behavior

### What's Excluded
- Reward token minting for streamed payouts (timing ambiguity)
- Stream cancellation from farmer side (escrow release is irreversible)
- Dynamic rate adjustment post-release (farmers may only decrease rates via stream API)

## Testing Strategy

### Unit Tests
- Stream creation succeeds with valid rate and end_time
- Cooperative royalty correctly deducted before streaming
- Farmer can claim accrued streamed amounts mid-stream
- Dispute status blocks stream creation (identical to release)

### Integration Tests
- Deploy contracts, create escrow, release to stream, verify PaymentStream record exists
- Advance ledger time, verify accrued amount calculation
- Compare lump-sum vs. streamed payouts for identical inputs

## Backwards Compatibility

**No impact.** This is a new entry point; existing `release()` remains unchanged.

## Notes for Reviewers

1. **Timestamp validation**: Recommend that `stream_end_time` must be > `env.ledger().timestamp()` to prevent instant-end streams. This validation should happen before any state mutation.

2. **Reward tokens**: Skipped because calculating per-second rewards would require on-contract reward logic (vs. off-contract tracking). Future enhancement can mint lump-sum rewards at stream end.

3. **Fee deduction order**: Platform fee is deducted first (fixed %), then cooperative royalty (% of remainder), matching existing `release()`. This order is important for fair cooperative accounting.

---

**Closes #973** (pending implementation)
