# Admin Capabilities - Complete Implementation

## Overview

This document outlines all admin capabilities implemented in the system. All admin actions are logged with:
- admin_id
- IP address
- action type
- before_balance
- after_balance
- remarks
- timestamp

## Implemented Features

### 1. Wallet Operations ✅

#### Push/Pull Balance
- **Endpoints:**
  - `POST /api/admin/wallet/push` - Push funds to wallet
  - `POST /api/admin/wallet/pull` - Pull funds from wallet
- **Supported Wallet Types:**
  - Primary wallet
  - AEPS wallet
- **Fund Categories:**
  - Cash
  - Online
  - Commission
  - Settlement
  - Adjustment
  - AEPS
  - BBPS
  - Other
- **User Types:**
  - Retailer
  - Distributor
  - Master Distributor

### 2. Commission Management ✅

#### Push/Pull Commission
- **Endpoints:**
  - `POST /api/admin/commission/push` - Add commission to user
  - `POST /api/admin/commission/pull` - Deduct commission from user
- **Features:**
  - Creates commission ledger entry
  - Updates wallet balance automatically
  - Full audit logging

### 3. MDR Adjustment ✅

#### Adjust MDR Within Caps
- **Endpoint:** `POST /api/admin/mdr/adjust`
- **MDR Caps:**
  - Retailer: 0.5% - 5%
  - Distributor: 0.3% - 3%
  - Master Distributor: 0.1% - 2%
- **Features:**
  - Validates MDR rate within allowed caps
  - Updates MDR rate for user
  - Full audit logging

### 4. Wallet Freeze ✅

#### Freeze/Unfreeze Wallets
- **Endpoint:** `POST /api/admin/wallet/freeze`
- **Wallet Types:**
  - Primary wallet
  - AEPS wallet
- **Features:**
  - Per wallet type freezing
  - Prevents transactions when frozen
  - Full audit logging

### 5. Settlement Hold ✅

#### Hold/Release Settlement
- **Endpoint:** `POST /api/admin/wallet/settlement-hold`
- **Features:**
  - Holds settlement for specific users
  - Prevents settlement processing
  - Full audit logging

### 6. Commission Lock ✅

#### Lock/Unlock Commission
- **Endpoint:** `POST /api/admin/commission/lock`
- **Features:**
  - Locks commission via fund_category
  - Prevents commission usage
  - Full audit logging

### 7. Transaction Reversal ✅

#### General Reversal
- **Endpoint:** `POST /api/admin/reversal/create`
- **Supported Types:**
  - BBPS transactions
  - AEPS transactions
  - Settlement transactions
  - Admin transactions
  - POS transactions

#### Specific Reversals
- **BBPS Failure Reversal:**
  - `POST /api/admin/reversal/bbps`
  - For BBPS transaction failures
- **AEPS Failure Reversal (Post Reconciliation):**
  - `POST /api/admin/reversal/aeps`
  - Includes reconciliation date
- **Settlement Failure Reversal:**
  - `POST /api/admin/reversal/settlement`
  - For settlement failures

### 8. Limits & Slabs Management ✅

#### Update Limits
- **Endpoint:** `POST /api/admin/limits/update`
- **Limit Types:**
  - Per transaction limit
  - Daily transaction limit
  - Daily settlement limit
- **Features:**
  - Enable/disable limits
  - Set limit amounts
  - Override flags

#### Override All Limits
- **Endpoint:** `POST /api/admin/limits/override`
- **Features:**
  - Override specific limit type
  - Override all limits for user
  - Requires override reason
  - Sets very high limit (999999999)

#### Activate/Deactivate Slabs
- **BBPS Slabs:**
  - `POST /api/admin/bbps-slabs/update`
  - Enable/disable BBPS limit slabs
- **Settlement Slabs:**
  - `POST /api/admin/settlement-slabs/update`
  - Enable/disable settlement charge slabs

### 9. Service Toggle ✅

#### Enable/Disable Services Per User
- **Endpoint:** `POST /api/admin/user/services/toggle`
- **Services:**
  - AEPS (Aadhaar Enabled Payment System)
  - BBPS (Bharat Bill Payment System)
- **Features:**
  - Per user service control
  - Prevents service usage when disabled
  - Full audit logging

### 10. Dispute Handling ✅

#### Handle Disputes with HOLD State
- **Endpoint:** `POST /api/admin/dispute/handle`
- **Actions:**
  - Hold - Puts transaction in HOLD state
  - Resolve - Resolves dispute
  - Reject - Rejects dispute
- **Features:**
  - Updates dispute status
  - Holds related ledger entries
  - Full audit logging

### 11. Real-time Reports ✅

#### View & Download Reports
- **Endpoint:** `GET /api/admin/reports`
- **Report Types:**
  - Transactions (BBPS, AEPS, Settlement)
  - Ledger entries
  - Commission ledger
  - Admin audit log
- **Formats:**
  - JSON
  - CSV (downloadable)
- **Filters:**
  - Date range (start/end)
  - User ID
  - User role
  - Limit (default: 10,000 records)

## Admin Audit Logging

All admin actions are logged in the `admin_audit_log` table with:

