# Contracts — money flow

Two payout paths exist. They are not interchangeable and currently do not compose.

## 1. Direct transfer (escrow `settle`) — in use

`escrow::release` / `release_to_stream` settle an order in one transaction:

- `fee_amount` → fee destination (platform), transferred immediately.
- `royalty_amount` → cooperative (when the escrow has cooperative accounting), transferred immediately.
- `farmer_amount` → farmer, transferred immediately (or booked as a payment stream's deposit for `release_to_stream`).
- A best-effort reward mint follows (reward-token, minter = escrow).

Use this path for every ordinary sale. The farmer holds tokens in their own wallet with no claim step.

## 2. Earnings ledger (creator-earnings `credit` + `claim`) — not yet wired to escrow

`creator-earnings::credit(creator, amount, fee_bps)` splits `amount` into:

- `farmer_amount = amount - fee_amount` → added to the creator's claimable `balance` and to `lifetime_earned`.
- `fee_amount = amount * fee_bps / 10_000` → added to `platform_balance()`.

The creator later calls `claim(creator, token)`, which zeroes the claimable balance and transfers it out. `lifetime_earned` is never decremented by `claim`.

Intended use: pull-based payouts where the value is credited now and collected later, e.g. batched credits (`batch_credit`, max 20 entries) or creators without a wallet at settlement time.

Current state: **escrow does not call `credit`.** `deploy.sh` sets escrow as creator-earnings' `AuthorizedCaller` (CT-16), but nothing in escrow invokes it, so the ledger path is only reachable by the authorized caller directly. Settling an order through escrow never produces a ledger balance.

## Rules that hold on either path

- Fee is basis points, `0..=10_000`; `InvalidFeeBps` otherwise.
- `farmer + fee == gross` for every credit (no value created or destroyed).
- A creator cannot be the platform address (`CreatorIsPlatform`), because both share the balance key space.
- `credit` and `claim` are rejected while paused (`Paused`).
- `claim` on a zero balance returns `ZeroBalance`.

## Open decisions before wiring escrow → `credit`

- Token custody: escrow must transfer the gross amount to creator-earnings before calling `credit`, or the ledger has no backing funds. Decide whether this replaces or sits beside the direct transfer per order.
- Fee source: escrow's fee and creator-earnings' `fee_bps` must not both be charged on the same order.
- Integration test: deploy token, escrow, creator-earnings and reward-token, wire as `deploy.sh` does, then deposit → release → credit → claim, asserting buyer, farmer, platform and cooperative balances and total conservation.
