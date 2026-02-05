# Email to SparkupX Support Team

**Subject:** URGENT: Account Verification API Missing & BBPS payRequest 504 Timeout Issues - Partner ID: 240054

---

**To:** SparkupX Support Team  
**From:** [Your Name/Company]  
**Date:** February 4, 2026  
**Priority:** URGENT

---

## Dear SparkupX Support Team,

We are facing two critical issues with your API services that are blocking our production operations. We request your immediate attention and resolution.

---

## Issue #1: Account Verification API Endpoint Missing (Payout Service)

### Problem Statement
We need to verify beneficiary account holder names before processing payout transfers, but we cannot find the account verification/penny drop API endpoint in your Express Pay Payout documentation.

### Current Situation
- **Documentation Reviewed:** `payout.txt` (Express Pay Payout Documentation)
- **Available Endpoints Found:**
  1. `POST /api/fzep/payout/bankList` ✅
  2. `POST /api/fzep/payout/expressPay2` ✅
  3. `POST /api/fzep/payout/statusCheck` ✅
  4. `GET /api/wallet/getBalance` ✅

- **Missing Endpoint:** Account Verification / Penny Drop API ❌

### Evidence from Bank List Response
The `bankList` API response includes an `isACVerification: true` flag for many banks (e.g., HDFC Bank, ICICI Bank, SBI), indicating that these banks **support** account verification. However, we cannot find the actual API endpoint to perform the verification.

**Example from bankList response:**
```json
{
  "id": 1105,
  "bankName": "HDFC BANK LTD.",
  "isACVerification": true,  // ← Indicates support, but no API endpoint available
  "isIMPS": true,
  "isNEFT": true
}
```

### Impact
- We cannot verify beneficiary names before transfers
- Risk of transferring to wrong accounts
- Cannot comply with banking best practices for payout verification

### Request
Please provide:
1. The correct API endpoint URL for account verification/penny drop
2. Complete request/response documentation
3. Required parameters and authentication headers
4. Expected response format including beneficiary name field

---

## Issue #2: BBPS payRequest API 504 Gateway Timeout (Credit Card Payments)

### Problem Statement
The BBPS `payRequest` API is consistently returning **504 Gateway Time-out** errors from your nginx server for Credit Card bill payments, even though the request is properly formatted and reaches your API.

### Evidence from Server Logs

**Request Details:**
- **Endpoint:** `POST https://api.sparkuptech.in/api/ba/bbps/payRequest`
- **Partner ID:** 240054
- **Biller ID:** SBIC00000NATDN (SBI Credit Card)
- **Request ID:** UMAZITULJX6R9AT0DIZ5TNLGOGK1MRBD
- **Request Timestamp:** 2026-02-04 09:18:13.966 UTC
- **Response Timestamp:** 2026-02-04 09:19:14.890 UTC
- **Duration:** ~61 seconds before timeout

**Error Response:**
```
HTTP Status: 504 Gateway Time-out
Server: nginx/1.18.0 (Ubuntu)

Response Body:
<html>
<head><title>504 Gateway Time-out</title></head>
<body>
<center><h1>504 Gateway Time-out</h1></center>
<hr><center>nginx/1.18.0 (Ubuntu)</center>
</body>
</html>
```

**Full Request Log:**
```
[BBPS API] POST /bbps/payRequest
Request ID: UMAZITULJX6R9AT0DIZ5TNLGOGK1MRBD
Biller ID: SBIC00000NATDN
Timestamp: 2026-02-04T09:18:13.966Z

=== SPARKUP PAY REQUEST - FULL REQUEST ===
Endpoint: POST /bbps/payRequest
reqId: UMAZITULJX6R9AT0DIZ5TNLGOGK1MRBD
billerId: SBIC00000NATDN
billerName: SBI Card
sub_service_name: Credit Card
paymentMode: Cash
quickPay: Y
amount: 1359.00 (₹1,359.00)
```

**Error Log:**
```
[BBPS API ERROR] {
  "api": "POST /bbps/payRequest",
  "reqId": "UMAZITULJX6R9AT0DIZ5TNLGOGK1MRBD",
  "error": "HTTP 504: <html>...504 Gateway Time-out...</html>",
  "timestamp": "2026-02-04T09:19:14.890Z",
  "billerId": "SBIC00000NATDN"
}
```

### Analysis
1. ✅ **Request Format:** Correct - All required parameters are present
2. ✅ **Authentication:** Valid - Request reaches your API
3. ✅ **Provider Balance:** Sufficient (₹5,050 available)
4. ✅ **Our Timeout:** 180 seconds (sufficient)
5. ❌ **Your Server:** nginx timeout at ~60 seconds

### Impact
- **Duration:** This issue has been occurring since 11:00 AM today (4+ hours)
- **Affected Billers:** Credit Card category (SBI Card, ICICI Credit Card, etc.)
- **Business Impact:** Cannot process credit card bill payments
- **User Experience:** Payment requests fail with timeout errors

### Request
Please:
1. **Increase nginx timeout** for BBPS payRequest endpoint (especially for Credit Card billers which may take longer)
2. **Investigate backend processing time** - Why is payRequest taking >60 seconds?
3. **Provide recommended timeout values** for different biller categories
4. **Confirm if Credit Card payments require special handling** or longer processing time

---

## Technical Details

**Partner/Merchant Information:**
- **Partner ID:** 240054
- **Consumer Key:** b2078d92ff9f8e9e
- **API Base URLs:**
  - BBPS: `https://api.sparkuptech.in/api/ba`
  - Payout: `https://api.sparkuptech.in/api/fzep/payout`

**Our Infrastructure:**
- Server: EC2 (Ubuntu 22.04)
- nginx timeout: 180 seconds (configured for BBPS APIs)
- Client timeout: 90 seconds (BBPS), 120 seconds (Payout)

**Affected Services:**
1. BBPS Credit Card Bill Payments
2. Payout Account Verification

---

## Requested Actions

### Immediate (Priority 1)
1. **Provide account verification API endpoint** for Payout service
2. **Fix 504 timeout** for BBPS payRequest (Credit Card billers)

### Short-term (Priority 2)
3. Share updated API documentation with account verification details
4. Provide timeout recommendations for different biller categories
5. Confirm if there are any rate limits or special requirements

---

## Contact Information

**For Technical Queries:**
- Email: [Your Technical Contact Email]
- Phone: [Your Phone Number]

**For Escalation:**
- Please escalate to your technical team lead if immediate resolution is not possible

---

## Additional Notes

- We have verified our code implementation against your documentation
- All requests are properly formatted with required headers
- Authentication credentials are valid and working
- The issues are on the API/service side, not our implementation

We appreciate your prompt attention to these critical issues and look forward to your response.

---

**Best Regards,**  
[Your Name]  
[Your Title]  
[Company Name]  
[Contact Information]

---

**Attachments:**
- Server logs excerpt (attached separately)
- API request/response examples (if needed)

