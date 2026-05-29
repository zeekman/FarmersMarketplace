ALTER TABLE refresh_tokens ADD COLUMN family_id TEXT NOT NULL DEFAULT '';
ALTER TABLE refresh_tokens ADD COLUMN used INTEGER NOT NULL DEFAULT 0;
UPDATE refresh_tokens SET family_id = token_hash WHERE family_id = '';
