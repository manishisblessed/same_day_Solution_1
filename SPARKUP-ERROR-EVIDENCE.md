# Sparkup BBPS Payment Error Report

**Date:** January 28, 2026  
**Partner ID:** 240054  
**Reported By:** Same Day Solution Pvt. Ltd.

---

## Issue Summary

We are experiencing payment failures on the Sparkup BBPS API despite having sufficient wallet balance. Bill fetch operations work correctly, but actual payments are failing with error messages.

---

## Environment Details

| Parameter | Value |
|-----------|-------|
| API Base URL | https://api.sparkuptech.in/api/ba |
| Partner ID | 240054 |
| Environment | Production |
| EC2 IP (Whitelisted) | 44.193.29.59 |
| Sparkup Wallet Balance | ₹5,050.00 (Available) |

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

## What IS Working

1. ✅ **API Connection:** Successfully connecting to Sparkup API
2. ✅ **Authentication:** Credentials (Partner ID, Consumer Key, Consumer Secret) are valid
3. ✅ **IP Whitelist:** EC2 IP 44.193.29.59 is whitelisted
4. ✅ **Categories Fetch:** All 28 categories load correctly
5. ✅ **Billers List:** Billers for all categories load correctly
6. ✅ **Bill Fetch:** Bill details fetch successfully for consumers
7. ✅ **Wallet Balance:** Can query wallet balance (shows ₹5,050.00)

---

## What is NOT Working

1. ❌ **Bill Payment:** Fails with "Fund Issue" despite sufficient balance
2. ❌ **DTH Payments:** Fails with "No Service Found with (Utility)"
3. ❌ **Rate Limits:** Only 1 request per minute allowed (UAT restriction?)

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

---

## Requested Resolution

1. Enable live/production payment capability for our account
2. Enable DTH and other utility payment services
3. Remove or increase rate limiting for production use
4. Clarify if there are any holds on our wallet balance

---

## Contact Information

**Company:** Same Day Solution Pvt. Ltd.  
**Partner ID:** 240054  
**Technical Contact:** manish@shahworks.com

---

*This report was generated from server logs on January 28, 2026.*

