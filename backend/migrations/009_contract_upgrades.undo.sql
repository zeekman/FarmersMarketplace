-- Undo: 009_contract_upgrades
DROP INDEX IF EXISTS idx_contract_upgrades_upgraded_at;
DROP INDEX IF EXISTS idx_contract_upgrades_contract_id;
DROP TABLE IF EXISTS contract_upgrades;
