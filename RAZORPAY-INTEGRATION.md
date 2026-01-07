# Razorpay POS Transaction System

This document describes the Razorpay POS transaction integration for Same Day Solution Pvt. Ltd.

## Overview

The system provides real-time visibility of Razorpay POS transactions across all user roles (Admin, Super Distributor, Distributor, Retailer) with role-based access control and automatic wallet crediting.

## Features

- ✅ Real-time transaction visibility (polling every 10 seconds)
- ✅ Role-based data access (strict hierarchy enforcement)
- ✅ Webhook handler for instant transaction ingestion
- ✅ Polling fallback if webhook unavailable
- ✅ Automatic wallet crediting on successful transactions
- ✅ Idempotent wallet operations (prevents duplicate credits)
- ✅ Comprehensive filtering (date, TID, RRN, status, amount)
- ✅ Pagination and sorting
- ✅ Export functionality

## Database Setup

1. Run the base schema first: `supabase-schema.sql`
2. Then run the Razorpay extension: `supabase-schema-razorpay.sql`

The schema includes:
- `pos_terminals` - Maps Razorpay TID to retailers/distributors
- `razorpay_transactions` - Stores all POS transactions
- `wallet_ledger` - Single source of truth for wallet balance
- `commissions` - For future commission tracking

## Environment Variables

Add these to your `.env.local`:

```env
# Razorpay Configuration
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# Supabase (if not already set)
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Webhook Configuration

1. In Razorpay Dashboard, go to Settings → Webhooks
2. Add webhook URL: `https://yourdomain.com/api/razorpay/webhook`
3. Select events:
   - `payment.captured`
   - `payment.authorized`
   - `payment.refunded`
   - `refund.processed`
4. Copy the webhook secret to `RAZORPAY_WEBHOOK_SECRET`

## POS Terminal Setup

Before transactions can be processed, you need to map Razorpay TIDs to your system:

1. Go to Admin Dashboard → POS Machines
2. Create/assign POS machines to retailers
3. Go to Admin Dashboard → Transactions (or use API) to create TID mappings

Alternatively, use the API:

```typescript
// Create POS terminal mapping
POST /api/admin/pos-terminals
{
  "tid": "RAZORPAY_TID",
  "machine_id": "POS123",
  "retailer_id": "RET123456"
}
```

## Transaction Flow

1. **POS Transaction Occurs**
   - Customer makes payment via POS machine
   - Razorpay processes payment

2. **Webhook/Polling**
   - Webhook receives payment event (preferred)
   - OR polling fetches new transactions (fallback)

3. **Transaction Processing**
   - System identifies TID and maps to retailer
   - Calculates MDR (Merchant Discount Rate)
   - Stores transaction in `razorpay_transactions`

4. **Wallet Credit**
   - On successful capture, wallet is credited automatically
   - Idempotent operation prevents duplicates
   - Ledger entry created in `wallet_ledger`

## Role-Based Access

### Admin
- Can see ALL transactions
- Can filter by any field
- Full access to all data

### Super Distributor (Master Distributor)
- Can see transactions from all distributors and retailers under them
- Read-only access
- Can filter by date, TID, status, etc.

### Distributor
- Can see transactions from all retailers under them
- Read-only access
- Can filter by date, TID, status, etc.

### Retailer
- Can see ONLY their own transactions
- Read-only access
- Can filter by date, TID, status

## API Endpoints

### Get Transactions
```
GET /api/transactions?page=1&limit=50&status=captured&dateFrom=2024-01-01&dateTo=2024-01-31
```

Query Parameters:
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 50)
- `dateFrom` - Start date (ISO format)
- `dateTo` - End date (ISO format)
- `tid` - Terminal ID
- `rrn` - Retrieval Reference Number
- `status` - Transaction status
- `retailer_id` - Filter by retailer
- `distributor_id` - Filter by distributor
- `master_distributor_id` - Filter by master distributor
- `minAmount` - Minimum amount
- `maxAmount` - Maximum amount
- `sortBy` - Field to sort by (created_at, gross_amount, net_amount)
- `sortOrder` - asc or desc

### Webhook
```
POST /api/razorpay/webhook
```

Headers:
- `x-razorpay-signature` - Webhook signature for verification

## MDR Configuration

Default MDR rate is 1.5% (0.015). To change:

1. Update `DEFAULT_MDR_RATE` in `lib/razorpay/service.ts`
2. Or pass custom rate per transaction

## Wallet Balance

Wallet balance is **always derived from ledger**, never stored directly. This ensures:
- Accurate balance calculation
- Full audit trail
- No race conditions

To get wallet balance:
```typescript
import { getWalletBalance } from '@/lib/razorpay/service'

const balance = await getWalletBalance('RET123456')
```

## Real-Time Updates

The system uses polling by default (every 10 seconds). To adjust:

```tsx
<TransactionsTable 
  autoPoll={true} 
  pollInterval={5000} // 5 seconds
/>
```

## Troubleshooting

### Transactions not appearing
1. Check webhook is configured correctly
2. Verify TID mapping exists in `pos_terminals` table
3. Check webhook logs in Razorpay dashboard
4. Verify user has correct role/permissions

### Wallet not crediting
1. Check transaction status is 'captured'
2. Verify `wallet_credited` flag in transaction
3. Check ledger entries for the retailer
4. Review server logs for errors

### Webhook signature verification failing
1. Verify `RAZORPAY_WEBHOOK_SECRET` is correct
2. Check webhook payload format
3. Ensure raw body is used for signature verification

## Security Notes

- Never expose Razorpay keys in frontend
- Use service role key only in server-side code
- Webhook signature verification is mandatory
- All wallet operations are idempotent
- Role-based filtering enforced at API level

## Future Enhancements

- [ ] BBPS integration
- [ ] Payout functionality
- [ ] Commission calculation and distribution
- [ ] Advanced analytics and reporting
- [ ] Transaction reconciliation tools
- [ ] SMS/Email notifications

## Support

For issues or questions, contact the development team.



