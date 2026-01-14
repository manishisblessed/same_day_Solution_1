# API Contracts

## Admin APIs

### 1. Push Funds to Wallet
**POST** `/api/admin/wallet/push`

**Request Body:**
```json
{
  "user_id": "string (required)",
  "user_role": "retailer | distributor | master_distributor (required)",
  "wallet_type": "primary | aeps (default: primary)",
  "fund_category": "cash | online | commission | settlement | adjustment | aeps | bbps | other (required)",
  "amount": "number (required, > 0)",
  "remarks": "string (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Funds pushed successfully",
  "ledger_id": "uuid",
  "before_balance": 0,
  "after_balance": 1000,
  "amount": 1000
}
```

### 2. Pull Funds from Wallet
**POST** `/api/admin/wallet/pull`

**Request Body:** (Same as push)

**Response:**
```json
{
  "success": true,
  "message": "Funds pulled successfully",
  "ledger_id": "uuid",
  "before_balance": 1000,
  "after_balance": 500,
  "amount": 500
}
```

### 3. Freeze/Unfreeze Wallet
**POST** `/api/admin/wallet/freeze`

**Request Body:**
```json
{
  "user_id": "string (required)",
  "wallet_type": "primary | aeps (default: primary)",
  "freeze": "boolean (default: true)",
  "remarks": "string (optional)"
}
```

### 4. Hold/Release Settlement
**POST** `/api/admin/wallet/settlement-hold`

**Request Body:**
```json
{
  "user_id": "string (required)",
  "hold": "boolean (default: true)",
  "remarks": "string (optional)"
}
```

### 5. Lock/Unlock Commission
**POST** `/api/admin/commission/lock`

**Request Body:**
```json
{
  "commission_id": "uuid (required)",
  "lock": "boolean (default: true)",
  "fund_category": "commission (default)",
  "remarks": "string (optional)"
}
```

### 6. Update Limits
**POST** `/api/admin/limits/update`

**Request Body:**
```json
{
  "user_id": "string (required)",
  "user_role": "retailer | distributor | master_distributor (required)",
  "wallet_type": "primary | aeps (default: primary)",
  "limit_type": "per_transaction | daily_transaction | daily_settlement (required)",
  "limit_amount": "number (required, >= 0)",
  "is_enabled": "boolean (default: true)",
  "is_overridden": "boolean (default: false)",
  "override_reason": "string (optional)"
}
```

### 7. Update BBPS Slabs
**POST** `/api/admin/bbps-slabs/update`

**Request Body:**
```json
{
  "slab_name": "slab_1 | slab_2 | slab_3 | slab_4 | slab_5 (required)",
  "is_enabled": "boolean (required)"
}
```

### 8. Create Reversal
**POST** `/api/admin/reversal/create`

**Request Body:**
```json
{
  "transaction_id": "uuid (required)",
  "transaction_type": "bbps | aeps | settlement | admin | pos (required)",
  "reason": "string (required)",
  "remarks": "string (optional)"
}
```

## User APIs

### 1. Create Settlement
**POST** `/api/settlement/create`

**Request Body:**
```json
{
  "amount": "number (required, > 0)",
  "bank_account_number": "string (required)",
  "bank_ifsc": "string (required)",
  "bank_account_name": "string (required)",
  "settlement_mode": "instant | t+1 (default: instant)"
}
```

**Response:**
```json
{
  "success": true,
  "settlement_id": "uuid",
  "amount": 10000,
  "charge": 20,
  "net_amount": 9980,
  "status": "success | failed"
}
```

### 2. Create AEPS Transaction
**POST** `/api/aeps/transaction/create`

**Request Body:**
```json
{
  "transaction_type": "balance_inquiry | cash_withdrawal | aadhaar_to_aadhaar | mini_statement (required)",
  "amount": "number (required for financial transactions)",
  "aadhaar_number_masked": "string (optional)",
  "bank_iin": "string (optional)",
  "rrn": "string (optional)",
  "stan": "string (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "transaction_id": "uuid",
  "status": "success | failed",
  "idempotency_key": "string"
}
```

## Reporting APIs

### 1. Ledger Report
**GET** `/api/reports/ledger`

**Query Parameters:**
- `date_from`: ISO date string (optional)
- `date_to`: ISO date string (optional)
- `user_id`: string (optional)
- `user_role`: retailer | distributor | master_distributor (optional)
- `wallet_type`: primary | aeps (optional)
- `fund_category`: cash | online | commission | settlement | adjustment | aeps | bbps | other (optional)
- `service_type`: bbps | aeps | settlement | pos | admin | other (optional)
- `status`: pending | completed | failed | reversed | hold (optional)
- `limit`: number (default: 100)
- `offset`: number (default: 0)
- `format`: json | csv (default: json)

**Response (JSON):**
```json
{
  "success": true,
  "data": [...],
  "total": 100,
  "limit": 100,
  "offset": 0
}
```

**Response (CSV):**
CSV file download

### 2. Transactions Report
**GET** `/api/reports/transactions`

**Query Parameters:**
- `date_from`: ISO date string (optional)
- `date_to`: ISO date string (optional)
- `service`: bbps | aeps | settlement | pos (optional, if not provided returns all)
- `status`: string (optional)
- `user_id`: string (optional)
- `limit`: number (default: 100)
- `offset`: number (default: 0)
- `format`: json | csv (default: json)

**Response:** Same format as ledger report

## Error Responses

All APIs return errors in the following format:

```json
{
  "error": "Error message",
  "details": "Optional additional details"
}
```

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (validation error)
- `401` - Unauthorized
- `403` - Forbidden (insufficient permissions or frozen wallet)
- `404` - Not Found
- `500` - Internal Server Error

## Authentication

All APIs require authentication via session cookies. Admin APIs require `role: 'admin'`.

## Rate Limiting

Consider implementing rate limiting for production:
- Admin APIs: Higher limits
- User APIs: Standard limits
- Reporting APIs: Lower limits for large exports

## Idempotency

Financial operations (settlement, AEPS) use idempotency keys. Retry with same key is safe.

