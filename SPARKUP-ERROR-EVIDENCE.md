# Sparkup API Error Report - BBPS & Payout Services

**Date:** January 28, 2026  
**Partner ID:** 240054  
**Reported By:** Same Day Solution Pvt. Ltd.

---

## Issue Summary

We are experiencing multiple issues with Sparkup APIs:
1. **BBPS Payments** - Failing with "Fund Issue" despite sufficient wallet balance (₹5,050)
2. **Payout API** - Transfer endpoints returning JavaScript errors
3. **Missing Endpoints** - Several payout endpoints return 404

---

## Environment Details

| Parameter | Value |
|-----------|-------|
| BBPS API Base URL | https://api.sparkuptech.in/api/ba |
| Payout API Base URL | https://api.sparkuptech.in/api/fzep/payout |
| Partner ID | 240054 |
| Environment | Production |
| EC2 IP (Whitelisted) | 44.193.29.59 |
| BBPS Wallet Balance | ₹5,050.00 |
| Payout Wallet Balance | ₹9.13 |

---

## Error Evidence

### Error 1: "Fund Issue"

**Request Type:** BBPS Bill Payment  
**Error Code:** 200 (API returned success but with error message)  
**Error Message:** `Fund Issue`

**Server Logs:**
```
❌ SPARKUP PAYMENT FAILED
Error Code: 200
Error Message: Fund Issue

=== SPARKUP PAYMENT STATUS CHECK ===
response.success: true
apiResponse.success: false
apiResponse.status: 200
apiResponse.message: Fund Issue
responseData.responseCode: undefined
responseData.responseReason: undefined
isSuccess: false
====================================
```

**Notes:**
- Wallet balance shows ₹5,050.00 available
- Bill amount attempted was within wallet limits
- Bill fetch was successful before payment attempt

---

### Error 2: "No Service Found with (Utility) - (DTH)"

**Request Type:** BBPS Bill Payment (DTH Category)  
**Error Code:** 200  
**Error Message:** `No Service Found with (Utility) - (DTH)`

**Server Logs:**
```
❌ SPARKUP PAYMENT FAILED
Error Code: 200
Error Message: No Service Found with (Utility) - (DTH)
```

**Notes:**
- DTH billers are visible and selectable (TATA Play, Airtel DTH, Dish TV, etc.)
- Bill fetch for DTH works correctly
- Only payment is failing

---

### Error 3: Rate Limiting (UAT Restriction)

**Request Type:** Multiple payment attempts  
**Error Code:** HTTP 429  
**Error Message:** `You can only make 1 requests in 00:01:00.0`

**Server Logs:**
```
[BBPS API ERROR] {
  "api":"POST /bbps/payRequest",
  "reqId":"3EDBOMP0JWG86R6I3T3UFGC3XFQI5CT4",
  "error":"HTTP 429: You can only make 1 requests in 00:01:00.0.",
  "timestamp":"2026-01-28T16:04:37.198Z",
  "billerId":"SBIC00000NATDN"
}
```

---

## PAYOUT API ISSUES (Express Pay)

### Error 4: Transfer API Bug - "Cannot read properties of undefined"

**Request Type:** POST /expressPay and /expressPay2  
**Error Code:** 200 (API returned success but with error)  
**Error Message:** `Cannot read properties of undefined (reading 'toUpperCase')`

**Test Request:**
```json
{
  "accountNumber": "919891896896",
  "ifsc": "KKBK0000262",
  "name": "Test User",
  "amount": "10",
  "mode": "IMPS",
  "remarks": "Test transfer",
  "clientRefId": "TEST-1738081234567"
}
```

**Response:**
```json
{
  "success": false,
  "status": 200,
  "message": "Cannot read properties of undefined (reading 'toUpperCase')",
  "data": {}
}
```

**Notes:**
- This is a JavaScript error in the Sparkup API code
- Both /expressPay and /expressPay2 endpoints return the same error
- The error suggests a required field is missing or named incorrectly

---

### Error 5: Missing Payout Endpoints (404 Not Found)

The following endpoints return 404 HTML error pages instead of JSON responses:

| Endpoint | Status |
|----------|--------|
| /accountVerify | ❌ 404 |
| /pennyDrop | ❌ 404 |
| /transactionStatus | ❌ 404 |

---

## PAYOUT API TEST RESULTS

| Endpoint | Status | Response |
|----------|--------|----------|
| /getBalance | ✅ Working | `{"balance": 9.13}` |
| /bankList | ✅ Working | Returns 200+ banks |
| /accountVerify | ❌ 404 | HTML 404 page |
| /pennyDrop | ❌ 404 | HTML 404 page |
| /expressPay | ⚠️ Bug | JS error in API |
| /expressPay2 | ⚠️ Bug | JS error in API |
| /transactionStatus | ❌ 404 | HTML 404 page |

