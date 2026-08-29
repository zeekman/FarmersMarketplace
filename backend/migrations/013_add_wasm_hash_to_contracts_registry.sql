-- Migration: 013_add_wasm_hash_to_contracts_registry
-- Add wasm_hash column to store the WASM bytecode hash for deployed contracts

ALTER TABLE contracts_registry ADD COLUMN wasm_hash TEXT;