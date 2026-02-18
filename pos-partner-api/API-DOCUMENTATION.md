# POS Partner API Documentation

**Version:** 1.0.0  
**Base URL:** `https://api.samedaysolution.in/api/partner`  
**Webhook URL:** `https://api.samedaysolution.in/api/webhook/razorpay-pos`

---

## Authentication

All partner API requests require HMAC-SHA256 authentication via headers:

| Header | Description |
|--------|-------------|
| `x-api-key` | Your public API key (starts with `pk_live_`) |
| `x-signature` | HMAC-SHA256 signature |
| `x-timestamp` | Unix timestamp in milliseconds |

### Signature Generation

```
signature = HMAC_SHA256(api_secret, JSON.stringify(body) + timestamp)
```

### Example (Node.js)

```javascript
const crypto = require('crypto');

const apiKey = 'pk_live_abc123...';
const apiSecret = 'sk_live_xyz789...';
const timestamp = Date.now().toString();
const body = { date_from: '2026-02-01', date_to: '2026-02-16' };

const signaturePayload = JSON.stringify(body) + timestamp;
const signature = crypto
  .createHmac('sha256', apiSecret)
  .update(signaturePayload)
  .digest('hex');

// Headers
const headers = {
  'Content-Type': 'application/json',
  'x-api-key': apiKey,
  'x-signature': signature,
  'x-timestamp': timestamp,
};
```

### Rejection Rules

| Condition | HTTP Status | Error Code |
|-----------|-------------|------------|
| Missing headers | 401 | UNAUTHORIZED |
| Invalid API key | 401 | UNAUTHORIZED |
| Invalid signature | 401 | UNAUTHORIZED |
| Timestamp older than 5 minutes | 401 | UNAUTHORIZED |
| Expired API key | 401 | UNAUTHORIZED |
| Inactive partner | 401 | UNAUTHORIZED |
| IP not whitelisted | 401 | UNAUTHORIZED |
| Missing permission | 403 | FORBIDDEN |

---

## Endpoints

### 1. POST /api/partner/pos-transactions

Fetch POS transactions with filters and pagination.

**Permission required:** `read`

#### Request Body

