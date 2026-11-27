# Farmers Marketplace Reward Token (FRT)

SEP-0041 compliant Soroban fungible token for marketplace rewards.

This crate belongs to the legacy `contract/` layout. The repository also has a
newer `contracts/` workspace; see
[`docs/adr/0002-contract-architecture.md`](../../docs/adr/0002-contract-architecture.md)
for the maintained boundary and legacy removal plan.

## Build & Deploy

```bash
cd contract/reward-token
cargo build --target wasm32-unknown-unknown --release
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/reward_token.wasm --network testnet
```

## Initialize

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- initialize \
  --admin <ADMIN_PUBLIC_KEY> \
  --decimal 7 \
  --name "Farmers Reward Token" \
  --symbol "FRT"
```

## Environment Variables

Add to backend/.env:
```
REWARD_TOKEN_CONTRACT_ID=<deployed_contract_id>
REWARD_TOKEN_ADMIN_SECRET=<admin_secret_key>
```

## Usage

Tokens are automatically minted to buyers after successful purchases (1 FRT per 1 XLM spent).

Balance entries refresh their persistent-storage TTL whenever a balance changes,
so active balances are not archived simply because they were written without a
TTL bump. Balances that were already archived before this behavior was deployed
must be restored through Soroban's archived-entry restoration flow before they
can be read or changed.

Redemptions are tracked per buyer and order. A buyer can redeem once for an
order, and an admin refund reissue must restore the exact redeemed amount once;
the on-chain redemption record is kept alive for roughly 289 days.

`mint_for_order` is authorized by the configured minter and follows the same
supply-cap and vesting path as `mint`. The transfer fee must be below 100%,
and a nonzero maximum supply cannot be lowered below current total supply.
