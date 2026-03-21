-- ============================================================================
-- Additional commission (per unit) for MD and Distributor on product rates.
-- When role = distributor: md_commission_additional is used when crediting MD.
-- When role = retailer: distributor_commission_additional and md_commission_additional
-- are used when crediting Distributor and MD on auto-debit.
-- ============================================================================

ALTER TABLE subscription_product_rates
  ADD COLUMN IF NOT EXISTS md_commission_additional DECIMAL(12, 2) DEFAULT NULL CHECK (md_commission_additional >= 0);

ALTER TABLE subscription_product_rates
  ADD COLUMN IF NOT EXISTS distributor_commission_additional DECIMAL(12, 2) DEFAULT NULL CHECK (distributor_commission_additional >= 0);

COMMENT ON COLUMN subscription_product_rates.md_commission_additional IS 'Optional extra commission (₹ per unit) credited to Master Distributor when this rate is used in auto-debit. Used when user_role is distributor or retailer.';
COMMENT ON COLUMN subscription_product_rates.distributor_commission_additional IS 'Optional extra commission (₹ per unit) credited to Distributor when this rate is used in auto-debit. Used when user_role is retailer.';
