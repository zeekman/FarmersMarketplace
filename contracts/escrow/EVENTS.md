# Escrow Contract Events

This document is the canonical reference for every event emitted by the escrow
contract. Each state transition emits **exactly one** event. All topics use
`symbol_short!` (i.e. `Symbol`) values, and `order_id` always appears in the
same position for a given event family so that indexers and off-chain
subscribers can filter deterministically.

> ADR 0002: tuple shapes are documented next to the emitting function in
> `contracts/escrow/src/lib.rs` and mirrored here.

## Conventions

- Topics are `Symbol` values created with `symbol_short!`.
- `order_id` is always the **third topic** for order-scoped events
  (`(escrow, <action>, order_id)`), and the **first data field** for events
  that carry it in the payload.
- Amounts are `i128` in the token's smallest unit.
- A subscriber filtering on `(escrow, release)` receives every release exactly
  once; there is no second string-topic variant.

## Event catalogue

| Entrypoint | Topics | Data |
| --- | --- | --- |
| `deposit` | `(escrow, deposit, order_id)` | `(farmer, amount)` |
| `release` | `(escrow, release, order_id)` | `(farmer_amount, fee_amount)` |
| `release_to_stream` | `(escrow, release, order_id)` | `(farmer_amount, fee_amount)` |
| `refund` | `(escrow, refund, order_id)` | `(farmer_amount, fee_amount)` |
| `dispute` | `(escrow, dispute, order_id)` | `(initiator,)` |
| `resolve` | `(escrow, resolve, order_id)` | `(farmer_amount, fee_amount)` |
| `auto_release` | `(escrow, auto_release, order_id)` | `(farmer_amount, fee_amount)` |
| `stream_create` | `(escrow, stream_create, order_id)` | `(farmer, rate, duration)` |
| `stream_withdraw` | `(escrow, stream_withdraw, order_id)` | `(farmer_amount,)` |
| `stream_cancel` | `(escrow, stream_cancel, order_id)` | `(farmer_amount, fee_amount)` |
| `admin_proposed` | `(escrow, admin_proposed)` | `(proposed,)` |
| `admin_accepted` | `(escrow, admin_accepted)` | `(admin,)` |
| `reward_token_set` | `(escrow, reward_token_set)` | `(token,)` |

## Migration notes

- The legacy string-topic variants (`("escrow", "release", order_id)` and the
  symbol/string mix for refunds) have been removed. Consumers that previously
  matched on string topics must switch to the `symbol_short!` topics above.
- `backend/src/jobs/contractMonitor.js` parses the canonical shapes listed in
  this table.
