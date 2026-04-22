# Partner T+1 Settlement Implementation - Complete

## Overview

Successfully implemented T+1 settlement for B2B partners with independent MDR scheme configuration and separate cron scheduling. Partners now receive daily settlement of their transactions (T+1) with MDR deducted based on their assigned scheme.

## Implementation Summary

### 1. Database Migration ✅
**File**: `supabase-pos-partner-settlement-migration.sql`

Created comprehensive database schema:
- **razorpay_pos_transactions** enhancements:
  - Added `partner_id` UUID column to track which partner owns a transaction
  - Added partner settlement columns: `partner_mdr_amount`, `partner_net_amount`, `partner_wallet_credited`, `partner_wallet_credit_id`
  - Added `settlement_type` column to mark transactions as T0/T1
  - Added `partner_auto_settled_at` timestamp
  - Created indexes for efficient querying of pending partner transactions

- **partner_schemes** table (new):
  - Stores MDR rates for each partner per payment mode/card type/brand
  - Supports CREDIT, DEBIT card types and VISA, MASTERCARD, RuPay, Amex, Diners brands
  - One active scheme per (partner_id, mode, card_type, brand_type) combination
  - T0 and T1 MDR rates separately configured

- **partner_t1_cron_settings** table (new):
  - Independent cron schedule for partner settlement (separate from retailer cron)
  - Configurable hour/minute/timezone
  - Enable/disable toggle
  - Tracks last run status and metrics

- **partners** table enhancement:
  - Added `t1_settlement_paused` flag for individual partner pause control

- **Helper functions**:
  - `get_paused_partner_ids()` - RPC to fetch paused partners
  - `get_partner_scheme()` - RPC to resolve MDR rates with fallback chain

### 2. Settlement Service Functions ✅
**File**: `lib/mdr-scheme/settlement.service.ts`

Added three new partner-specific functions:

- **`calculatePartnerMDR()`**
  - Calculates MDR for partner transactions
  - Queries `partner_schemes` table with fallback chain:
    1. Exact match (mode + card_type + brand_type)
    2. Card type only
    3. Mode only (fallback)
  - Returns partner_mdr %, partner_fee, settlement_amount, company_earning
  - No distributor chain (direct B2B)

- **`creditPartnerWallet()`**
  - Calls existing `credit_partner_wallet()` RPC
  - Tracks wallet credit with reference IDs
  - Includes full description of settlement
  - Returns wallet_credit_id for transaction tracking

- **`getPendingPartnerT1Transactions()`**
  - Fetches transactions ready for T+1 settlement
  - Filters by: settlement_type='T1', partner_wallet_credited=false, created_at < cutoff
  - Automatically excludes paused partners
  - Returns array of pending transactions with all details

### 3. Webhook Enhancement ✅
**File**: `app/api/razorpay/notification/route.ts`

Updated Razorpay POS webhook handler to populate partner information:
- When transaction is created, looks up pos_machines to find partner_id
- Stores partner_id on razorpay_pos_transactions record
- Sets settlement_type to 'T1' by default
- Enables identification of partner vs retailer transactions downstream

### 4. Partner T+1 Cron ✅
**File**: `lib/cron/t1-settlement-cron-partners.ts`

Standalone cron implementation for partner settlement:
- **`initPartnerT1SettlementCron()`** - Initializes and starts the cron
- **`runPartnerT1Settlement()`** - Main settlement logic:
  1. Fetches pending T+1 partner transactions
  2. Groups by partner for batch processing
  3. Calculates MDR for each transaction
  4. Credits partner wallet with batch amount
  5. Updates transaction records with settlement metadata
  6. Updates cron settings with run status
  7. Handles errors gracefully and continues
  
- **`triggerPartnerManualRun()`** - Manual trigger for admin
- **`stopPartnerT1SettlementCron()`** - Graceful shutdown
- Separate settings polling from retailer cron
- Configurable schedule with timezone support

### 5. Cron Initialization ✅
**File**: `instrumentation.ts`

Added partner cron initialization:
- Imports and initializes `initPartnerT1SettlementCron()` on Node.js runtime
- Runs alongside retailer cron and subscription cron
- Catches and logs initialization errors

### 6. Admin API Endpoints ✅

#### Partner Schemes Management
**File**: `app/api/admin/partner-schemes/route.ts`
- GET: List all partner schemes (optional filters: partner_id, status)
- POST: Create new partner scheme
  - Validates MDR rates (0-100%)
  - Auto-deactivates existing active scheme for same partner/mode/card/brand combo
  - Enforces unique constraints
- PUT: Update existing scheme

#### Partner T+1 Cron Settings
**File**: `app/api/admin/settlement/partner-t1-cron-settings/route.ts`
- GET: Retrieve current cron settings
- POST: Update cron schedule and enable/disable
  - Validates schedule_hour (0-23) and schedule_minute (0-59)
  - Updates all settings atomically

#### Manual Settlement Run
**File**: `app/api/admin/settlement/partner-t1-run-now/route.ts`
- POST: Trigger manual partner T+1 settlement
- Returns processed/failed counts
- Prevents concurrent runs

#### Partner Pause Toggle
**File**: `app/api/admin/settlement/partner-t1-pause/route.ts`
- POST: Toggle pause flag for individual partner
- Returns updated partner record

### 7. Admin UI Component ✅
**File**: `components/PartnerT1SettlementControl.tsx`

React component for managing partner T+1 settlement:
- **Cron Control Section**:
  - Display current schedule and timezone
  - Edit hour/minute with validation
  - Toggle enable/disable
  - Manual run button with confirmation
  - Last run status and metrics display

