# 🌿 Farmers Marketplace

[![CI](https://github.com/techisigu/FarmersMarketplace/workflows/CI/badge.svg)](https://github.com/techisigu/FarmersMarketplace/actions)

A minimal MVP marketplace where farmers list products and buyers pay using the **Stellar Network (XLM)**.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: SQLite (local dev, default) / PostgreSQL (production)
- Payments: Stellar Testnet (XLM)

## Project Structure

```
FarmersMarketplace/
├── backend/
│   ├── src/
│   │   ├── index.js          # Express app entry
│   │   ├── stellar.js        # Stellar SDK helpers
│   │   ├── middleware/auth.js
│   │   ├── db/schema.js      # SQLite schema + connection
│   │   └── routes/
│   │       ├── auth.js       # register, login
│   │       ├── products.js   # CRUD listings
│   │       ├── orders.js     # place order + pay
│   │       └── wallet.js     # balance, transactions, fund
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── api/client.js     # API wrapper
    │   ├── context/AuthContext.jsx
    │   ├── components/Navbar.jsx
    │   └── pages/
    │       ├── Auth.jsx      # Login + Register
    │       ├── Dashboard.jsx # Farmer: add/view products
    │       ├── Marketplace.jsx # Buyer: browse
    │       ├── ProductDetail.jsx # Buy flow
    │       └── Wallet.jsx    # Balance + transactions
    └── package.json
```

## Quick Start

### 1. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Runs on http://localhost:4000

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on http://localhost:3000

## Payment Flow

1. Register as a **buyer** and a **farmer** (two separate accounts)
2. Go to **Wallet** → click "Fund with Testnet XLM" (uses Stellar Friendbot, free testnet tokens)
3. As a farmer, go to **Dashboard** and list a product priced in XLM
4. As a buyer, browse the **Marketplace**, open a product, set quantity, click **Buy Now**
5. The backend signs and submits a real Stellar transaction on testnet
6. View the transaction hash in **Wallet → Transaction History** or on [stellar.expert](https://stellar.expert/explorer/testnet)

## API Endpoints

Interactive API documentation is available at **[http://localhost:4000/api/docs](http://localhost:4000/api/docs)** when the backend is running.

| Method | Path                                     | Auth   | Description                                                        |
| ------ | ---------------------------------------- | ------ | ------------------------------------------------------------------ |
| POST   | /api/auth/register                       | —      | Register user                                                      |
| POST   | /api/auth/login                          | —      | Login                                                              |
| GET    | /api/products                            | —      | Browse all products                                                |
| GET    | /api/products/:id                        | —      | Product detail                                                     |
| POST   | /api/products                            | farmer | Create listing                                                     |
| GET    | /api/products/mine/list                  | farmer | My listings                                                        |
| DELETE | /api/products/:id                        | farmer | Remove listing                                                     |
| POST   | /api/orders                              | buyer  | Place + pay order                                                  |
| GET    | /api/orders                              | buyer  | Order history                                                      |
| GET    | /api/orders/sales                        | farmer | Incoming sales                                                     |
| GET    | /api/wallet                              | auth   | Balance                                                            |
| GET    | /api/wallet/transactions                 | auth   | TX history                                                         |
| POST   | /api/wallet/fund                         | auth   | Fund via Friendbot (testnet)                                       |
| GET    | /api/contracts/:contractId/state?prefix= | auth   | View Soroban contract storage entries (JSON: key, val, durability) |

## Database Migrations

Schema changes are managed through versioned SQL migration files in `backend/migrations/`.

### Running migrations

```bash
cd backend
npm run migrate           # apply all pending migrations
npm run migrate:rollback  # revert the last applied migration
```

Migrations run automatically on app startup — no manual step needed for development.

### How it works

- Migration files: `backend/migrations/NNN_description.sql`
- Rollback files:  `backend/migrations/NNN_description.undo.sql` (optional)
- Applied migrations are tracked in a `migrations` table in the database
- Running `migrate` twice is safe — already-applied migrations are skipped

### Creating a new migration

```bash
# Up migration
echo "ALTER TABLE products ADD COLUMN featured INTEGER DEFAULT 0;" \
  > backend/migrations/002_add_featured.sql

# Rollback (optional)
echo "ALTER TABLE products DROP COLUMN IF EXISTS featured;" \
  > backend/migrations/002_add_featured.undo.sql

npm run migrate
```

## Database Backup and Restore

The application includes automated database backup functionality to protect against data loss.

### Manual Backup

Create a timestamped backup of the database:

```bash
cd backend
npm run backup
```

This creates a backup file in `backend/backups/` with format `market-YYYY-MM-DD.db`.

### Manual Restore

Restore the database from a backup file:

```bash
cd backend
npm run restore -- backups/market-2024-01-01.db
```

**Important**: Before restoring, the current database is automatically backed up to `market.db.backup`.

### Automated Daily Backups

- Backups run automatically every day at midnight UTC
- Only the last 7 backups are retained (older ones are automatically deleted)
- Backup status and errors are logged using the structured logging system

### Backup Location

- Backup files are stored in: `backend/backups/`
- File naming convention: `market-YYYY-MM-DD.db`
- Maximum retention: 7 days

### Recovery Procedures

1. **Quick Restore**: Use `npm run restore` with the desired backup file
2. **Emergency Recovery**: Copy `market.db.backup` (created before restore) back to `market.db`
3. **Complete Reset**: Delete `market.db` and restart the application (fresh schema)

## PostgreSQL Setup

The backend supports both SQLite (local dev) and PostgreSQL (production), controlled by the `DATABASE_URL` environment variable.

### Local development (SQLite — default)

No extra setup needed. SQLite is used automatically when `DATABASE_URL` is not set.

### Production (PostgreSQL)

1. Add `DATABASE_URL` to your `.env`:
   ```
   DATABASE_URL=postgresql://user:password@localhost:5432/farmersmarketplace
   ```
2. The schema is created automatically on first start.

### Docker Compose (PostgreSQL + backend + frontend)

```bash
cp backend/.env.example backend/.env
# Edit backend/.env — set JWT_SECRET etc.
docker compose up
```

This starts:
- `postgres` — PostgreSQL 16 on port 5432
- `backend`  — Express API on port 4000 (connected to postgres)
- `frontend` — React app on port 3000

### Migrate existing SQLite data to PostgreSQL

```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname \
  node backend/scripts/migrate-sqlite-to-pg.js
```

## Rate Limiting

Per-user and per-IP rate limits (`backend/src/middleware/rateLimitPerUser.js`) use Redis when `REDIS_URL` is set, and fall back to an in-memory Map otherwise.

The in-memory fallback is fine for local dev and single-process deployments, but it is **not suitable for long-running, high-cardinality production traffic** — set `REDIS_URL` for those deployments so limiter state is bounded and shared across processes.

## Soroban Contract Layout

The repository currently maintains two Soroban contract layouts. They are
related, but they are not the same deployment surface.

| Path | Role | Notes |
|---|---|---|
| `contract/` | Legacy escrow crate | Used by backend contract integration tests, `contract/test-futurenet.sh`, `contract/cli.sh`, and the legacy WASM profile. |
| `contract/reward-token/` | Legacy reward token crate | Paired with the legacy integration surface and built separately from `contract/`. |
| `contracts/escrow/` | Workspace escrow crate | Current Rust workspace escrow implementation for newer contract hardening work. |
| `contracts/creator-earnings/` | Workspace creator earnings crate | Tracks creator balances and fee splits in the `contracts/` workspace. |

Shared contract conventions and the decision to maintain both layouts for now
are recorded in [ADR 0001](docs/adr/0001-soroban-contract-boundaries.md).

### Workspace contract tests

Run the current workspace contract tests from `contracts/`:

```bash
cd contracts
cargo test -p soroban-escrow --lib
cargo test -p creator-earnings --features testutils
cargo build -p soroban-escrow --target wasm32-unknown-unknown --release
cargo build -p creator-earnings --target wasm32-unknown-unknown --release
```

### Legacy contract integration testing

Test the legacy `contract/` escrow against a local Stellar node using the
backend test harness.

### Start the local node

```bash
docker-compose -f docker-compose.test.yml up -d
```

This starts a `stellar/quickstart` node on port 8000 with Soroban RPC enabled.

### Run contract tests

```bash
cd backend
npm run test:contracts
```

### Test helpers

`backend/src/__tests__/helpers/soroban.js` exposes:

- `fundAccount(publicKey)` — fund via local Friendbot
- `deployContract(wasmBuffer, keypair)` — upload WASM and create contract instance
- `invokeContract(contractId, method, args, keypair)` — call a contract function

### Environment variables (optional)

| Variable | Default | Description |
|---|---|---|
| `TEST_HORIZON_URL` | `http://localhost:8000` | Local Horizon endpoint |
| `TEST_SOROBAN_RPC_URL` | `http://localhost:8000/soroban/rpc` | Local Soroban RPC |
| `TEST_NETWORK_PASSPHRASE` | `Standalone Network ; February 2017` | Local network passphrase |
| `SKIP_CONTRACT_TESTS` | `false` | Set to `true` to skip contract tests in CI without Docker |

### SKIP_CONTRACT_TESTS

Contract tests require a running local Stellar node (Docker). In CI environments where Docker is not available, set `SKIP_CONTRACT_TESTS=true` to skip the suite without failing the build:

```bash
SKIP_CONTRACT_TESTS=true npm run test:contracts
```

When skipped in CI, a warning is printed to the log so the omission is visible.

A dedicated **nightly CI job** (`contract-tests-nightly` in `.github/workflows/ci.yml`) runs the full contract test suite on a schedule with Docker available, ensuring these tests are not silently broken.

### Workspace contract tests

The newer Soroban workspace lives in `contracts/` and is covered by the
`soroban-contracts` CI job:

```bash
cd contracts
cargo test -p soroban-escrow --lib
cargo test -p creator-earnings --features testutils
bash wasm-profile.sh
```

The CI job uploads `contracts-wasm-size-profile.txt` so release WASM size
history is visible on every push and pull request.

### Escrow migration runbook

Before running an escrow schema migration, dry-run the target order IDs with the
read-only `migrate_preview(order_ids)` contract function. The operator runbook
is in [`docs/escrow-migration-runbook.md`](docs/escrow-migration-runbook.md).

### Escrow batch resource budget

`contracts/escrow/src/lib.rs` keeps `MAX_BATCH_RELEASE` at `20`. The unit test
`max_batch_deposit_and_release_resource_budget` exercises exactly 20 entries and
fails if the Soroban SDK budget grows beyond the CI ceilings below.

| Function | Entries | Observed CPU | CPU ceiling | Observed memory | Memory ceiling |
|---|---:|---:|---:|---:|---:|
| `batch_deposit` | 20 | 3,206,922 | 8,000,000 | 780,020 | 2,000,000 |
| `batch_release` | 20 | 5,529,240 | 12,000,000 | 1,189,528 | 3,000,000 |

Observed values were captured with Soroban SDK `22.0.0` on 2026-07-24. Exact
resource-fee stroops are network-config dependent, so simulate against the
target network before raising `MAX_BATCH_RELEASE` or adding more release-side
transfers:

```bash
stellar contract invoke \
  --id "$ESCROW_CONTRACT_ID" \
  --source-account "$SOURCE_ACCOUNT" \
  --network "$NETWORK" \
  --send=no \
  --cost \
  -- \
  batch_release \
  --order_ids "$ORDER_IDS"
```

For the complex `batch_deposit` tuple vector, use the generated CLI help for the
deployed contract and run the same `--send=no --cost` simulation with 20 entries.

## Futurenet E2E Integration Test (#861)

The script `contract/test-futurenet.sh` runs a full end-to-end test of the
legacy `contract/` escrow on **Stellar Futurenet** using real XLM transfers.

### What it tests

| Test | Flow | Assertion |
|------|------|-----------|
| 1 — Happy path | deposit → release | Farmer balance increases by `deposit − platform_fee` |
| 2 — Dispute refund | deposit → open_dispute → resolve(buyer) | Buyer balance recovers the deposited amount |
| 3 — Dispute to farmer | deposit → open_dispute → resolve(farmer) | Farmer balance increases |
| 4 — Cooperative multisig | set_coop → deposit(royalty) → release | Cooperative treasury receives royalty amount |
| 5 — Batch release | deposit(×2) → batch_release | Both escrows Released in single transaction |

### Prerequisites

- [`stellar` CLI](https://developers.stellar.org/docs/tools/stellar-cli) installed and in `$PATH`
- `curl` and `jq`
- Compiled WASM (see build step below)

### Run the test

```bash
# 1. Build the contract WASM
cd contract
cargo build --target wasm32-unknown-unknown --release

# 2. Run the Futurenet E2E test (takes ~2–3 minutes)
./contract/test-futurenet.sh
```

The script:
1. Generates ephemeral Stellar keypairs (admin, buyer, farmer, arbitrator, fee-destination, cooperative-member, cooperative-treasury)
2. Funds each via [Futurenet Friendbot](https://friendbot-futurenet.stellar.org)
3. Deploys the contract to Futurenet and calls `initialize`
4. Runs the five test flows above
5. Asserts balance changes match expected amounts (±100–1000 stroops tolerance for network fees)
6. Exits **non-zero** on any failed assertion
7. Cleans up ephemeral keys on exit

### Optional environment overrides

| Variable | Default | Description |
|---|---|---|
| `NETWORK` | `futurenet` | Stellar network alias |
| `WASM_PATH` | auto-detected | Path to compiled `.wasm` |
| `FEE_BPS` | `250` | Platform fee in basis points (2.5%) |
| `DEPOSIT_XLM` | `1` | Deposit amount in XLM |
| `TIMEOUT_SECS` | `7200` | Escrow timeout offset (seconds from now) |
| `SKIP_BUILD` | `0` | Set to `1` to skip `cargo build` |

### Example with overrides

```bash
DEPOSIT_XLM=2 FEE_BPS=500 SKIP_BUILD=1 ./contract/test-futurenet.sh
```

---

## Legacy Soroban Escrow Contract (`contract/`)

The `contract/` directory contains the legacy Soroban escrow contract that
provides on-chain escrow for marketplace orders. Do not treat it as
interchangeable with the workspace escrow at `contracts/escrow/`; see
[ADR 0001](docs/adr/0001-soroban-contract-boundaries.md) for the boundary.

### Functions

| Function | Description |
|----------|-------------|
| `deposit(order_id, buyer, farmer, amount, timeout_unix)` | Lock funds in escrow |
| `release(order_id)` | Buyer releases funds to farmer |
| `refund(order_id)` | Anyone refunds buyer after timeout |
| `get_escrow(order_id)` | Read-only view of an escrow record |

### Error Codes

These codes are stable on-chain ABI values. Never reuse a code, even after removing a variant.

| Code | Variant | Meaning |
|-----:|---------|--------|
| 1 | `NotFound` | No escrow record for the given order_id |
| 2 | `AlreadySettled` | Escrow already released or refunded |
| 3 | `InDispute` | Escrow is currently in a disputed state |
| 4 | `Unauthorized` | Caller is not permitted to perform this action |
| 5 | `InvalidAmount` | Amount is zero, negative, or exceeds allowed bounds |
| 6 | `AlreadyExists` | Duplicate deposit for the same order_id |
| 7 | `TimeoutNotReached` | Refund called before the escrow timeout |
| 8 | `InvalidWasmHash` | Upgrade called with an all-zero WASM hash |
| 9 | `NoPendingAdmin` | `accept_admin` called with no pending admin set |
| 10 | `InvalidToken` | Token at release does not match token used at deposit |
| 11 | `MigrationFailed` | A v1 EscrowRecord entry could not be migrated to v2 |
| 12 | `NotEnoughSignatures` | Fewer valid signatures than the cooperative threshold |
| 13 | `CoopNotConfigured` | Cooperative members / threshold not yet configured |
| 14 | `AlreadyInitialized` | `initialize` called more than once |
| 15 | `NotAdmin` | Caller does not hold the admin role |
| 16 | `BelowMinDeposit` | Deposit amount is below the configured minimum (dust guard) |
| 17 | `BatchTooLarge` | `batch_release` called with more than `MAX_BATCH_RELEASE` IDs |
| 18 | `SnapshotNotFound` | No snapshot exists for the requested (order_id, ledger_sequence) |
| 19 | `NotYetReleasable` | Release called before the pre-order unlock date |
| 20 | `SubmissionWindowClosed` | Evidence submission window (48 h) has closed |
| 21 | `AutoReleaseNotReached` | Auto-release timestamp has not yet been reached |
| 22 | `TooManyCoopSigners` | Cooperative signer count exceeds `MAX_COOP_SIGNERS` |

Next available code: **23**. See the `NEXT_CODE` comment in `contracts/escrow/src/lib.rs` for the authoritative value.

### Build & Test

```bash
cd contract
cargo test --features testutils
cargo build --target wasm32-unknown-unknown --release
```

### Design Notes

- **#468** — Every function that reads/writes an escrow entry calls `extend_ttl(TTL_MIN=100_000, TTL_MAX=200_000)` so entries never expire and lock funds.
- **#470** — `deposit` returns `EscrowError::InvalidAmount` if `timeout_unix` is not at least 1 hour (`3600 s`) in the future.
- **#471** — `deposit`, `release`, and `refund` each emit a Soroban event so the backend can subscribe to the RPC event stream instead of polling.

## i18n Translation Sync

The project supports English (`en.json`) and Swahili (`sw.json`) via `react-i18next`. A CI script enforces key parity between the two locale files.

### Running the sync check

```bash
cd frontend
node scripts/check-i18n-sync.js
```

This script fails if `sw.json` is missing any keys present in `en.json`. It is also run as part of the test suite (`i18nSync.test.js`).

### Adding new translations

1. Add the English string to `src/i18n/en.json`.
2. Add the corresponding Swahili translation to `src/i18n/sw.json`.
3. Run `node scripts/check-i18n-sync.js` to verify parity.
4. Run `npx vitest run src/test/i18nSync.test.js` to confirm the test passes.

Missing Swahili translations will fall back to the English key string, showing raw translation keys to Swahili users. Always keep both locale files in sync.

## Notes

- Stellar wallets are auto-created on registration
- All payments use **XLM on Stellar Testnet** — no real money involved
- SQLite database file (`market.db`) is created automatically on first run (when `DATABASE_URL` is not set)
- To reset SQLite: delete `backend/market.db`

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for full guidance on:

- Local dev environment setup (Rust toolchain, Stellar CLI)
- Build and test commands
- Lint requirements (`cargo fmt`, `cargo clippy`, `cargo audit`)
- Branch naming and Conventional Commit format
- PR requirements and review process
- Issue workflow and label guide

For security vulnerabilities, follow the process in [SECURITY.md](./SECURITY.md) instead of opening a public issue.
