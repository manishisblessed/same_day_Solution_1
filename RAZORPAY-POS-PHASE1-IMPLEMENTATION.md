# Razorpay POS Transactions - Phase 1 Implementation

## Overview
This document describes the Phase 1 implementation of Razorpay POS transaction display feature. This is a **display-only** feature that allows admins to view Razorpay POS transaction notifications in the portal.

## ✅ What Was Implemented

### 1. Database Migration
**File:** `supabase-razorpay-pos-notifications-migration.sql`

- Created a **NEW isolated table** `razorpay_pos_transactions` 
- **Completely separate** from existing `razorpay_transactions` table
- No modifications to existing tables or schemas
- Fields:
  - `txn_id` (TEXT, UNIQUE) - Idempotency key
  - `status` - Raw Razorpay status (AUTHORIZED, FAILED, etc.)
  - `display_status` - Derived status (SUCCESS, FAILED, PENDING)
  - `amount` - Transaction amount
  - `payment_mode` - CARD, UPI, WALLET, etc.
  - `device_serial`, `tid` - Device information
  - `merchant_name` - Merchant name
  - `transaction_time` - Transaction timestamp
  - `raw_data` (JSONB) - Full notification payload for reference

### 2. Webhook Endpoint
**File:** `app/api/razorpay/notification/route.ts`
**URL:** `POST /api/razorpay/notification`

**Features:**
- Accepts Razorpay POS notification JSON payloads
- **Idempotency:** Uses `txnId` as unique key for UPSERT logic
  - If `txnId` exists → UPDATE record
  - If `txnId` doesn't exist → INSERT new record
- Extracts required fields from notification payload
- Derives `display_status` from raw `status`:
  - `AUTHORIZED` → `SUCCESS`
  - `FAILED` → `FAILED`
  - Others → `PENDING`
- Always returns 200 status to prevent Razorpay retries
- Stores full payload in `raw_data` for reference

**Idempotency Logic:**
```typescript
// Check if txnId exists
const existingTransaction = await supabase
  .from('razorpay_pos_transactions')
  .select('id')
  .eq('txn_id', txnId)
  .single()

if (existingTransaction) {
  // UPDATE existing record
} else {
  // INSERT new record
}
```

### 3. Admin Fetch API
**File:** `app/api/admin/razorpay/transactions/route.ts`
**URL:** `GET /api/admin/razorpay/transactions`

**Features:**
- **Admin-only access** (checks `user.role === 'admin'`)
- Pagination support (`page`, `limit` query parameters)
- Sorted by `transaction_time DESC` (newest first)
- Returns pagination metadata (total, totalPages, hasNextPage, etc.)

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 20)

### 4. Admin Frontend Page
**File:** `app/admin/razorpay-transactions/page.tsx`
**URL:** `/admin/razorpay-transactions`

**Features:**
- Admin-only page (redirects non-admins to login)
- Displays transactions in a table with:
  - Date & Time
  - Transaction ID
  - Amount (formatted as INR currency)
  - Payment Mode
  - Status (with color-coded badges)
  - Device Serial / TID
  - Merchant Name
- Status badges:
  - **SUCCESS** → Green badge
  - **FAILED** → Red badge
  - **PENDING** → Yellow badge
- Pagination controls
- Refresh button
- Stats cards (Total Transactions, Current Page, Page Size)

### 5. Navigation Update
**File:** `components/AdminSidebar.tsx`

- Added "Razorpay Transactions" menu item to admin sidebar
- Uses Receipt icon
- Links to `/admin/razorpay-transactions`

## 🔒 Security & Isolation

1. **Isolated Implementation:**
   - New table separate from existing `razorpay_transactions`
   - New webhook endpoint separate from existing `/api/razorpay/webhook`
   - No modifications to existing code

2. **Admin-Only Access:**
   - Frontend page checks admin role
   - API endpoint checks admin role
   - Non-admins are redirected/denied

3. **Idempotency:**
   - Prevents duplicate transactions
   - Safe to receive same notification multiple times

## 📋 Setup Instructions

### 1. Run Database Migration