---

## What IS Working

**BBPS API:**
1. ✅ **API Connection:** Successfully connecting to Sparkup API
2. ✅ **Authentication:** Credentials (Partner ID, Consumer Key, Consumer Secret) are valid
3. ✅ **IP Whitelist:** EC2 IP 44.193.29.59 is whitelisted
4. ✅ **Categories Fetch:** All 28 categories load correctly
5. ✅ **Billers List:** Billers for all categories load correctly
6. ✅ **Bill Fetch:** Bill details fetch successfully for consumers
7. ✅ **BBPS Wallet Balance:** Can query wallet balance (shows ₹5,050.00)

**Payout API:**
1. ✅ **getBalance:** Returns balance (₹9.13)
2. ✅ **bankList:** Returns full list of banks with IMPS/NEFT support

---

## What is NOT Working

**BBPS API:**
1. ❌ **Bill Payment:** Fails with "Fund Issue" despite sufficient balance (₹5,050)
2. ❌ **DTH Payments:** Fails with "No Service Found with (Utility)"
3. ❌ **Rate Limits:** Only 1 request per minute allowed (UAT restriction?)

**Payout API:**
1. ❌ **expressPay/expressPay2:** Returns JS error "Cannot read properties of undefined"
2. ❌ **accountVerify:** Endpoint returns 404 - doesn't exist
3. ❌ **pennyDrop:** Endpoint returns 404 - doesn't exist
4. ❌ **transactionStatus:** Endpoint returns 404 - doesn't exist
5. ❌ **Low Balance:** Payout wallet only has ₹9.13 (separate from BBPS wallet?)

---

## API Test Results

**Test Endpoint Response:**
```json
{
  "success": true,
  "status": 200,
  "credentialsConfigured": true,
  "environment": {
    "APP_ENV": "production",
    "NODE_ENV": "production",
    "USE_MOCK_MODE": false
  },
  "apiUrl": "https://api.sparkuptech.in/api/ba",
  "headers": {
    "partnerid": "Set",
    "consumerkey": "Set",
    "consumersecret": "Set"
  },
  "message": "BBPS API connection successful! Your EC2 IP is whitelisted and credentials are working."
}
```

---

## Questions for Sparkup Support

### BBPS API Questions:

1. **Fund Issue Error:**
   - Why are we receiving "Fund Issue" when our wallet shows ₹5,050 available?
   - Is there a minimum balance requirement?
   - Is there any hold/lien on our wallet that's not visible?

2. **DTH Service Error:**
   - Is DTH service enabled for Partner ID 240054?
   - What authorization is needed for DTH payments?
   - Why can we fetch DTH bills but not make payments?

3. **Account Status:**
   - Is our account in UAT/Test mode or Production mode?
   - Are there transaction limits on our account?
   - What services/categories are enabled for payments (not just bill fetch)?

4. **Rate Limiting:**
   - The 1 request per minute limit - is this expected for production?
   - How can we get higher rate limits for live operations?

### Payout API Questions:

5. **expressPay/expressPay2 Error:**
   - What is the correct request format for these endpoints?
   - Why is the API returning "Cannot read properties of undefined (reading 'toUpperCase')"?
   - What required fields are we missing?
   - Can you provide API documentation for the transfer endpoint?

6. **Missing Endpoints:**
   - Are /accountVerify, /pennyDrop, /transactionStatus endpoints available?
   - What are the correct endpoint URLs for:
     - Bank account verification
     - Transaction status checking
   - Can you provide complete API documentation for Payout services?

7. **Payout Wallet:**
   - Is the Payout wallet (₹9.13) separate from BBPS wallet (₹5,050)?
   - How do we top up the Payout wallet?
   - Is there a shared wallet option?

---

## Requested Resolution

### BBPS:
1. Enable live/production BBPS payment capability for our account
2. Enable DTH and other utility payment services
3. Remove or increase rate limiting for production use
4. Clarify if there are any holds on our wallet balance

### Payout:
5. Fix the expressPay/expressPay2 API bug that returns "Cannot read properties of undefined"
6. Enable/provide the missing endpoints (accountVerify, pennyDrop, transactionStatus)
7. Provide complete API documentation for Payout service
8. Clarify wallet structure (BBPS vs Payout) and how to top up each

---

## Contact Information

**Company:** Same Day Solution Pvt. Ltd.  
**Partner ID:** 240054  
**Technical Contact:** manish@shahworks.com

---

*This report was generated from server logs on January 28, 2026.*

