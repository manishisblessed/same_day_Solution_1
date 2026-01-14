# MDR Approval & Commission Calculation System

## Overview

This system implements a multi-level commission structure where:
- **Retailers** charge a certain MDR % to customers
- **Distributors** get commission based on the difference between retailer MDR and their approved MDR
- **Master Distributors** get commission based on the difference between distributor MDR and their approved MDR
- **Company/Admin** gets the remaining MDR

## Commission Calculation Example

**Scenario:**
- Retailer swipes ₹1,00,000 with MDR 2% (₹2,000 MDR)
- Distributor has approved MDR of 1.5% (₹1,500)
- Master Distributor has approved MDR of 1% (₹1,000)

**Result:**
- **Retailer** receives: ₹1,00,000 - ₹2,000 = **₹98,000** (settlement)
- **Distributor** commission: (2% - 1.5%) × ₹1,00,000 = **₹500**
- **Master Distributor** commission: (1.5% - 1%) × ₹1,00,000 = **₹500**
- **Company** receives: 1% × ₹1,00,000 = **₹1,000**

## Database Schema

### New Fields Added

#### Distributors Table
- `approved_mdr_rate` (DECIMAL): MDR rate approved by master distributor (e.g., 0.015 for 1.5%)
- `mdr_approved_by` (TEXT): Master distributor partner_id who approved
- `mdr_approved_at` (TIMESTAMP): When MDR was approved

#### Master Distributors Table
- `approved_mdr_rate` (DECIMAL): MDR rate approved by company/admin (e.g., 0.01 for 1%)
- `mdr_approved_by` (TEXT): Admin user ID who approved
- `mdr_approved_at` (TIMESTAMP): When MDR was approved

#### Retailers Table
- `retailer_mdr_rate` (DECIMAL): MDR rate charged to retailer (default 0.02 for 2%)

## Database Functions

### `calculate_commission_hierarchy()`
Calculates commissions for all levels in the hierarchy.

**Parameters:**
- `p_transaction_id`: Transaction UUID
- `p_transaction_type`: 'bbps', 'aeps', or 'pos'
- `p_gross_amount`: Gross transaction amount
- `p_retailer_id`: Retailer partner ID
- `p_distributor_id`: Distributor partner ID (optional)
- `p_master_distributor_id`: Master distributor partner ID (optional)

**Returns:** Commission records for distributor and master distributor

### `process_transaction_commission()`
Processes commission for a transaction:
1. Calculates commissions using `calculate_commission_hierarchy()`
2. Creates commission ledger entries
3. Credits commission to wallets
4. Updates wallet balances

## API Endpoints

### POST `/api/master-distributor/approve-mdr`
Approves MDR rate for a distributor.

**Request Body:**
```json
{
  "distributor_id": "D123456",
  "approved_mdr_rate": 0.015  // 1.5% as decimal
}
```

**Response:**
```json
{
  "success": true,
  "message": "MDR 1.50% approved successfully",
  "distributor": { ... }
}
```

## UI Components

### Master Distributor Dashboard - Network Tab

**Features:**
1. **MDR Column**: Shows approved MDR % for each distributor
2. **Approve MDR Button**: Opens modal to approve/update MDR rate
3. **MDR Approval Modal**: 
   - Shows current MDR (if approved)
   - Input field for new MDR rate (as percentage)
   - Approve button

**How to Use:**
1. Navigate to Master Distributor Dashboard → Network Tab
2. Select "Distributors" view
3. Click the Settings icon (⚙️) next to a distributor
4. Enter MDR rate (e.g., "1.5" for 1.5%)
5. Click "Approve MDR"

## Transaction Processing Flow

### POS Transaction (Razorpay)

1. **Transaction Created**: When a POS transaction is captured
2. **Retailer Wallet Credited**: Net amount (gross - MDR) credited to retailer
3. **Commission Calculated**: 
   - System calls `process_transaction_commission()`
   - Function calculates commissions for distributor and master distributor
   - Creates commission ledger entries
   - Credits commissions to respective wallets

### Commission Distribution

For each transaction:
1. **Retailer Settlement**: `gross_amount - (gross_amount × retailer_mdr_rate)`
2. **Distributor Commission**: `(retailer_mdr_rate - distributor_approved_mdr_rate) × gross_amount`
3. **Master Distributor Commission**: `(distributor_approved_mdr_rate - master_distributor_approved_mdr_rate) × gross_amount`
4. **Company Revenue**: `master_distributor_approved_mdr_rate × gross_amount`

## Commission Ledger

All commissions are tracked in `commission_ledger` table:
- `transaction_id`: Reference to the transaction
- `transaction_type`: 'bbps', 'aeps', or 'pos'
- `user_id`: Partner ID of commission recipient
- `user_role`: 'distributor' or 'master_distributor'
- `mdr_amount`: Total MDR charged
- `commission_rate`: Commission rate for this user
- `commission_amount`: Commission earned
- `is_locked`: Admin can lock commissions
- `ledger_entry_id`: Reference to wallet_ledger entry

## Setup Instructions

### 1. Run Database Migration

```sql
-- Run the migration file
\i supabase-mdr-approval-migration.sql
```

This will:
- Add MDR approval fields to distributors and master_distributors tables
- Add retailer_mdr_rate to retailers table
- Create commission calculation functions

### 2. Set Default MDR Rates

```sql
-- Set default retailer MDR rate (2%)
UPDATE retailers SET retailer_mdr_rate = 0.02 WHERE retailer_mdr_rate IS NULL;

-- Set default distributor approved MDR (1.5%)
UPDATE distributors SET approved_mdr_rate = 0.015 WHERE approved_mdr_rate IS NULL;

-- Set default master distributor approved MDR (1%)
UPDATE master_distributors SET approved_mdr_rate = 0.01 WHERE approved_mdr_rate IS NULL;
```

### 3. Approve MDR for Distributors

1. Login as Master Distributor
2. Go to Network Tab
3. Approve MDR rates for each distributor

### 4. Approve MDR for Master Distributors (Admin)

Admin can approve MDR for master distributors through admin panel (to be implemented).

## Testing

### Test Commission Calculation

```sql
-- Test with example values
SELECT * FROM calculate_commission_hierarchy(
  '00000000-0000-0000-0000-000000000001'::UUID,
  'pos',
  100000.00,
  'R123456',
  'D123456',
  'MD123456'
);
```

### Verify Commission Processing

```sql
-- Check commission ledger entries
SELECT * FROM commission_ledger 
WHERE transaction_id = 'your-transaction-id'
ORDER BY created_at;

-- Check wallet balances
SELECT * FROM wallets 
WHERE user_id IN ('D123456', 'MD123456')
AND wallet_type = 'primary';
```

## Notes

- MDR rates are stored as decimals (0.015 = 1.5%)
- Commission is automatically calculated and distributed when transactions are processed
- Commissions are credited to PRIMARY wallet with fund_category = 'commission'
- Commission ledger entries are created for audit trail
- Admin can lock/unlock commissions if needed

