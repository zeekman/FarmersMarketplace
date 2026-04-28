# Farmers Marketplace Reward Token (FRT)

SEP-0041 compliant Soroban fungible token for marketplace rewards.

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
