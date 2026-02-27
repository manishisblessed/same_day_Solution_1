-- ============================================================================
-- PULSE PAY (formerly InstaCash) SETTLEMENT SYSTEM MIGRATION
-- ============================================================================
-- This migration adds:
-- 1. card_classification to MDR scheme tables (for precise MDR by card tier)
-- 2. Settlement tracking columns to razorpay_pos_transactions
-- 3. Pulse Pay settlement log table (for audit & duplicate prevention)
-- 
-- Run this in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- 1. ADD card_classification TO MDR SCHEME TABLES
-- ============================================================================
-- Allows setting different MDR rates per card classification
-- e.g., VISA CREDIT PLATINUM vs VISA CREDIT GOLD vs VISA CREDIT CLASSIC
-- ============================================================================

-- New scheme management MDR rates table
ALTER TABLE scheme_mdr_rates ADD COLUMN IF NOT EXISTS card_classification TEXT;
CREATE INDEX IF NOT EXISTS idx_scheme_mdr_card_classification ON scheme_mdr_rates(card_classification);

-- Legacy global schemes table
ALTER TABLE global_schemes ADD COLUMN IF NOT EXISTS card_classification TEXT;
CREATE INDEX IF NOT EXISTS idx_global_schemes_card_classification ON global_schemes(card_classification);

-- Legacy retailer schemes table
ALTER TABLE retailer_schemes ADD COLUMN IF NOT EXISTS card_classification TEXT;
CREATE INDEX IF NOT EXISTS idx_retailer_schemes_card_classification ON retailer_schemes(card_classification);

-- Update unique index on retailer_schemes to include card_classification
DROP INDEX IF EXISTS idx_unique_active_retailer_scheme;
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_retailer_scheme 
ON retailer_schemes(retailer_id, mode, card_type, brand_type, COALESCE(card_classification, ''))
WHERE status = 'active';

-- ============================================================================
-- 2. ADD SETTLEMENT TRACKING TO razorpay_pos_transactions
-- ============================================================================
-- Tracks whether a transaction was settled via Pulse Pay (T+0) or auto T+1
-- ============================================================================

-- Retailer/Distributor hierarchy (if not already exists)
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS retailer_id TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS distributor_id TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS master_distributor_id TEXT;

-- Settlement mode: INSTACASH = Pulse Pay instant T+0, AUTO_T1 = next-day automatic, NULL = unsettled
ALTER TABLE razorpay_pos_transactions 
  ADD COLUMN IF NOT EXISTS settlement_mode TEXT 
  CHECK (settlement_mode IN ('INSTACASH', 'AUTO_T1'));

-- Wallet credit tracking (whether this transaction has been credited to retailer wallet)
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS wallet_credited BOOLEAN DEFAULT FALSE;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS wallet_credit_id UUID;

-- Amount columns (gross = original amount, mdr = fee deducted, net = amount credited)
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS gross_amount DECIMAL(12, 2);
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS mdr_amount DECIMAL(12, 2);
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS net_amount DECIMAL(12, 2);

-- MDR details (calculated at settlement time, not at capture time)
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS mdr_rate NUMERIC(6,4);
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS mdr_scheme_id UUID;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS mdr_scheme_type TEXT;

-- Pulse Pay tracking
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS instacash_requested_at TIMESTAMPTZ;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS instacash_batch_id UUID;

-- T+1 auto-settle tracking  
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS auto_settled_at TIMESTAMPTZ;

-- Indexes for settlement queries
CREATE INDEX IF NOT EXISTS idx_rpt_retailer_id ON razorpay_pos_transactions(retailer_id) WHERE retailer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rpt_settlement_mode ON razorpay_pos_transactions(settlement_mode);
CREATE INDEX IF NOT EXISTS idx_rpt_wallet_credited ON razorpay_pos_transactions(wallet_credited);
CREATE INDEX IF NOT EXISTS idx_rpt_unsettled 
  ON razorpay_pos_transactions(retailer_id, display_status) 
  WHERE wallet_credited = false AND display_status = 'SUCCESS' AND retailer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rpt_instacash_batch ON razorpay_pos_transactions(instacash_batch_id) 
  WHERE instacash_batch_id IS NOT NULL;

-- ============================================================================
-- 3. PULSE PAY SETTLEMENT BATCHES (Audit & Duplicate Prevention)
-- ============================================================================
-- Each Pulse Pay request creates a batch. Transactions can only belong to one batch.
-- This prevents double-settlement and provides full audit trail.
-- ============================================================================

CREATE TABLE IF NOT EXISTS instacash_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Who requested it
  retailer_id TEXT NOT NULL,
  
  -- Batch summary
  total_transactions INT NOT NULL DEFAULT 0,
  total_gross_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total_mdr_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total_net_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'processing' 
    CHECK (status IN ('processing', 'completed', 'partial', 'failed')),
  
  -- Results
  success_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  
  -- Wallet credit tracking
  wallet_credit_id UUID,
  
  -- Timestamps
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Metadata (transaction IDs, error details, etc.)
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_instacash_batches_retailer ON instacash_batches(retailer_id);
CREATE INDEX IF NOT EXISTS idx_instacash_batches_status ON instacash_batches(status);
CREATE INDEX IF NOT EXISTS idx_instacash_batches_requested_at ON instacash_batches(requested_at DESC);

-- ============================================================================
-- 4. PULSE PAY BATCH ITEMS (Per-transaction settlement details)
-- ============================================================================

