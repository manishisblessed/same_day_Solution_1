# Settlement Payment Limit Tier Implementation

## Overview
Implemented retailer-specific settlement payment limit tiers with admin controls. All retailers default to ₹1,00,000 limit, and admins can enable higher limits (₹1,50,000 or ₹2,00,000) for specific retailers.

## Features Implemented

### 1. Database Migration
**File**: `supabase-settlement-limit-tier-migration.sql`

- Added `settlement_limit_tier` column to `retailers` table
- Default value: `100000` (all existing retailers get this)
- Allowed values: `100000`, `150000`, `200000`
- Created index for performance

**To Apply**: Run this SQL in Supabase SQL Editor

### 2. Limit Enforcement
**File**: `app/api/settlement/create/route.ts`

- Updated `checkSettlementLimits()` to check retailer-specific `settlement_limit_tier` first
- Validates per-transaction limit before checking daily limits
- Returns clear error messages with limit amount

### 3. Admin API Endpoint
**File**: `app/api/admin/retailers/settlement-limit/route.ts`

**POST** `/api/admin/retailers/settlement-limit`
- Updates settlement limit tier for a retailer
- Validates tier value (must be 100000, 150000, or 200000)
- Returns success/error response

**GET** `/api/admin/retailers/settlement-limit?retailer_id=RET123`
- Fetches current settlement limit tier for a retailer

### 4. Admin UI
**File**: `app/admin/page.tsx`

- Added "Set Settlement Limit" button (teal DollarSign icon) in retailers table actions
- Modal with three tier options:
  - ₹1,00,000 (Default) - Standard limit
  - ₹1,50,000 - Higher limit (requires scheme charges)
  - ₹2,00,000 - Maximum limit (requires scheme charges)
- Warning message about scheme charges for higher limits
- Real-time update with success/error feedback

### 5. Retailer Payment Component
**File**: `app/dashboard/retailer/page.tsx`

- Fetches retailer's settlement limit tier on component load
- Displays limit prominently in settlement amount input section
- Validates amount against limit before submission
- Shows clear error if amount exceeds limit
- Displays "Enhanced limit enabled" badge for limits > ₹1,00,000
- Dynamic `max` attribute on input field

## Usage

### For Admins

1. **Navigate to Admin Dashboard** → Retailers tab
2. **Find the retailer** you want to update
3. **Click the teal "Set Settlement Limit" button** (DollarSign icon) next to the BBPS limit button
4. **Select the desired limit tier**:
   - ₹1,00,000 (Default)
   - ₹1,50,000
   - ₹2,00,000
5. **Click "Update Limit"**

**Important**: For limits above ₹1,00,000, ensure the retailer's scheme has charges configured for the higher amount ranges in Scheme Management.

### For Retailers

- Your settlement payment limit is displayed in the settlement form
- If you try to settle more than your limit, you'll see an error message
- Contact admin to request a higher limit

## Database Schema

```sql
ALTER TABLE retailers 
ADD COLUMN settlement_limit_tier DECIMAL(12, 2) DEFAULT 100000 
CHECK (settlement_limit_tier IN (100000, 150000, 200000));
```

## API Examples

### Update Limit
```bash
POST /api/admin/retailers/settlement-limit
{
  "retailer_id": "RET64519407",
  "settlement_limit_tier": 150000
}
```

### Get Limit
```bash
GET /api/admin/retailers/settlement-limit?retailer_id=RET64519407
```

## Validation Flow

1. **Frontend (retailer/page.tsx)**:
   - Checks limit when user enters settlement amount
   - Shows error immediately if amount exceeds limit
   - Validates again before submission

2. **Backend (settlement/create/route.ts)**:
   - Validates limit during settlement creation
   - Returns error if amount exceeds retailer's tier
   - Also checks daily settlement limits

3. **Database**:
   - Constraint ensures only valid tier values (100000, 150000, 200000)

## Notes

- **Default Limit**: All retailers start with ₹1,00,000 limit
- **Scheme Charges**: For higher limits, ensure scheme charges are configured in Scheme Management for the relevant amount ranges
- **Daily Limits**: Per-transaction limit tier is checked first, then daily settlement limits
- **Real-time Updates**: Limit changes take effect immediately after admin update

## Files Modified

1. `supabase-settlement-limit-tier-migration.sql` (NEW)
2. `app/api/settlement/create/route.ts` (UPDATED)
3. `app/api/admin/retailers/settlement-limit/route.ts` (NEW)
4. `app/admin/page.tsx` (UPDATED)
5. `app/dashboard/retailer/page.tsx` (UPDATED)

## Next Steps

1. **Run the migration** in Supabase SQL Editor
2. **Test admin UI** by setting limits for test retailers
3. **Verify settlement flow** with different limit tiers
4. **Configure scheme charges** for higher amount ranges if needed

## Admin UI Location

The settlement limit button appears in the **Retailers table** in the Admin Dashboard:
- **Location**: Admin Dashboard → Retailers tab → Actions column
- **Button**: Teal DollarSign icon (💰) next to the indigo BBPS limit button
- **Tooltip**: "Set Settlement Limit"

