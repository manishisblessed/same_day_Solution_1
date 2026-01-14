# Distributor Features Implementation Guide

## Overview

This document outlines all the features implemented for distributors and the complete system setup.

## Features Implemented

### 1. Distributor Fund Transfer (Push/Pull)

**API Endpoint:** `POST /api/distributor/wallet/transfer`

**Features:**
- Distributor can push funds to retailer wallets
- Distributor can pull funds from retailer wallets
- Supports cash and online fund categories
- Validates retailer belongs to distributor
- Automatic wallet balance updates
- Transaction logging in wallet ledger

**Usage:**
```json
{
  "retailer_id": "R123456",
  "action": "push" | "pull",
  "amount": 10000,
  "fund_category": "cash" | "online",
  "remarks": "Optional remarks"
}
```

### 2. Commission Adjustment

**API Endpoint:** `POST /api/distributor/commission/adjust`

**Features:**
- Distributor can add commission to their earnings
- Distributor can deduct commission from their earnings
- Validates commission belongs to distributor
- Updates commission ledger
- Adjusts wallet balance automatically
- Transaction rollback on failure

**Usage:**
```json
{
  "retailer_id": "R123456",
  "commission_id": "uuid",
  "adjustment_amount": 500,
  "adjustment_type": "add" | "deduct",
  "remarks": "Adjustment reason"
}
```

### 3. Charge Slabs for BBPS & Settlement

**Charge Structure:**
- **Slab 1:** ₹0 - ₹49,999 → Charge: ₹20
- **Slab 2:** ₹50,000 - ₹99,999 → Charge: ₹30
- **Slab 3:** ₹1,00,000 - ₹1,49,999 → Charge: ₹50
- **Slab 4:** ₹1,50,000 - ₹1,84,999 → Charge: ₹70
- **Maximum Transaction Limit:** ₹2,00,000

**Database Tables:**
- `settlement_charge_slabs` - For settlement transactions
- `bbps_charge_slabs` - For BBPS transactions

**Function:** `calculate_transaction_charge(amount, transaction_type)`

### 4. Settlement for Retailers

**Features:**
- Retailers can request settlement (similar to BBPS)
- Automatic charge calculation based on amount slabs
- Maximum settlement limit: ₹2,00,000 per transaction
- Charge deducted from settlement amount
- Settlement status tracking

**API Endpoint:** `POST /api/settlement/create` (already exists)

### 5. Role-Based Admin Access

**Admin Roles:**
1. **master_admin** - Full access to all features
2. **admin** - Standard admin access (most features)
3. **support** - Limited access (view only)
4. **finance** - Financial operations (wallet, settlement, transactions)
5. **operations** - Operational tasks (user management, wallet freeze)

**Permission System:**
- Role-based permissions stored in `admin_role_permissions`
- Custom permissions in `admin_users.permissions` JSONB field
- Function: `check_admin_permission(admin_id, permission_key)`

**Permissions:**
- `wallet.push`, `wallet.pull`, `wallet.freeze`, `wallet.unfreeze`
- `wallet.settlement_hold`, `wallet.settlement_release`
- `user.create`, `user.edit`, `user.delete`, `user.activate`, `user.deactivate`
- `transaction.view`, `transaction.reverse`
- `commission.lock`, `commission.unlock`
- `settings.mdr`, `settings.limits`, `settings.charges`
- `reports.view`, `reports.export`

## Database Migrations Required

### 1. Run MDR Approval Migration
```sql
\i supabase-mdr-approval-migration.sql
```

### 2. Run Wallet Functions Migration
```sql
\i supabase-wallet-functions-migration.sql
```

### 3. Run Charge Slabs Migration
```sql
\i supabase-charge-slabs-migration.sql
```

### 4. Run Admin Roles Migration
```sql
\i supabase-admin-roles-migration.sql
```

## Commission Calculation Flow

### Example: ₹1,00,000 Transaction

**Assumptions:**
- Retailer MDR: 2% (₹2,000)
- Distributor Approved MDR: 1.5% (₹1,500)
- Master Distributor Approved MDR: 1% (₹1,000)

**Calculation:**
1. **Retailer Settlement:** ₹1,00,000 - ₹2,000 = **₹98,000**
2. **Distributor Commission:** (2% - 1.5%) × ₹1,00,000 = **₹500**
3. **Master Distributor Commission:** (1.5% - 1%) × ₹1,00,000 = **₹500**
4. **Company Revenue:** 1% × ₹1,00,000 = **₹1,000**

**Total MDR:** ₹2,000 (2% of transaction)

## BBPS Transaction with Charge

**Example: ₹50,000 BBPS Payment**

1. **Bill Amount:** ₹50,000
2. **Charge (Slab 2):** ₹30
3. **Total Debit:** ₹50,030
4. **Payment Made:** ₹50,000 to biller
5. **Charge Retained:** ₹30

## Settlement Transaction with Charge

**Example: ₹1,20,000 Settlement Request**

1. **Settlement Amount:** ₹1,20,000
2. **Charge (Slab 3):** ₹50
3. **Net Amount to Bank:** ₹1,19,950
4. **Total Debit from Wallet:** ₹1,20,000

## UI Updates

### Distributor Dashboard

1. **Network Tab:**
   - View all retailers
   - Push/Pull funds (cash/online)
   - View retailer details

2. **Commission Tab:**
   - View commission history
   - Adjust commission (add/deduct)
   - Commission statistics

### Retailer Dashboard

1. **Wallet Tab:**
   - Request settlement
   - View settlement history
   - Settlement charges displayed

## Testing Checklist

### Distributor Features
- [ ] Push funds to retailer (cash)
- [ ] Push funds to retailer (online)
- [ ] Pull funds from retailer (cash)
- [ ] Pull funds from retailer (online)
- [ ] Verify wallet balances update correctly
- [ ] Test commission adjustment (add)
- [ ] Test commission adjustment (deduct)
- [ ] Verify commission ledger updates

### Charge Slabs
- [ ] Test BBPS charge for ₹30,000 (₹20 charge)
- [ ] Test BBPS charge for ₹75,000 (₹30 charge)
- [ ] Test BBPS charge for ₹1,20,000 (₹50 charge)
- [ ] Test BBPS charge for ₹1,70,000 (₹70 charge)
- [ ] Test settlement charge for all slabs
- [ ] Verify maximum limit (₹2,00,000)

### Admin Roles
- [ ] Create master admin
- [ ] Create standard admin
- [ ] Create support admin
- [ ] Create finance admin
- [ ] Create operations admin
- [ ] Test permission checks for each role
- [ ] Verify master admin has all permissions

## Next Steps

1. **Run all migrations** in order
2. **Set default MDR rates** for existing users
3. **Create master admin** account
4. **Test all features** with sample data
5. **Configure charge slabs** if needed
6. **Set up admin roles** for your team

## Important Notes

- All amounts are in Indian Rupees (₹)
- MDR rates are stored as decimals (0.02 = 2%)
- Charges are calculated automatically based on amount slabs
- Commission is distributed automatically on transaction completion
- Admin permissions are checked on every API call
- All transactions are logged in audit logs