CREATE TABLE IF NOT EXISTS instacash_batch_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES instacash_batches(id) ON DELETE CASCADE,
  
  -- Transaction reference
  pos_transaction_id UUID NOT NULL, -- razorpay_pos_transactions.id
  txn_id TEXT NOT NULL, -- razorpay txn_id for quick lookup
  
  -- Amount details
  gross_amount DECIMAL(12, 2) NOT NULL,
  mdr_rate NUMERIC(6, 4) NOT NULL DEFAULT 0,
  mdr_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  
  -- Card info (denormalized for audit)
  card_type TEXT,
  card_brand TEXT,
  card_classification TEXT,
  payment_mode TEXT,
  
  -- MDR scheme used
  scheme_id UUID,
  scheme_type TEXT,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'settled', 'failed', 'skipped')),
  error_message TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instacash_items_batch ON instacash_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_instacash_items_txn ON instacash_batch_items(txn_id);
CREATE INDEX IF NOT EXISTS idx_instacash_items_pos_txn ON instacash_batch_items(pos_transaction_id);

-- Prevent same transaction from being in multiple batches
CREATE UNIQUE INDEX IF NOT EXISTS idx_instacash_items_unique_txn 
  ON instacash_batch_items(pos_transaction_id) 
  WHERE status IN ('pending', 'settled');

-- ============================================================================
-- 5. CARD CLASSIFICATION REFERENCE TABLE
-- ============================================================================
-- Standard card classifications from Razorpay POS
-- Used for dropdowns in scheme management UI
-- ============================================================================

CREATE TABLE IF NOT EXISTS card_classifications (
  id SERIAL PRIMARY KEY,
  card_type TEXT NOT NULL CHECK (card_type IN ('CREDIT', 'DEBIT', 'PREPAID')),
  brand_type TEXT NOT NULL, -- VISA, MasterCard, RUPAY, Amex, Diners Club
  classification TEXT NOT NULL, -- PLATINUM, GOLD, CLASSIC, BUSINESS, etc.
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed with reference data from Razorpay (from the image provided)
INSERT INTO card_classifications (card_type, brand_type, classification) VALUES
  -- CREDIT CARD classifications
  ('CREDIT', 'Amex', 'ANY'),
  ('CREDIT', 'Diners Club', 'STANDARD'),
  ('CREDIT', 'MasterCard', 'ANY'),
  ('CREDIT', 'MasterCard', 'BUSINESS'),
  ('CREDIT', 'MasterCard', 'CORPORATE'),
  ('CREDIT', 'MasterCard', 'Fpaydefaul'),
  ('CREDIT', 'MasterCard', 'GOLD'),
  ('CREDIT', 'MasterCard', 'Mastercard World'),
  ('CREDIT', 'MasterCard', 'MPL'),
  ('CREDIT', 'MasterCard', 'MPL - Platinum'),
  ('CREDIT', 'MasterCard', 'PLATINUM'),
  ('CREDIT', 'MasterCard', 'STANDARD'),
  ('CREDIT', 'MasterCard', 'TITANIUM'),
  ('CREDIT', 'MasterCard', 'WORLD CARD'),
  ('CREDIT', 'MasterCard', 'WORLD FOR'),
  ('CREDIT', 'RUPAY', 'ANY'),
  ('CREDIT', 'RUPAY', 'PLATINUM'),
  ('CREDIT', 'RUPAY', 'PREPAID'),
  ('CREDIT', 'RUPAY', 'Select'),
  ('CREDIT', 'VISA', 'ANY'),
  ('CREDIT', 'VISA', 'BUSINESS'),
  ('CREDIT', 'VISA', 'CLASSIC'),
  ('CREDIT', 'VISA', 'CORPORATE'),
  ('CREDIT', 'VISA', 'ELECTRON'),
  ('CREDIT', 'VISA', 'Fpaydefaul'),
  ('CREDIT', 'VISA', 'GOLD'),
  ('CREDIT', 'VISA', 'Infinite'),
  ('CREDIT', 'VISA', 'PLATINUM'),
  ('CREDIT', 'VISA', 'Rewards'),
  ('CREDIT', 'VISA', 'SIGNATURE'),
  ('CREDIT', 'VISA', 'Visa Class'),
  -- DEBIT CARD classifications
  ('DEBIT', 'MasterCard', 'ANY'),
  ('DEBIT', 'RUPAY', 'PREPAID'),
  ('DEBIT', 'VISA', 'ANY'),
  ('DEBIT', 'VISA', 'CLASSIC'),
  ('DEBIT', 'VISA', 'ELECTRON'),
  ('DEBIT', 'VISA', 'GOLD'),
  ('DEBIT', 'VISA', 'PLATINUM'),
  -- PREPAID CARD classifications
  ('PREPAID', 'MasterCard', 'MPG'),
  ('PREPAID', 'RUPAY', 'ANY'),
  ('PREPAID', 'RUPAY', 'PREPAID'),
  ('PREPAID', 'VISA', 'ANY')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 6. COMMENTS
-- ============================================================================

COMMENT ON TABLE instacash_batches IS 'Pulse Pay (T+0) instant settlement batches - tracks each instant settlement request from retailers';
COMMENT ON TABLE instacash_batch_items IS 'Individual transaction items within a Pulse Pay batch with per-transaction MDR calculation';
COMMENT ON TABLE card_classifications IS 'Reference data: valid card classifications from Razorpay POS grouped by card type and brand';
COMMENT ON COLUMN razorpay_pos_transactions.settlement_mode IS 'How this transaction was settled: INSTACASH/Pulse Pay (T+0 instant) or AUTO_T1 (next-day automatic)';
COMMENT ON COLUMN razorpay_pos_transactions.instacash_batch_id IS 'If settled via Pulse Pay, the batch this transaction belongs to';
COMMENT ON COLUMN scheme_mdr_rates.card_classification IS 'Card tier classification: PLATINUM, GOLD, CLASSIC, BUSINESS, STANDARD, etc. NULL = applies to all classifications';

