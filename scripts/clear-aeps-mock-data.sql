-- ============================================================================
-- CLEAR AEPS MOCK DATA FOR PRODUCTION TESTING
-- ============================================================================
-- Run this script to clear mock merchant registrations so you can
-- complete real KYC with Chagans AEPS API
-- ============================================================================

-- Option 1: Delete ALL mock merchants (MOCK_ or TEMP_ prefix)
-- This will allow fresh KYC registration with real Chagans API
DELETE FROM aeps_merchants 
WHERE merchant_id LIKE 'MOCK_%' 
   OR merchant_id LIKE 'TEMP_%';

-- Option 2: Delete specific user's mock merchant (replace RET35258193 with actual partner_id)
-- DELETE FROM aeps_merchants WHERE user_id = 'RET35258193';

-- Option 3: View existing mock merchants before deleting
-- SELECT user_id, merchant_id, name, kyc_status, created_at 
-- FROM aeps_merchants 
-- WHERE merchant_id LIKE 'MOCK_%' OR merchant_id LIKE 'TEMP_%';

-- After running this:
-- 1. Set AEPS_USE_MOCK=false in .env.local
-- 2. Restart your dev server: npm run dev
-- 3. Visit the AEPS page and complete real KYC registration
-- 4. Chagans will return a real merchant_id (MongoDB ObjectId)

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check all AEPS merchants
-- SELECT * FROM aeps_merchants ORDER BY created_at DESC;

-- Check if any mock merchants remain
-- SELECT COUNT(*) as mock_count FROM aeps_merchants WHERE merchant_id LIKE 'MOCK_%' OR merchant_id LIKE 'TEMP_%';
