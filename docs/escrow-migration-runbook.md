# Escrow Migration Runbook

This runbook covers the v1 `EscrowRecord` to v2 `Escrow` storage migration in
`contracts/escrow`.

## Scope

The migration is for persistent `DataKey::Escrow(order_id)` entries that still
use the v1 shape:

- v1 records contain `released`.
- v2 records contain `status` and `token`.
- Missing IDs and already-v2 records are skipped.

## Preflight

1. Build and test the contract locally:

   ```bash
   cd contracts
   cargo test -p soroban-escrow --lib
   ```

2. Collect the order IDs to check and split them into batches of at most 20.
   Preview and migrate each batch separately. Keep a manifest of the batch
   boundaries and results so the same IDs are used in each step.

3. Run the read-only preview first:

   ```bash
   stellar contract invoke \
     --id "$ESCROW_CONTRACT_ID" \
     --source-account "$ADMIN_ACCOUNT" \
     --network "$NETWORK" \
     --send=no \
     -- \
     migrate_preview \
     --order_ids "$ORDER_IDS"
   ```

4. Confirm every tuple before proceeding:

   - `(order_id, true)` means the entry is a legacy v1 record and will be
     rewritten by `migrate`.
   - `(order_id, false)` means the entry is missing or already v2 and will not
     be rewritten.

The contract enforces the 20-ID limit on both `migrate_preview` and `migrate`.
Use exactly the same IDs in the preview and write call for each batch.

## Execute

Only run the write migration after the preview matches the intended legacy IDs.
The `fallback_token` must be the token address that v1 escrows used before the
per-escrow token field existed.

```bash
stellar contract invoke \
  --id "$ESCROW_CONTRACT_ID" \
  --source-account "$ADMIN_ACCOUNT" \
  --network "$NETWORK" \
  -- \
  migrate \
  --order_ids "$ORDER_IDS" \
  --fallback_token "$FALLBACK_TOKEN_ADDRESS"
```

The function is admin-only and idempotent. It skips missing and already-v2
records, rewrites only v1 records, extends TTL, and emits
`("escrow", "migrated", order_id)`. A successful call returns the number of
records rewritten in that batch. If a batch fails, its transaction makes no
partial changes; resolve the cause and retry the same batch. Previously
completed batches remain migrated, and replaying one is safe.

## Verify

Run the preview again for every batch after migration:

```bash
stellar contract invoke \
  --id "$ESCROW_CONTRACT_ID" \
  --source-account "$ADMIN_ACCOUNT" \
  --network "$NETWORK" \
  --send=no \
  -- \
  migrate_preview \
  --order_ids "$ORDER_IDS"
```

Expected result: every migrated order now returns `(order_id, false)`.

For spot checks, query the escrow and verify that `token`, `status`,
`auto_release_unix`, `dispute_opened_at`, and `release_after_unix` are present.

## Legacy deployments that never called `initialize()` (#1301)

Older deployments could be used without `initialize()`: `release` fell back to a
`platform_fee_bps` argument supplied by the caller, so a buyer could pass `0` and the
platform collected nothing. That fallback (and the argument) has been removed from
`release` and `release_to_stream`. The platform fee is read only from storage.

After upgrading such a deployment to this version, **every settlement path**
(`release`, `release_to_stream`, `batch_release` items, `auto_release`,
`multisig_release`, `resolve_dispute`) fails with `NotInitialized` (error `28`) until the
fee is stored. No funds move and no escrow changes state while it is unset. To bring a
legacy deployment back into service:

1. Upgrade the contract WASM (`upgrade`).
2. Immediately call `initialize` once, signed by the account that should become admin:

   ```bash
   stellar contract invoke \
     --id "$ESCROW_CONTRACT_ID" \
     --source-account "$ADMIN_ACCOUNT" \
     --network "$NETWORK" \
     -- \
     initialize \
     --admin "$ADMIN_ADDRESS" \
     --fee_bps "$FEE_BPS" \
     --fee_destination "$FEE_DESTINATION_ADDRESS"
   ```

   `fee_bps` must be `<= 500` (5%, ADR 0002). A second call returns `AlreadyInitialized`.
3. Verify with a small escrow, or by checking that `release` on an existing active escrow no
   longer returns `NotInitialized`.

> **Operational risk.** On a legacy deployment `initialize` has no pre-existing admin to
> authenticate against, so whoever calls it first becomes admin. Submit it in the same
> maintenance window as the upgrade (ideally the very next transaction) and confirm the
> stored admin afterwards. If the deployment cannot be protected from a front-run, deploy a
> fresh instance and `initialize` it instead of upgrading in place.

Callers must also use the new signatures: `release(order_id, caller)` (no fee argument),
`release_to_stream(order_id, stream_rate_per_second, stream_end_time)` and
`resolve_dispute(order_id, buyer_bps)`. `contracts/escrow/cli.sh`, the backend
`invokeEscrowContract` and the testnet deploy workflow have been updated accordingly.

## Persistent TTL and restore procedures (#1527)

Escrow entries (`DataKey::Escrow(order_id)` and `DataKey::Token(order_id)`) are
persistent storage. Soroban archives persistent entries once their TTL lapses;
archived entries are not lost, but every settlement call fails until the entry is
restored. The old fixed TTL window (`TTL_MIN = 100_000`, `TTL_MAX = 200_000`
ledgers, roughly 5.8–11.6 days at ~5 s per ledger) was shorter than legitimate
escrow lifetimes (pre-orders with a far-future `release_after_unix`, long
`timeout_unix`, disputes, or a large `auto_release_days`).

### Deposit-time TTL

On `deposit`, the contract now extends the escrow and token entries to cover
`max(timeout_unix, release_after_unix, auto_release_unix) - now` plus a safety
margin, converted to ledgers and capped at the network maximum TTL. This keeps
an escrow live through its own deadline without manual intervention.

### `bump(order_id)`

`bump(order_id)` is a public entry point callable by anyone. It re-extends the
`Escrow(order_id)` and `Token(order_id)` entries to the same computed horizon and
costs only the caller's transaction fees. Use it to keep an escrow alive when its
configured deadlines are near or when the keeper job has not run.

```bash
stellar contract invoke \
  --id "$ESCROW_CONTRACT_ID" \
  --source-account "$OPERATOR_ACCOUNT" \
  --network "$NETWORK" \
  -- \
  bump \
  --order_id "$ORDER_ID"
```

### Keeper job

The backend runs a keeper job that periodically lists active escrows and bumps
any whose remaining TTL is under 3 days. Remaining TTL is read from RPC
`getLedgerEntries` via the `liveUntilLedgerSeq` field of each entry; the keeper
converts the current ledger sequence to a remaining-time estimate and calls
`bump(order_id)` for entries below the threshold.

### Restoring an archived escrow

If an entry has already been archived (keeper outage, long inactivity), restore
it before any settlement call:

1. Identify the archived keys. The escrow key is the contract's persistent
   `DataKey::Escrow(order_id)` ledger entry and the token key is
   `DataKey::Token(order_id)`.
2. Restore both entries with `stellar contract restore` (or the Soroban RPC
   `restoreFootprint` operation) using the contract ID and the ledger keys above.
   The restoring account pays the rent for the restored TTL.
3. Immediately call `bump(order_id)` to extend the entries to the escrow's full
   horizon so they do not lapse again.
4. Verify with `get_escrow(order_id)` that the record is present and its `status`
   is as expected before retrying settlement.

> **Note.** A `get_escrow` returning `NotFound` for an order that should be active
> may indicate an archived entry rather than a settled escrow. Check
> `getLedgerEntries` for the escrow key before treating the order as settled.
