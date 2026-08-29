# Carbon Offset Contract

Stores verifiable carbon offset records on-chain so farmers can display a carbon
neutrality certificate for a delivered order.

## Build & Deploy

```bash
cd contract/carbon-offset
cargo build --target wasm32-unknown-unknown --release
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/carbon_offset.wasm --network testnet
```

## Initialize

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- initialize \
  --admin <PLATFORM_PUBLIC_KEY>
```

## Environment Variables

Add to backend/.env:
```
SOROBAN_CARBON_OFFSET_CONTRACT_ID=<deployed_contract_id>
```

## Usage

The backend calls `record_offset(order_id, kg_co2, verifier)` after an order's delivery
is confirmed, using the estimate from `backend/src/utils/carbon.js`. Only the platform
admin address configured at `initialize` time can call `record_offset`. `get_offset` is
public and backs `GET /api/orders/:id/carbon`.
