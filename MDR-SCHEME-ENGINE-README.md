# MDR Scheme Engine - Complete Implementation Guide

## Overview

This document describes the **Distributor → Retailer MDR Scheme Engine** with Razorpay settlement and Supabase database. The system supports two settlement types (T+0 and T+1) with configurable MDR rates.

## Architecture

### Hierarchy
```
Admin → Distributor → Retailer
```

### Settlement Types
- **T+1 (Default)**: Next-day settlement with standard MDR
- **T+0 (Instant)**: Immediate settlement with higher MDR (T+1 MDR + 1%)

## Database Schema

### Tables Created

1. **global_schemes**: Default MDR schemes for all retailers
2. **retailer_schemes**: Custom MDR schemes defined by distributors
3. **transactions**: Transaction records with MDR calculations

### Migration File
Run the SQL migration file to create all tables:
```bash
supabase-mdr-scheme-engine-migration.sql
```

## Folder Structure

```
├── supabase-mdr-scheme-engine-migration.sql  # Database schema
├── types/
│   └── mdr-scheme.types.ts                   # TypeScript types
├── lib/
│   └── mdr-scheme/
│       ├── scheme.service.ts                  # Scheme fetching & validation
│       └── settlement.service.ts              # MDR calculation & settlement
└── app/
    └── api/
        ├── razorpay/
        │   └── mdr-settlement/
        │       └── route.ts                   # Razorpay webhook handler
        └── settlement/
            └── run-t1/
                └── route.ts                   # T+1 batch settlement cron
```

## API Endpoints

### 1. Razorpay Webhook Handler
**Endpoint**: `POST /api/razorpay/mdr-settlement`

**Production URL**: `https://api.samedaysolution.in/api/razorpay/mdr-settlement`

**Features**:
- Razorpay signature verification
- Idempotency check
- MDR calculation based on schemes
- Automatic wallet credits for T+0
- Transaction record creation

**Request Headers**:
```
x-razorpay-signature: <webhook_signature>
Content-Type: application/json
```

**Webhook Payload Format**:
```json
{
  "event": "payment.captured",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_1234567890",
        "amount": 10000,
        "currency": "INR",
        "status": "captured",
        "method": "card",
        "card": {
          "network": "Visa",
          "type": "credit"
        },
        "notes": {
          "settlement_type": "T0",
          "retailer_id": "retailer_123",
          "distributor_id": "distributor_456"
        },
        "created_at": 1234567890
      }
    }
  }
}
```

**Response**:
```json
{
  "received": true,
  "processed": true,
  "transaction_id": "uuid",
  "razorpay_payment_id": "pay_1234567890",
  "settlement_type": "T0",
  "amount": 100,
  "retailer_settlement_amount": 98.5,
  "retailer_fee": 1.5,
  "distributor_margin": 0.4,
  "company_earning": 1.1
}
```

### 2. T+1 Batch Settlement Cron Job
**Endpoint**: `POST /api/settlement/run-t1`

**Features**:
- Processes pending T+1 transactions
- Credits retailer wallets
- Updates settlement status

**Security**: Protected with API key (`SETTLEMENT_CRON_API_KEY`)

**Request Headers**:
```
x-api-key: <SETTLEMENT_CRON_API_KEY>
Content-Type: application/json
```

**Request Body** (optional):
```json
{
  "before_date": "2024-01-01T00:00:00Z"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Processed 10 transactions successfully, 0 failed",
  "processed_count": 10,
  "failed_count": 0,
  "total_count": 10,
  "before_date": "2024-01-01T00:00:00Z",
  "results": [...]
}
```

## Environment Variables

Add these to your `.env` file:

```env
# Razorpay Webhook
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# Settlement Cron Job
SETTLEMENT_CRON_API_KEY=your_cron_api_key

# Admin Wallet (for company earnings)
ADMIN_USER_ID=admin_user_id
ADMIN_USER_ROLE=master_distributor  # or 'distributor' or 'retailer'
# OR use existing master distributor
MASTER_DISTRIBUTOR_ID=master_distributor_id
```

## Business Rules

### Global Scheme Rules
1. **T+0 MDR = T+1 MDR + 1%** (enforced automatically)
2. Only one active scheme per mode/card_type/brand_type combination
3. Retailer MDR must be >= Distributor MDR

### Custom Scheme Rules
1. Distributor can define any MDR %
2. Retailer MDR must be >= Distributor MDR (validated)
3. Only one active scheme per retailer per mode/brand
4. Overrides global scheme when present

### Settlement Rules
1. **T+0**: Wallet credited immediately
2. **T+1**: Wallet credited next day via cron job
3. Distributor margin = Retailer Fee - Distributor Fee
4. Company earning = Distributor Fee

## Usage Examples

### 1. Create Global Scheme (Admin)

```typescript
import { createGlobalScheme } from '@/lib/mdr-scheme/scheme.service';

const result = await createGlobalScheme({
  mode: 'CARD',
  card_type: 'CREDIT',
  brand_type: 'VISA',
  rt_mdr_t1: 1.5,  // Retailer MDR T+1 = 1.5%
  dt_mdr_t1: 1.1,  // Distributor MDR T+1 = 1.1%
  // T+0 MDRs auto-calculated: rt_mdr_t0 = 2.5%, dt_mdr_t0 = 2.1%
});
```

