# Wallet, Ledger, Limits, Settlement & Admin Controls Integration

## Overview

This integration adds comprehensive wallet management, unified ledger, limits system, settlement, and admin controls **AROUND** the existing BBPS implementation. The existing BBPS code remains untouched.

## Key Features

### 1. Dual Wallet System
- **PRIMARY Wallet**: Holds ALL balances (cash/online/commission are fund categories, not separate wallets)
- **AEPS Wallet**: Isolated for AEPS financial transactions only

### 2. Unified Ledger
- Single ledger table with wallet_type, fund_category, service_type
- Real-time balance updates
- Full audit trail
- Supports: BBPS, AEPS, Settlement, POS, Admin operations

### 3. Limits System
- Per-transaction limits
- Daily transaction limits
- Daily settlement limits
- BBPS limit slabs (₹49,999 max enabled by default)
- Admin override capability

### 4. Settlement System
- Instant and T+1 modes
- Automatic charge calculation based on slabs
- Bank payout integration ready
- Settlement hold capability

### 5. Admin Controls
- Push/Pull funds (with fund_category selection)
- Freeze/Unfreeze wallets (PRIMARY and AEPS independently)
- Hold/Release settlement
- Lock/Unlock commission
- Transaction reversal
- Limit management
- BBPS slab enable/disable
- Full audit logging

### 6. Reversal Engine
- BBPS failure reversal
- AEPS failure reversal (post reconciliation)
- Settlement failure reversal
- Admin-initiated reversals
- Dispute handling with HOLD state

### 7. AEPS Integration
- Financial transactions (cash withdrawal, A2A) use AEPS wallet
- Non-financial transactions (balance inquiry, mini statement) don't touch wallet
- RRN, STAN, masked Aadhaar, bank IIN tracking

## Database Schema

### New Tables
- `wallets` - PRIMARY and AEPS wallets per user
- `user_limits` - Per-user, per-wallet limits
- `settlements` - Settlement requests and tracking
- `settlement_charge_slabs` - Settlement charge configuration
- `bbps_limit_slabs` - BBPS payment limit slabs
- `aeps_transactions` - AEPS transaction records
- `reversals` - Transaction reversal tracking
- `disputes` - Dispute management
- `admin_audit_log` - All admin actions with IP, before/after balances
- `mdr_config` - MDR configuration (final, includes GST)
- `commission_ledger` - Commission tracking

### Extended Tables
- `wallet_ledger` - Extended with wallet_type, fund_category, service_type, status, etc.

## API Endpoints

### Admin APIs

#### Wallet Management
- `POST /api/admin/wallet/push` - Push funds to wallet
- `POST /api/admin/wallet/pull` - Pull funds from wallet
- `POST /api/admin/wallet/freeze` - Freeze/Unfreeze wallet
- `POST /api/admin/wallet/settlement-hold` - Hold/Release settlement

#### Commission Management
- `POST /api/admin/commission/lock` - Lock/Unlock commission

#### Limits Management
- `POST /api/admin/limits/update` - Update user limits
- `POST /api/admin/bbps-slabs/update` - Enable/Disable BBPS slabs

#### Reversal
- `POST /api/admin/reversal/create` - Reverse any transaction

### User APIs

#### Settlement
- `POST /api/settlement/create` - Create settlement request

#### AEPS
- `POST /api/aeps/transaction/create` - Create AEPS transaction

#### Reports
- `GET /api/reports/ledger` - Ledger report with filters
- `GET /api/reports/transactions` - Transaction report with filters

## Integration Points

### BBPS Integration
The existing BBPS payment flow is wrapped with:
- Limits checking before payment
- Unified ledger for wallet operations
- Automatic reversal on failure

**BBPS code remains unchanged** - integration is via database functions and wrapper services.

### Wallet Operations
All wallet operations use the unified ledger:
- Real-time balance calculation
- Row-level locking for concurrency
- Idempotency support

## Fund Categories

Fund categories are **reference types only**, not separate balances:
- `cash` - Cash deposits
- `online` - Online transfers
- `commission` - Commission earnings
- `settlement` - Settlement operations
- `adjustment` - Admin adjustments
- `aeps` - AEPS transactions
- `bbps` - BBPS transactions
- `other` - Other operations

## MDR & Commission

- MDR values are **FINAL and INCLUDE GST** (no GST calculation)
- Commission hierarchy: Retailer ≥ Distributor ≥ Master Distributor ≥ Admin
- Commission credited to PRIMARY wallet with fund_category = commission
- Commission can be locked by admin

## Limits Configuration

### Default BBPS Limits
- Slab 1: ₹0 - ₹49,999 (ENABLED by default)
- Slab 2: ₹50,000 - ₹99,999 (DISABLED)
- Slab 3: ₹100,000 - ₹199,999 (DISABLED)
- Slab 4: ₹200,000 - ₹499,999 (DISABLED)
- Slab 5: ₹500,000 - ₹999,999 (DISABLED)

### Settlement Charges (Final, No GST)
- ₹0 - ₹49,999 → ₹20
- ₹50,000 - ₹99,999 → ₹30
- ₹1,00,000 - ₹1,49,999 → ₹50
- ₹1,50,000 - ₹1,84,999 → ₹70

## Migration Steps

1. **Run Database Migration**
   ```sql
   -- Run supabase-schema-wallet-ledger-integration.sql
   ```

2. **Initialize Wallets**
   - Wallets are auto-created on first use
   - Existing retailers get PRIMARY wallets with current balance

3. **Configure Limits**
   - Set default limits via admin panel
   - Enable/disable BBPS slabs as needed

4. **Test Integration**
   - Test BBPS payments with limits
   - Test settlement flow
   - Test admin controls
   - Test reversals

## Security Features

- Row-level locking for wallet updates
- Idempotency keys for all financial operations
- Full audit trail for admin actions
- IP address logging
- Before/after balance tracking
- Role-based access control

## Reporting

Reports support:
- Date range filtering
- User/Role filtering
- Wallet type filtering
- Fund category filtering
- Service type filtering
- Status filtering
- Export formats: JSON, CSV (PDF/ZIP can be added)

## Notes

- **DO NOT modify existing BBPS code**
- All wallet operations use integer arithmetic (paise)
- Balance is always derived from ledger (single source of truth)
- Commission is credited only after successful transaction
- AEPS funds never mix with PRIMARY wallet
- Settlement is from PRIMARY wallet only
- Admin can override all limits

## Future Enhancements

- PDF report generation
- ZIP bulk export
- Real-time notifications
- Webhook support
- Advanced analytics dashboard
- Commission calculation automation
- MDR rate management UI

