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

2. Collect the order IDs to check. Keep batches small enough to review the dry
   run output before applying a write transaction.

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
`("escrow", "migrated", order_id)`.

## Verify

Run the preview again after migration:

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
`multisig_release`, `resolve_dispute`) fails with `NotInitialized` (error `23`) until the
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

   `fee_bps` must be `<= 1000` (10%). A second call returns `AlreadyInitialized`.
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