### 2. Create Custom Scheme (Distributor)

```typescript
import { createRetailerScheme } from '@/lib/mdr-scheme/scheme.service';

const result = await createRetailerScheme({
  distributor_id: 'dist_123',
  retailer_id: 'ret_456',
  mode: 'UPI',
  retailer_mdr_t1: 1.8,
  retailer_mdr_t0: 2.8,
  distributor_mdr_t1: 1.2,
  distributor_mdr_t0: 2.2,
});
```

### 3. Calculate MDR for Transaction

```typescript
import { calculateMDR } from '@/lib/mdr-scheme/settlement.service';

const result = await calculateMDR({
  amount: 10000,
  settlement_type: 'T0',
  mode: 'CARD',
  card_type: 'CREDIT',
  brand_type: 'VISA',
  retailer_id: 'ret_456',
  distributor_id: 'dist_123',
});
```

## Webhook Configuration

### Razorpay Dashboard Setup

1. Go to Razorpay Dashboard → Settings → Webhooks
2. Add Webhook URL: `https://api.samedaysolution.in/api/razorpay/mdr-settlement`
3. Select Events:
   - `payment.captured` (required)
   - `payment.authorized` (optional)
   - `payment.failed` (optional)
4. Copy Webhook Secret to `RAZORPAY_WEBHOOK_SECRET`

### Payment Notes Required

When creating a Razorpay payment, include these in `notes`:

```json
{
  "settlement_type": "T0",  // or "T1"
  "retailer_id": "retailer_123",
  "distributor_id": "distributor_456"  // optional
}
```

## Cron Job Setup

### Option 1: Vercel Cron (Recommended)

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/settlement/run-t1",
      "schedule": "0 2 * * *"
    }
  ]
}
```

### Option 2: External Cron Service

Use a service like:
- **cron-job.org**
- **EasyCron**
- **GitHub Actions**

Schedule: Daily at 2 AM UTC

**Request**:
```bash
curl -X POST https://api.samedaysolution.in/api/settlement/run-t1 \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json"
```

## Safety Features

1. **Idempotency**: Prevents duplicate processing using `razorpay_payment_id`
2. **Row Locking**: Uses Supabase RPC functions for atomic operations
3. **Precision**: All amounts use 4 decimal precision
4. **Validation**: Prevents negative margins
5. **Error Handling**: Always returns 200 OK to prevent Razorpay retries
6. **Transaction Rollback**: Wallet updates are atomic

## Testing

### 1. Test Webhook Locally

```bash
# Use ngrok to expose local server
ngrok http 3000

# Update Razorpay webhook URL to ngrok URL
# Send test webhook
```

### 2. Test MDR Calculation

```typescript
// Test with different scenarios
const scenarios = [
  { mode: 'CARD', card_type: 'CREDIT', brand_type: 'VISA' },
  { mode: 'CARD', card_type: 'DEBIT', brand_type: 'MasterCard' },
  { mode: 'UPI' },
];
```

### 3. Test T+1 Settlement

```bash
# Manually trigger T+1 settlement
curl -X POST http://localhost:3000/api/settlement/run-t1 \
  -H "x-api-key: test_key" \
  -H "Content-Type: application/json"
```

## Frontend Integration

### Admin Interface
- Manage global schemes
- Auto-calculate T+0 = T+1 + 1%
- View all transactions

### Distributor Interface
- Create custom schemes for retailers
- Enter T+1 and T+0 MDR
- System validates: Retailer MDR >= Distributor MDR

### Retailer Interface
- Select settlement type (T+0 or T+1)
- See applicable MDR before payment
- View wallet balance

## Troubleshooting

### Issue: Webhook not receiving events
- Check Razorpay webhook URL configuration
- Verify `RAZORPAY_WEBHOOK_SECRET` is set
- Check server logs for signature verification errors

### Issue: MDR calculation fails
- Verify scheme exists for payment mode/card_type/brand_type
- Check if scheme is active
- Ensure retailer_id is provided in payment notes

### Issue: Wallet not credited
- Check if `add_ledger_entry` RPC function exists
- Verify wallet exists for user
- Check transaction settlement_status

### Issue: T+1 settlement not running
- Verify cron job is configured
- Check `SETTLEMENT_CRON_API_KEY` is set
- Verify transactions have `settlement_type = 'T1'` and `settlement_status = 'pending'`

## Support

For issues or questions, check:
1. Server logs for detailed error messages
2. Transaction records in `transactions` table
3. Wallet ledger entries in `wallet_ledger` table

## Next Steps

1. Run database migration: `supabase-mdr-scheme-engine-migration.sql`
2. Configure environment variables
3. Set up Razorpay webhook
4. Configure cron job for T+1 settlement
5. Test with sample transactions
6. Build frontend interfaces for Admin/Distributor/Retailer

