-- ============================================================================
-- BBPS LIMIT SLABS INITIAL CONFIGURATION
-- ============================================================================
-- Ensures only the first slab (0-49999) is enabled initially
-- Other slabs can be activated by admin via /api/admin/bbps-slabs/update
-- ============================================================================

-- Ensure bbps_limit_slabs table exists (from main schema)
CREATE TABLE IF NOT EXISTS bbps_limit_slabs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slab_name TEXT NOT NULL UNIQUE,
  min_amount DECIMAL(12, 2) NOT NULL,
  max_amount DECIMAL(12, 2) NOT NULL,
  is_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert/Update slabs with only first slab enabled
INSERT INTO bbps_limit_slabs (slab_name, min_amount, max_amount, is_enabled) VALUES
  ('slab_1', 0, 49999, TRUE),  -- Only this enabled initially
  ('slab_2', 50000, 99999, FALSE),
  ('slab_3', 100000, 149999, FALSE),
  ('slab_4', 150000, 184999, FALSE),
  ('slab_5', 185000, 200000, FALSE)  -- Max limit: ₹2,00,000
ON CONFLICT (slab_name) DO UPDATE SET
  is_enabled = CASE 
    WHEN bbps_limit_slabs.slab_name = 'slab_1' THEN TRUE
    ELSE FALSE
  END,
  updated_at = NOW();

-- Ensure only slab_1 is enabled (disable all others)
UPDATE bbps_limit_slabs 
SET is_enabled = (slab_name = 'slab_1'), 
    updated_at = NOW()
WHERE slab_name IN ('slab_1', 'slab_2', 'slab_3', 'slab_4', 'slab_5');