- **Partner Schemes Section**:
  - Table view of all active schemes
  - Create new scheme form:
    - Partner ID input
    - Mode dropdown (CARD/UPI)
    - Card type dropdown (CREDIT/DEBIT/Any)
    - Brand dropdown (VISA/MASTERCARD/RUPAY/AMEX/Any)
    - MDR T0 and T1 percentage inputs
  - Status display for each scheme
  - Real-time updates

- **Features**:
  - Toast notifications for success/error
  - Disabled state for read-only mode
  - Smooth animations (Framer Motion)
  - Loading states
  - Error handling

### 8. Integration Tests ✅
**File**: `__tests__/partner-t1-settlement.test.ts`

Comprehensive Jest test suite covering:
- **MDR Calculation Tests**:
  - T+1 vs T+0 rates
  - Different card types and brands
  - Fallback scheme resolution
  - Non-existent partner handling
  - Decimal amount precision

- **Wallet Credit Tests**:
  - Successful credit operation
  - Ledger entry creation
  - Balance verification
  - Transaction type tracking

- **Pending Transactions Tests**:
  - Correct filtering of pending T+1 transactions
  - Paused partner exclusion
  - Already-credited transaction exclusion

- **MDR Accuracy Tests**:
  - Small/large transaction amounts
  - Various MDR percentages
  - Decimal precision validation

## Settlement Flow (End-to-End)

```
1. Razorpay POS Webhook
   ↓
2. Webhook Handler (notification/route.ts)
   - Receives transaction from POS device
   - Looks up device_serial → partner_id from pos_machines
   - Creates razorpay_pos_transactions record with:
     * partner_id (B2B partner UUID)
     * settlement_type = 'T1'
     * amount, card details, etc.
     * partner_wallet_credited = false
   ↓
3. T+1 Cron Trigger (t1-settlement-cron-partners.ts)
   - Runs on configured schedule (default 4:00 AM IST)
   - Fetches pending T+1 transactions from yesterday or earlier
   ↓
4. For Each Transaction
   - Call calculatePartnerMDR()
     * Look up partner_schemes for matching mode/card/brand
     * Calculate MDR amount based on partner's rate
     * Calculate settlement amount (amount - mdr)
   ↓
5. Batch Credit Partner Wallet
   - Group transactions by partner
   - Sum settlement amounts per partner
   - Call creditPartnerWallet() RPC
     * Updates partner_wallets balance
     * Creates ledger entry in partner_wallet_ledger
     * Returns wallet_credit_id
   ↓
6. Update Transaction Records
   - Set partner_wallet_credited = true
   - Store partner_wallet_credit_id
   - Store partner_mdr_amount, partner_net_amount
   - Set partner_auto_settled_at timestamp
   ↓
7. Complete
   - Update cron settings with run status
   - Log processed/failed counts
   - Ready for partner to view in dashboard
```

## Key Features

### No Distributor Chain
- Unlike retailers, partners are direct B2B relationships
- Company earns entire MDR amount (no margin split)
- Simpler settlement model

### Independent Cron Schedule
- Separate from retailer T+1 cron
- Can be enabled/disabled independently
- Configurable time and timezone
- Separate admin controls

### Flexible MDR Configuration
- Per partner scheme management
- Supports multiple modes (CARD, UPI)
- Supports card types (CREDIT, DEBIT, PREPAID)
- Supports brands (VISA, MC, RuPay, Amex, Diners)
- Fallback chain for flexible rate matching

### Individual Partner Controls
- Each partner can be paused independently
- Cron automatically skips paused partners
- Admin can toggle via API or UI

### Comprehensive Tracking
- All settlement data stored on transactions
- Ledger entries for complete audit trail
- Metrics tracked in cron settings
- Full error logging and recovery

## Deployment Checklist

- [ ] Run database migration: `supabase-pos-partner-settlement-migration.sql`
- [ ] Create partner schemes via API or UI for each B2B partner
- [ ] Configure cron schedule in `partner_t1_cron_settings` (default: 4:00 AM IST)
- [ ] Test with manual run via `/api/admin/settlement/partner-t1-run-now`
- [ ] Verify wallet credits in partner_wallet_ledger
- [ ] Enable cron via `partner_t1_cron_settings.is_enabled = true`
- [ ] Monitor logs for first few runs
- [ ] Communicate settlement schedule to partners

## Files Created/Modified

### Created:
1. `supabase-pos-partner-settlement-migration.sql` - Database schema
2. `lib/cron/t1-settlement-cron-partners.ts` - Partner settlement cron
3. `app/api/admin/partner-schemes/route.ts` - Scheme management API
4. `app/api/admin/settlement/partner-t1-cron-settings/route.ts` - Cron settings API
5. `app/api/admin/settlement/partner-t1-run-now/route.ts` - Manual run API
6. `app/api/admin/settlement/partner-t1-pause/route.ts` - Partner pause API
7. `components/PartnerT1SettlementControl.tsx` - Admin UI component
8. `__tests__/partner-t1-settlement.test.ts` - Integration tests

### Modified:
1. `lib/mdr-scheme/settlement.service.ts` - Added 3 partner functions
2. `app/api/razorpay/notification/route.ts` - Added partner_id lookup
3. `instrumentation.ts` - Added partner cron initialization

## Testing

Run integration tests:
```bash
npm test -- __tests__/partner-t1-settlement.test.ts
```

Manual testing:
1. Create test partner scheme via `/api/admin/partner-schemes`
2. Create test transaction with partner_id via webhook simulator
3. Trigger manual run via `/api/admin/settlement/partner-t1-run-now`
4. Verify wallet credited and ledger entry created

## Next Steps

- Train support team on partner scheme configuration
- Set up monitoring/alerts for cron failures
- Document partner-facing settlement confirmation process
- Consider dashboard enhancements for partner visibility