```json
{
  "date_from": "2026-02-01T00:00:00.000Z",
  "date_to": "2026-02-16T23:59:59.999Z",
  "status": "CAPTURED",
  "terminal_id": "96192813",
  "payment_mode": "CARD",
  "settlement_status": "PENDING",
  "page": 1,
  "page_size": 50
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `date_from` | ISO date | ✅ | Start date (max 90 days range) |
| `date_to` | ISO date | ✅ | End date |
| `status` | string | ❌ | AUTHORIZED, CAPTURED, FAILED, REFUNDED, VOIDED |
| `terminal_id` | string | ❌ | Filter by terminal |
| `payment_mode` | string | ❌ | CARD, UPI, NFC |
| `settlement_status` | string | ❌ | PENDING, SETTLED, FAILED |
| `page` | number | ❌ | Page number (default: 1) |
| `page_size` | number | ❌ | Records per page (default: 50, max: 100) |

#### Response

```json
{
  "success": true,
  "data": [
    {
      "id": 12345,
      "razorpay_txn_id": "260216093324974E883523117",
      "external_ref": "EZ202602161503118508",
      "terminal_id": "96192813",
      "amount": 10000,
      "status": "CAPTURED",
      "rrn": "000000000012",
      "card_brand": "VISA",
      "card_type": "CREDIT",
      "payment_mode": "CARD",
      "settlement_status": "PENDING",
      "device_serial": "2841157353",
      "txn_time": "2026-02-16T09:33:26.000Z",
      "created_at": "2026-02-16T09:33:27.000Z",
      "retailer_code": "RET001",
      "retailer_name": "Test Retailer"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 50,
    "total_records": 1250,
    "total_pages": 25,
    "has_next": true,
    "has_prev": false
  },
  "summary": {
    "total_transactions": 1250,
    "total_amount_paisa": 12500000,
    "total_amount_rupees": "125000.00",
    "authorized_count": 50,
    "captured_count": 1150,
    "failed_count": 30,
    "refunded_count": 20,
    "captured_amount_paisa": 11500000,
    "captured_amount_rupees": "115000.00",
    "terminal_count": 15
  }
}
```

---

### 2. POST /api/partner/pos-transactions/export

Create an asynchronous export job. Returns immediately with a job ID.

**Permission required:** `export`

#### Request Body

```json
{
  "format": "zip",
  "date_from": "2026-02-01",
  "date_to": "2026-02-16",
  "status": "CAPTURED",
  "terminal_id": null,
  "payment_mode": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `format` | string | ❌ | csv, excel, pdf, zip (default: csv) |
| `date_from` | ISO date | ✅ | Start date |
| `date_to` | ISO date | ✅ | End date (max 90 days from start) |
| `status` | string | ❌ | Filter by status |
| `terminal_id` | string | ❌ | Filter by terminal |
| `payment_mode` | string | ❌ | Filter by payment mode |

#### Response (HTTP 202)

```json
{
  "success": true,
  "message": "Export job created. Use the job_id to check status.",
  "job_id": "e4b5c6d7-8901-2345-6789-abcdef012345",
  "status": "PROCESSING",
  "format": "zip",
  "created_at": "2026-02-16T10:00:00.000Z",
  "exports_today": 3,
  "daily_limit": 10
}
```

#### Daily Limit Error (HTTP 429)

```json
{
  "success": false,
  "error": {
    "code": "EXPORT_LIMIT_EXCEEDED",
    "message": "Daily export limit reached (10/10). Try again tomorrow."
  }
}
```

---

### 3. GET /api/partner/export-status/:job_id

Check the status of an export job and get the download URL when complete.

**Permission required:** `read`

#### Response (Processing)

```json
{
  "success": true,
  "job": {
    "job_id": "e4b5c6d7-8901-2345-6789-abcdef012345",
    "status": "PROCESSING",
    "format": "zip",
    "file_url": null,
    "file_size_bytes": null,
    "total_records": null,
    "started_at": "2026-02-16T10:00:00.000Z",
    "completed_at": null,
    "created_at": "2026-02-16T10:00:00.000Z"
  }
}
```

#### Response (Completed)

```json
{
  "success": true,
  "job": {
    "job_id": "e4b5c6d7-8901-2345-6789-abcdef012345",
    "status": "COMPLETED",
    "format": "zip",
    "file_url": "https://sameday-pos-exports.s3.ap-south-1.amazonaws.com/...",
    "file_size_bytes": 245890,
    "total_records": 1250,
    "started_at": "2026-02-16T10:00:00.000Z",
    "completed_at": "2026-02-16T10:00:15.000Z",
    "expires_at": "2026-02-16T11:00:15.000Z",
    "created_at": "2026-02-16T10:00:00.000Z"
  }
}
```

---

### 4. POST /api/webhook/razorpay-pos (Webhook Endpoint)

Receives Razorpay POS transaction notifications. **Not called by partners.**

Configure this URL in your Razorpay POS dashboard.

#### Expected Payload

```json
{
  "txnId": "260216093324974E883523117",
  "tid": "96192813",
  "amount": 100,
  "status": "AUTHORIZED",
  "rrNumber": "000000000012",
  "paymentMode": "CARD",
  "paymentCardType": "CREDIT",
  "paymentCardBrand": "VISA",
  "postingDate": "2026-02-16T09:33:26.000+0000",
  "settlementStatus": "PENDING",
  "externalRefNumber": "EZ202602161503118508",
  "deviceSerial": "2841157353"
}
```

---

## Error Response Format

All errors follow a consistent format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Partner API (all) | 100 requests per minute |
| Export endpoints | 5 requests per minute |
| Webhook | 500 requests per minute |

---

## Health Check

**GET /health** - No authentication required.

```json
{
  "status": "ok",
  "service": "pos-partner-api",
  "version": "1.0.0",
  "timestamp": "2026-02-16T10:00:00.000Z"
}
```


