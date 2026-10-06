-- Add section hash columns for hash-gated check-in optimization
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS packages_hash VARCHAR(64);
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS repos_hash VARCHAR(64);
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS interfaces_hash VARCHAR(64);
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS hostname_hash VARCHAR(64);
