# Contract checks

Run these from the repository root before deploying or in CI.

- `bash contracts/scripts/check-escrow-error-codes.sh` verifies that escrow error-code documentation matches the contract enum.
- `NETWORK=testnet DATABASE_URL=... bash contracts/scripts/check-wasm-hashes.sh` rebuilds every contract, hashes its WASM, and fails when it differs from the hash registered in `contracts_registry`.

The hash check requires the Rust WASM target, `cargo`, `psql`, and `shasum`. Registry rows must have a `wasm_hash` recorded at deployment time; it deliberately fails on missing hashes rather than treating an unverified deployment as valid.
