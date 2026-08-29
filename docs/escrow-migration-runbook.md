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
