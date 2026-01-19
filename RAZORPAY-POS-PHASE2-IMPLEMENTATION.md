# Razorpay POS Transactions - Phase 2 Implementation

## Overview
Phase 2 implements **role-based visibility** for Razorpay POS transactions using POS device mapping. This phase is **VISIBILITY ONLY** - no wallet, settlement, payout, or refund logic.

## ✅ What Was Implemented

### 1. Database Migration
**File:** `supabase-razorpay-pos-mapping-migration.sql`

- Created **NEW table** `pos_device_mapping` for mapping POS devices to roles
- Fields:
  - `id` (UUID, PK)
  - `device_serial` (TEXT, UNIQUE) - Maps to `razorpay_pos_transactions.device_serial`
  - `tid` (TEXT, optional) - Terminal ID for reference
  - `retailer_id` (TEXT, optional)
  - `distributor_id` (TEXT, optional)
  - `master_distributor_id` (TEXT, optional)
  - `status` (ACTIVE/INACTIVE) - For disabling instead of deletion
  - `created_at`, `updated_at` (timestamps)
- Indexes on: `device_serial`, `retailer_id`, `distributor_id`, `master_distributor_id`, `status`
- **No modifications** to existing `razorpay_pos_transactions` table

### 2. Admin APIs for POS Mapping Management
**Files:**
- `app/api/admin/pos-mapping/route.ts` (GET, POST)
- `app/api/admin/pos-mapping/[id]/route.ts` (PUT)

**Endpoints:**
- `GET /api/admin/pos-mapping` - List all mappings (with pagination, filtering)
- `POST /api/admin/pos-mapping` - Create new mapping
- `PUT /api/admin/pos-mapping/:id` - Update existing mapping (disable via status=INACTIVE)

**Features:**
- Admin-only access
- Pagination support
- Filtering by status, device serial, retailer/distributor/master_distributor IDs
- Validation: At least one role ID must be provided
- Device serial uniqueness enforced
- Status-based disabling (no deletion)

### 3. Role-Based Transaction API
**File:** `app/api/razorpay/transactions/route.ts`

**Endpoint:** `GET /api/razorpay/transactions`

**Behavior:**
- **Admin** → Sees ALL transactions (no filtering)
- **Master Distributor** → Sees transactions where `master_distributor_id` matches in mapping
- **Distributor** → Sees transactions where `distributor_id` matches in mapping
- **Retailer** → Sees transactions where `retailer_id` matches in mapping
- **Unmapped transactions** → Only visible to Admin, hidden from others

**Implementation:**
- Queries `pos_device_mapping` to get device serials for user's role
- Filters `razorpay_pos_transactions` by matching device serials
- Returns empty result if no mappings found (for non-admin users)
- Supports pagination

### 4. Updated Admin Transaction API
**File:** `app/api/admin/razorpay/transactions/route.ts`

- **Backward compatible** - Admin still sees all transactions
- No changes to existing functionality
- Updated comments to clarify Phase 2 behavior

### 5. TypeScript Types
**File:** `types/database.types.ts`

Added:
- `RazorpayPOSTransaction` interface
- `POSDeviceMapping` interface

### 6. Admin Frontend UI
**File:** `app/admin/pos-mapping/page.tsx`

**Features:**
- Full CRUD interface for POS device mappings
- Search by device serial
- Filter by status (ACTIVE/INACTIVE)
- Pagination
- Modal form for create/edit
- Dropdowns for retailers, distributors, master distributors
- Real-time validation
- Status badges (ACTIVE/INACTIVE)

**Access:** Admin-only (redirects non-admin users)

### 7. Transaction Visibility
**Admin:**
- Existing page at `/admin/razorpay-transactions` works unchanged
- New page at `/admin/pos-mapping` for managing mappings
- Sees all transactions regardless of mapping

**Non-Admin Users:**
- API endpoint `/api/razorpay/transactions` ready for use
- Automatically filters based on role and mapping
- Frontend integration can be added to existing dashboard pages if needed

## 🔒 Safety & Backward Compatibility

✅ **No modifications** to:
- `razorpay_pos_transactions` table structure
- Razorpay webhook logic (`app/api/razorpay/notification/route.ts`)
- Existing wallet, settlement, payout, refund logic
- Other working modules (BBPS, payout, wallet, AEPS)

✅ **Backward compatible:**
- Admin transaction view unchanged
- Existing admin functionality preserved
- POS reassignment doesn't break old transactions (historical data preserved)

## 📋 Database Schema

### pos_device_mapping Table
```sql
CREATE TABLE pos_device_mapping (
  id UUID PRIMARY KEY,
  device_serial TEXT UNIQUE NOT NULL,
  tid TEXT,
  retailer_id TEXT,
  distributor_id TEXT,
  master_distributor_id TEXT,
  status TEXT CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

## 🔄 Transaction Visibility Logic

1. **Query Mapping:** Get device serials mapped to user's role
2. **Filter Transactions:** Show only transactions with matching device serials
3. **Unmapped Devices:** Hidden from non-admin users (admin-only visibility)

## 🚀 Usage

### Admin: Create POS Mapping
```bash
POST /api/admin/pos-mapping
{
  "deviceSerial": "DEVICE123",
  "tid": "TID456",
  "retailer_id": "RET123",
  "distributor_id": "DIST456",
  "master_distributor_id": "MD789",
  "status": "ACTIVE"
}
```

### Admin: List Mappings
```bash
GET /api/admin/pos-mapping?page=1&limit=50&status=ACTIVE
```

### Admin: Update Mapping
```bash
PUT /api/admin/pos-mapping/:id
{
  "status": "INACTIVE"  // Disable instead of delete
}
```

### Role-Based Transaction Fetch
```bash
GET /api/razorpay/transactions?page=1&limit=20
# Automatically filters based on user role
```

## 📝 Notes

- **Phase 2 is VISIBILITY ONLY** - No wallet, settlement, or payout logic
- Mappings can be disabled (status=INACTIVE) but not deleted
- Historical transactions remain visible based on mapping at transaction time
- Admin always has full visibility regardless of mappings
- Non-admin users see only transactions from devices mapped to them

## 🔮 Future Enhancements (Not in Phase 2)

- Frontend transaction view for non-admin users (API ready)
- Bulk mapping import/export
- Mapping history/audit log
- Transaction reassignment tools





