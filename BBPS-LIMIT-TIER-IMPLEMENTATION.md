# BBPS Payment Limit Tier Implementation

## Overview
Implemented retailer-specific BBPS payment limit tiers with admin controls. All retailers default to ₹49,999 limit, and admins can enable higher limits (₹99,999 or ₹1,89,999) for specific retailers.

## Features Implemented

### 1. Database Migration
**File**: `supabase-bbps-limit-tier-migration.sql`

- Added `bbps_limit_tier` column to `retailers` table
- Default value: `49999` (all existing retailers get this)
- Allowed values: `49999`, `99999`, `189999`
- Created index for performance

**To Apply**: Run this SQL in Supabase SQL Editor

### 2. Limit Enforcement
**File**: `lib/limits/enforcement.ts`

- Updated `checkBBPSLimitSlab()` to accept `retailerId` parameter
- Checks retailer-specific `bbps_limit_tier` first
- Falls back to global limit slabs for backward compatibility
- Returns clear error messages with limit amount

### 3. Admin API Endpoint
**File**: `app/api/admin/retailers/bbps-limit/route.ts`

**POST** `/api/admin/retailers/bbps-limit`
- Updates BBPS limit tier for a retailer
- Validates tier value (must be 49999, 99999, or 189999)
- Returns success/error response

**GET** `/api/admin/retailers/bbps-limit?retailer_id=RET123`
- Fetches current BBPS limit tier for a retailer

### 4. Admin UI
**File**: `app/admin/page.tsx`

- Added "Set BBPS Limit" button (indigo icon) in retailers table actions
- Modal with three tier options:
  - ₹49,999 (Default) - Standard limit
  - ₹99,999 - Higher limit (requires scheme charges)
  - ₹1,89,999 - Maximum limit (requires scheme charges)
- Warning message about scheme charges for higher limits
- Real-time update with success/error feedback

### 5. Retailer Payment Component
**File**: `components/BBPSPayment.tsx`

- Fetches retailer's BBPS limit tier on component load
- Displays limit prominently in custom amount section
- Validates amount against limit before payment
- Shows clear error if amount exceeds limit
- Displays "Enhanced limit enabled" badge for limits > ₹49,999

## Usage

### For Admins

1. **Navigate to Admin Dashboard** → Retailers tab
2. **Find the retailer** you want to update
3. **Click the indigo "Set BBPS Limit" button** (TrendingUp icon)
4. **Select the desired limit tier**:
   - ₹49,999 (Default)
   - ₹99,999
   - ₹1,89,999
5. **Click "Update Limit"**

**Important**: For limits above ₹49,999, ensure the retailer's scheme has charges configured for the higher amount ranges in Scheme Management.

### For Retailers

- Your BBPS payment limit is displayed in the payment form
- If you try to pay more than your limit, you'll see an error message
- Contact admin to request a higher limit

## Database Schema

```sql
ALTER TABLE retailers 
ADD COLUMN bbps_limit_tier DECIMAL(12, 2) DEFAULT 49999 
CHECK (bbps_limit_tier IN (49999, 99999, 189999));
```

## API Examples

### Update Limit
```bash
POST /api/admin/retailers/bbps-limit
{
  "retailer_id": "RET64519407",
  "bbps_limit_tier": 99999
}
```

### Get Limit
```bash
GET /api/admin/retailers/bbps-limit?retailer_id=RET64519407
```

## Validation Flow

1. **Frontend (BBPSPayment.tsx)**:
   - Checks limit when user enters custom amount
   - Shows error immediately if amount exceeds limit

2. **Backend (enforcement.ts)**:
   - Validates limit during payment processing
   - Returns error if amount exceeds retailer's tier

3. **Database**:
   - Constraint ensures only valid tier values (49999, 99999, 189999)

## Notes

- **Default Limit**: All retailers start with ₹49,999 limit
- **Scheme Charges**: For higher limits, ensure scheme charges are configured in Scheme Management for the relevant amount ranges
- **Backward Compatibility**: System falls back to global limit slabs if retailer-specific tier is not set
- **Real-time Updates**: Limit changes take effect immediately after admin update

## Files Modified

1. `supabase-bbps-limit-tier-migration.sql` (NEW)
2. `lib/limits/enforcement.ts` (UPDATED)
3. `app/api/admin/retailers/bbps-limit/route.ts` (NEW)
4. `app/admin/page.tsx` (UPDATED)
5. `components/BBPSPayment.tsx` (UPDATED)

## Next Steps

1. **Run the migration** in Supabase SQL Editor
2. **Test admin UI** by setting limits for test retailers
3. **Verify payment flow** with different limit tiers
4. **Configure scheme charges** for higher amount ranges if needed