Execute the SQL migration in your Supabase SQL Editor:

```sql
-- Run: supabase-razorpay-pos-notifications-migration.sql
```

This creates the `razorpay_pos_transactions` table with all necessary indexes and triggers.

### 2. Configure Razorpay Webhook

In Razorpay Dashboard:
1. Go to Settings → Webhooks
2. Add webhook URL: `https://yourdomain.com/api/razorpay/notification`
3. Select events (if applicable) or configure for POS notifications
4. Save the webhook configuration

### 3. Test the Webhook

You can test the webhook endpoint using curl:

```bash
curl -X POST https://yourdomain.com/api/razorpay/notification \
  -H "Content-Type: application/json" \
  -d '{
    "txnId": "180829064415993E010034214",
    "status": "AUTHORIZED",
    "amount": 100,
    "paymentMode": "CARD",
    "deviceSerial": "5A609798",
    "tid": "10000002",
    "merchantName": "Acme Group",
    "createdTime": 1535525056000
  }'
```

### 4. Access Admin Page

1. Login as admin
2. Navigate to "Razorpay Transactions" in the sidebar
3. View transactions

## 📊 Data Flow

```
Razorpay POS Device
    ↓
Razorpay Server
    ↓
POST /api/razorpay/notification (Webhook)
    ↓
Extract & Validate Data
    ↓
UPSERT razorpay_pos_transactions (Idempotency)
    ↓
Return 200 OK
    ↓
Admin views transactions via
GET /api/admin/razorpay/transactions
    ↓
Display in /admin/razorpay-transactions page
```

## 🎯 Phase 1 Scope (What's Included)

✅ Webhook ingestion with idempotency
✅ Admin-only transaction viewing
✅ Display-only feature (no wallet/settlement logic)
✅ Pagination and sorting
✅ Status badges and formatting
✅ Isolated from existing modules

## ❌ Phase 1 Scope (What's NOT Included)

❌ Wallet crediting/debiting
❌ Settlement or payout logic
❌ Refunds or reversals
❌ MDR / GST calculations
❌ POS ownership mapping
❌ Role-based filtering (beyond admin check)
❌ Export or reports
❌ Real-time updates (polling)

## 🔄 Idempotency Details

The webhook endpoint implements idempotency using `txnId` as the unique key:

1. **First notification:** Creates new record
2. **Duplicate notification:** Updates existing record with latest data
3. **Status changes:** If Razorpay sends updated status, record is updated

This ensures:
- No duplicate transactions in the database
- Status updates are captured
- Safe to retry webhook calls

## 📝 Notes

1. **Amount Handling:** The webhook automatically converts amounts from paise to rupees if the amount seems too large (> 1,000,000).

2. **Date Parsing:** The webhook tries multiple date fields:
   - `createdTime` (epoch milliseconds)
   - `chargeSlipDate` (ISO string)
   - `postingDate` (epoch milliseconds)
   - Falls back to current time if none found

3. **Error Handling:** The webhook always returns 200 status to prevent Razorpay from retrying. Errors are logged for manual review.

4. **Future Extensions:** The `raw_data` JSONB field stores the full notification payload, allowing future enhancements without schema changes.

## 🚀 Next Steps (Future Phases)

- Phase 2: Wallet crediting on successful transactions
- Phase 3: Settlement and payout integration
- Phase 4: Role-based filtering (distributor/retailer views)
- Phase 5: Reports and exports
- Phase 6: Real-time updates via WebSockets

## 🐛 Troubleshooting

### Transactions not appearing?
1. Check webhook is receiving notifications (check server logs)
2. Verify database migration ran successfully
3. Check admin authentication
4. Verify `txnId` is unique and present in payload

### Duplicate transactions?
- Idempotency should prevent this. Check if `txnId` is consistent in notifications.

### Webhook errors?
- Check server logs for detailed error messages
- Verify Supabase connection and credentials
- Check table exists and has correct schema

## 📞 Support

For issues or questions, check:
1. Server logs for webhook errors
2. Browser console for frontend errors
3. Supabase logs for database errors