```typescript
{
  admin_id: string
  action_type: string
  target_user_id?: string
  target_user_role?: string
  wallet_type?: 'primary' | 'aeps'
  fund_category?: string
  amount?: number
  before_balance?: number
  after_balance?: number
  ip_address?: string
  user_agent?: string
  remarks?: string
  metadata?: Record<string, any>
  created_at: timestamp
}
```

### Action Types Logged:
- `wallet_push` - Push funds to wallet
- `wallet_pull` - Pull funds from wallet
- `wallet_freeze` - Freeze wallet
- `wallet_unfreeze` - Unfreeze wallet
- `settlement_hold` - Hold settlement
- `settlement_release` - Release settlement
- `commission_lock` - Lock commission
- `commission_unlock` - Unlock commission
- `commission_push` - Push commission
- `commission_pull` - Pull commission
- `mdr_adjust` - Adjust MDR rate
- `transaction_reverse` - Reverse transaction
- `bbps_failure_reversal` - BBPS failure reversal
- `aeps_failure_reversal` - AEPS failure reversal
- `settlement_failure_reversal` - Settlement failure reversal
- `dispute_hold` - Hold dispute
- `dispute_resolve` - Resolve dispute
- `dispute_reject` - Reject dispute
- `limit_override` - Override limits
- `bbps_slab_enable` - Enable BBPS slab
- `bbps_slab_disable` - Disable BBPS slab
- `settlement_slab_enable` - Enable settlement slab
- `settlement_slab_disable` - Disable settlement slab
- `aeps_enable` - Enable AEPS for user
- `aeps_disable` - Disable AEPS for user
- `bbps_enable` - Enable BBPS for user
- `bbps_disable` - Disable BBPS for user

## Admin UI

### Admin Capabilities Page
- **Location:** `/admin/capabilities`
- **Features:**
  - Tabbed interface for all admin capabilities
  - User selection dropdown
  - Action-specific modals
  - Real-time report downloads
  - Comprehensive action forms

### Tabs Available:
1. **Wallet Operations** - Links to wallet management page
2. **Commission** - Push/pull commission
3. **MDR Adjustment** - Adjust MDR rates with caps
4. **Limits & Overrides** - Override transaction limits
5. **Services Toggle** - Enable/disable AEPS & BBPS
6. **Slabs Management** - Activate/deactivate slabs
7. **Reversals** - Transaction reversals
8. **Disputes** - Dispute handling
9. **Reports** - Real-time reports download

## API Endpoints Summary

### Wallet Operations
- `POST /api/admin/wallet/push`
- `POST /api/admin/wallet/pull`
- `POST /api/admin/wallet/freeze`
- `POST /api/admin/wallet/settlement-hold`

### Commission Management
- `POST /api/admin/commission/push`
- `POST /api/admin/commission/pull`
- `POST /api/admin/commission/lock`

### MDR & Limits
- `POST /api/admin/mdr/adjust`
- `POST /api/admin/limits/update`
- `POST /api/admin/limits/override`

### Services & Slabs
- `POST /api/admin/user/services/toggle`
- `POST /api/admin/bbps-slabs/update`
- `POST /api/admin/settlement-slabs/update`

### Reversals
- `POST /api/admin/reversal/create`
- `POST /api/admin/reversal/bbps`
- `POST /api/admin/reversal/aeps`
- `POST /api/admin/reversal/settlement`

### Disputes
- `POST /api/admin/dispute/handle`

### Reports
- `GET /api/admin/reports`

## Security Features

1. **Admin Authentication:** All endpoints verify admin role
2. **IP Logging:** All actions log IP address
3. **Audit Trail:** Complete audit log for all actions
4. **Balance Tracking:** Before/after balance logged
5. **Validation:** Input validation on all endpoints
6. **Error Handling:** Comprehensive error handling

## Usage Examples

### Push Commission
```json
POST /api/admin/commission/push
{
  "user_id": "R123456",
  "user_role": "retailer",
  "amount": 1000,
  "remarks": "Bonus commission"
}
```

### Adjust MDR
```json
POST /api/admin/mdr/adjust
{
  "user_id": "D789012",
  "user_role": "distributor",
  "new_mdr_rate": 0.015,
  "remarks": "MDR adjustment"
}
```

### Override Limits
```json
POST /api/admin/limits/override
{
  "user_id": "R123456",
  "user_role": "retailer",
  "wallet_type": "primary",
  "limit_type": "per_transaction",
  "override_all": false,
  "override_reason": "Special approval for high-value transaction"
}
```

### Download Report
```
GET /api/admin/reports?type=transactions&format=csv&start=2024-01-01&end=2024-01-31
```

## Database Requirements

Ensure the following tables exist:
- `admin_audit_log` - For audit logging
- `wallets` - For wallet operations
- `wallet_ledger` - For transaction history
- `commission_ledger` - For commission tracking
- `reversals` - For reversal tracking
- `disputes` - For dispute management
- `user_limits` - For limit management
- `bbps_limit_slabs` - For BBPS slabs
- `settlement_charge_slabs` - For settlement slabs

## Notes

1. All admin actions require admin authentication
2. All actions are logged in `admin_audit_log`
3. IP address is captured from request headers
4. Balance changes are tracked (before/after)
5. All endpoints return success/error responses
6. Error handling prevents partial state changes

