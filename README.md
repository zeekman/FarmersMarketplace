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

## Notes

- Stellar wallets are auto-created on registration
- All payments use **XLM on Stellar Testnet** — no real money involved
- SQLite database file (`market.db`) is created automatically on first run (when `DATABASE_URL` is not set)
- To reset SQLite: delete `backend/market.db`
