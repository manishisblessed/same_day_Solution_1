-- Migration: Add bbps2_enabled and settlement2_enabled columns
-- BBPS-1 and BBPS-2 are separate services; Settlement-1 and Settlement-2 are separate services.

-- RETAILERS
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS bbps2_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS settlement2_enabled BOOLEAN NOT NULL DEFAULT false;

-- DISTRIBUTORS
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS bbps2_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS settlement2_enabled BOOLEAN NOT NULL DEFAULT false;

-- MASTER DISTRIBUTORS
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS bbps2_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS settlement2_enabled BOOLEAN NOT NULL DEFAULT false;

-- PARTNERS
ALTER TABLE partners ADD COLUMN IF NOT EXISTS bbps2_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS settlement2_enabled BOOLEAN NOT NULL DEFAULT false;

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_retailers_bbps2_enabled ON retailers (bbps2_enabled);
CREATE INDEX IF NOT EXISTS idx_retailers_settlement2_enabled ON retailers (settlement2_enabled);
CREATE INDEX IF NOT EXISTS idx_distributors_bbps2_enabled ON distributors (bbps2_enabled);
CREATE INDEX IF NOT EXISTS idx_distributors_settlement2_enabled ON distributors (settlement2_enabled);
CREATE INDEX IF NOT EXISTS idx_master_distributors_bbps2_enabled ON master_distributors (bbps2_enabled);
CREATE INDEX IF NOT EXISTS idx_master_distributors_settlement2_enabled ON master_distributors (settlement2_enabled);
