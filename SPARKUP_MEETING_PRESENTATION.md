# SparkupX API Issues - Meeting Documentation
**Partner ID: 240054**  
**Date: February 4, 2026**  
**Meeting Type: Technical Discussion**

---

## Meeting Agenda

1. **Introduction & Context** (2 minutes)
2. **Issue #1: Missing Account Verification API** (5 minutes)
3. **Issue #2: BBPS payRequest 504 Timeout** (5 minutes)
4. **Issue #3: Payout expressPay2 504 Timeout** (5 minutes)
5. **Technical Analysis & Evidence** (5 minutes)
6. **Questions & Solutions** (10 minutes)
7. **Action Items & Timeline** (3 minutes)

**Total Time: ~35 minutes**

---

## 1. Introduction & Context

### Who We Are
- **Partner ID:** 240054
- **Service:** Retailer Portal for BBPS Bill Payments & Payout Transfers
- **Integration Status:** Live in production
- **Issue Duration:** 4+ hours (since 11:00 AM today)

### Current Situation
We have **three critical issues** blocking our production operations:
1. Cannot verify beneficiary names before payout transfers
2. BBPS Credit Card payments timing out
3. Payout transfers timing out

All issues are related to **SparkupX API infrastructure**, not our implementation.

---

## 2. Issue #1: Missing Account Verification API

### Problem Statement
**We need to verify beneficiary account holder names before processing payout transfers, but the account verification API endpoint is missing from your documentation.**

### What We Found

#### ✅ Available Endpoints (from `payout.txt` documentation):
1. `POST /api/fzep/payout/bankList` ✅
2. `POST /api/fzep/payout/expressPay2` ✅
3. `POST /api/fzep/payout/statusCheck` ✅
4. `GET /api/wallet/getBalance` ✅

#### ❌ Missing Endpoint:
- **Account Verification / Penny Drop API** - NOT FOUND

### Evidence: Bank List Shows Support

**Example from `bankList` API response:**
```json
{
  "id": 1105,
  "bankName": "HDFC BANK LTD.",
  "isACVerification": true,  // ← Indicates banks SUPPORT verification
  "isIMPS": true,
  "isNEFT": true,
  "isPopular": true
}
```

**Many banks have `isACVerification: true`:**
- HDFC Bank
- ICICI Bank
- SBI
- Axis Bank
- And many more...

**This flag indicates banks support account verification, but we cannot find the API endpoint to actually perform it.**

### Current Workaround
- We're asking users to manually enter beneficiary names
- No verification charges are deducted (since no API exists)
- High risk of transferring to wrong accounts

### Impact
- ❌ Cannot verify beneficiary names before transfers
- ❌ Risk of transferring to wrong accounts
- ❌ Cannot comply with banking best practices
- ❌ Poor user experience

### Questions for SparkupX Team

1. **Does an account verification/penny drop API endpoint exist?**
   - If yes, what is the exact endpoint URL?
   - If no, is it planned for future release?

2. **What is the correct API endpoint for account verification?**
   - Is it `/accountVerify`?
   - Is it part of another endpoint?
   - Is it a different service entirely?

3. **What are the request/response formats?**
   - Required parameters?
   - Authentication headers?
   - Response structure (especially beneficiary name field)?

4. **What are the charges for account verification?**
   - Is it ₹1 penny drop?
   - Is it ₹4 as we assumed?
   - Who pays (retailer or SparkupX wallet)?

### Requested Solution
**Please provide:**
1. Complete API documentation for account verification
2. Endpoint URL and request format
3. Response structure with beneficiary name field
4. Pricing/charges information

---

## 3. Issue #2: BBPS payRequest 504 Timeout (Credit Card Payments)

### Problem Statement
**BBPS `payRequest` API is consistently returning 504 Gateway Time-out errors for Credit Card bill payments, even though requests are properly formatted and reach your API.**

### Evidence from Server Logs

#### Request Details:
```
Endpoint: POST https://api.sparkuptech.in/api/ba/bbps/payRequest
Partner ID: 240054
Biller ID: SBIC00000NATDN (SBI Credit Card)
Request ID: UMAZITULJX6R9AT0DIZ5TNLGOGK1MRBD
Request Time: 2026-02-04 09:18:13.966 UTC
Response Time: 2026-02-04 09:19:14.890 UTC
Duration: ~61 seconds before timeout
```

#### Error Response:
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

#### Full Request Sent (Verified Correct):
```json
{
  "name": "Utility",
  "sub_service_name": "Credit Card",
  "initChannel": "AGT",
  "amount": "1359.00",
  "billerId": "SBIC00000NATDN",
  "billerName": "SBI Card",
  "inputParams": [
    {
      "paramName": "Card Number",
      "paramValue": "XXXX"
    },
    {
      "paramName": "Mobile Number",
      "paramValue": "XXXX"
    }
  ],
  "mac": "01-23-45-67-89-ab",
  "custConvFee": "0",
  "billerAdhoc": "true",
  "paymentInfo": [
    {
      "infoName": "Payment Account Info",
      "infoValue": "Cash Payment"
    }
  ],
  "paymentMode": "Cash",
  "quickPay": "Y",
  "splitPay": "N",
  "reqId": "UMAZITULJX6R9AT0DIZ5TNLGOGK1MRBD"
}
```

#### Server Logs:
```
[BBPS API] POST /bbps/payRequest
Request ID: UMAZITULJX6R9AT0DIZ5TNLGOGK1MRBD
Biller ID: SBIC00000NATDN
Timestamp: 2026-02-04T09:18:13.966Z

[BBPS API ERROR] {
  "api": "POST /bbps/payRequest",
  "reqId": "UMAZITULJX6R9AT0DIZ5TNLGOGK1MRBD",
  "error": "HTTP 504: 504 Gateway Time-out",
  "timestamp": "2026-02-04T09:19:14.890Z",
  "billerId": "SBIC00000NATDN"
}
```

### Technical Analysis

| Component | Status | Details |
|-----------|--------|---------|
| Request Format | ✅ Correct | All required parameters present |
| Authentication | ✅ Valid | Request reaches SparkupX API |
| Provider Balance | ✅ Sufficient | ₹5,050 available |
| Our Timeout | ✅ 180 seconds | Sufficient for long operations |
| **SparkupX Timeout** | ❌ **~60 seconds** | **TOO SHORT** |

### Impact
- **Duration:** 4+ hours (since 11:00 AM)
- **Affected Billers:** Credit Card category (SBI Card, ICICI Credit Card, etc.)
- **Business Impact:** Cannot process credit card bill payments
- **User Experience:** Payment requests fail with timeout errors

### Questions for SparkupX Team

1. **Why is payRequest taking >60 seconds for Credit Card payments?**
   - Is this normal processing time?
   - Is there a backend issue causing delays?

2. **What is the recommended timeout for different biller categories?**
   - Credit Cards: ? seconds
   - Electricity: ? seconds
   - Other categories: ? seconds

3. **Can you increase nginx timeout for payRequest endpoint?**
   - Current: ~60 seconds
   - Recommended: 120-180 seconds

4. **Do Credit Card payments require special handling?**
   - Different timeout?
   - Different endpoint?
   - Special parameters?

### Requested Solution
**Please:**
1. Increase nginx timeout for BBPS payRequest (especially Credit Card billers)
2. Investigate why payRequest is taking >60 seconds
3. Provide timeout recommendations for different biller categories
4. Confirm if Credit Card payments need special handling

---

## 4. Issue #3: Payout expressPay2 504 Timeout

### Problem Statement
**Payout `expressPay2` API is also returning 504 Gateway Time-out errors, preventing IMPS/NEFT transfers from completing.**

### Evidence from Server Logs

#### Request Details:
```
Endpoint: POST https://api.sparkuptech.in/api/fzep/payout/expressPay2
Partner ID: 240054
Request ID: PAYQT1SD88TY60D5C7X
Request Time: 2026-02-04 09:33:52.426 UTC
Response Time: 2026-02-04 09:34:52.687 UTC
Duration: ~60 seconds before timeout
```

#### Error Response:
```
HTTP Status: 504 Gateway Time-out
Server: nginx/1.18.0 (Ubuntu)

[Payout API ERROR] {
  "api": "[Payout] POST /expressPay2",
  "reqId": "PAYQT1SD88TY60D5C7X",
  "error": "HTTP 504: Gateway Time-out",
  "timestamp": "2026-02-04T09:34:52.687Z"
}
```

#### Full Request Sent (Verified Correct):
```json
{
  "AccountNo": "5010XXXX0821",
  "AmountR": 999,
  "APIRequestID": 9876543210123456,
  "BankID": 1105,
  "BeneMobile": "9876543210",
  "BeneName": "manish",
  "bankName": "HDFC BANK LTD.",
  "IFSC": "HDFC0003756",
  "SenderEmail": "user@example.com",
  "SenderMobile": "9123456789",
  "SenderName": "sender name",
  "paymentType": "IMPS",
  "WebHook": "",
  "extraParam1": "NA",
  "extraParam2": "NA",
  "extraField1": "PAY-RET64519407-...",
  "sub_service_name": "ExpressPay",
  "remark": "Payout transfer to manish"
}
```

### Technical Analysis

| Component | Status | Details |
|-----------|--------|---------|
| Request Format | ✅ Correct | All required parameters present |
| Authentication | ✅ Valid | Request reaches SparkupX API |
| Provider Balance | ✅ Sufficient | ₹5,050 available |
| Our Timeout | ✅ 120 seconds | Sufficient for IMPS/NEFT |
| **SparkupX Timeout** | ❌ **~60 seconds** | **TOO SHORT** |

### Impact
- ❌ Cannot process IMPS/NEFT transfers
- ❌ Users see timeout errors even though transfers may be processing
- ❌ Business operations blocked for payout transfers

### Questions for SparkupX Team

1. **Why is expressPay2 taking >60 seconds to process?**
   - Is this normal for IMPS/NEFT?
   - Is there a backend processing delay?

2. **What is the recommended timeout for expressPay2?**
   - IMPS: ? seconds
   - NEFT: ? seconds

3. **Can you increase nginx timeout for expressPay2 endpoint?**
   - Current: ~60 seconds
   - Recommended: 120-180 seconds

4. **Do transfers actually process even if timeout occurs?**
   - Should we check status after timeout?
   - How to handle pending transfers?

### Requested Solution
**Please:**
1. Increase nginx timeout for expressPay2 endpoint
2. Investigate why expressPay2 is taking >60 seconds
3. Provide recommended timeout values for IMPS/NEFT
4. Clarify if transfers process despite timeout

---

## 5. Technical Analysis Summary

### Common Pattern Across All Issues

**All three issues show the same pattern:**
1. ✅ Our requests are correctly formatted
2. ✅ Authentication is valid
3. ✅ Requests reach SparkupX API
4. ✅ Provider balance is sufficient
5. ✅ Our timeouts are sufficient (120-180 seconds)
6. ❌ **SparkupX nginx times out at ~60 seconds**

### Infrastructure Details

**Our Setup:**
- Server: EC2 (Ubuntu 22.04)
- nginx timeout: 180 seconds (configured for BBPS/Payout APIs)
- Client timeout: 90 seconds (BBPS), 120 seconds (Payout)
- API Base URLs:
  - BBPS: `https://api.sparkuptech.in/api/ba`
  - Payout: `https://api.sparkuptech.in/api/fzep/payout`

**SparkupX Setup (from error responses):**
- Server: nginx/1.18.0 (Ubuntu)
- Current timeout: ~60 seconds
- **This is too short for the processing time required**

### Request Flow Analysis

```
[Our Server] 
  ↓ (Request sent correctly)
[SparkupX nginx] 
  ↓ (Request received)
[SparkupX Backend] 
  ↓ (Processing... takes >60 seconds)
[SparkupX nginx] 
  ❌ TIMEOUT at 60 seconds
  ↓ (504 Gateway Time-out returned)
[Our Server]
  ↓ (Error received)
[User sees timeout error]
```

**The issue is:** SparkupX backend processing takes longer than 60 seconds, but nginx times out before the response is ready.

---

## 6. Questions & Solutions Discussion

### Key Questions to Ask

#### About Account Verification API:
1. **Does account verification API exist?**
   - If yes: What is the endpoint?
   - If no: When will it be available?

2. **How should we verify beneficiary names?**
   - Manual entry only?
   - Third-party service?
   - Future API release?

3. **What about the `isACVerification: true` flag in bankList?**
   - What does it mean if there's no API?
   - Is it for future use?

#### About Timeout Issues:
1. **What is the actual processing time for these operations?**
   - Credit Card payments: ? seconds
   - IMPS transfers: ? seconds
   - NEFT transfers: ? seconds

2. **Can you increase nginx timeout?**
   - To what value? (120s? 180s? 300s?)
   - For which endpoints?

3. **Are there any rate limits or throttling?**
   - Could this be causing delays?
   - Should we implement retry logic?

4. **Do transfers/payments actually process despite timeout?**
   - Should we check status after timeout?
   - How to handle "pending" transactions?

### Proposed Solutions

#### Solution 1: Increase nginx Timeout (IMMEDIATE)
- **Action:** Increase SparkupX nginx timeout to 180 seconds
- **Endpoints:** 
  - `/api/ba/bbps/payRequest`
  - `/api/fzep/payout/expressPay2`
- **Impact:** Resolves timeout issues immediately

#### Solution 2: Provide Account Verification API (SHORT-TERM)
- **Action:** Provide account verification endpoint documentation
- **Timeline:** Within 1 week
- **Impact:** Enables proper beneficiary verification

#### Solution 3: Optimize Backend Processing (LONG-TERM)
- **Action:** Investigate why processing takes >60 seconds
- **Timeline:** 2-4 weeks
- **Impact:** Faster response times, better user experience

#### Solution 4: Provide Status Check Recommendations (IMMEDIATE)
- **Action:** Clarify if transactions process despite timeout
- **Documentation:** Best practices for handling timeouts
- **Impact:** Better error handling on our side

---

## 7. Action Items & Timeline

### Immediate Actions (Today/Tomorrow)

| Action | Owner | Timeline |
|--------|-------|----------|
| Increase nginx timeout for payRequest | SparkupX | Today |
| Increase nginx timeout for expressPay2 | SparkupX | Today |
| Clarify account verification API status | SparkupX | Tomorrow |
| Provide timeout recommendations | SparkupX | Tomorrow |

### Short-term Actions (This Week)

| Action | Owner | Timeline |
|--------|-------|----------|
| Provide account verification API docs | SparkupX | Within 1 week |
| Investigate backend processing delays | SparkupX | Within 1 week |
| Update API documentation | SparkupX | Within 1 week |

### Long-term Actions (This Month)

| Action | Owner | Timeline |
|--------|-------|----------|
| Optimize backend processing time | SparkupX | 2-4 weeks |
| Implement account verification API | SparkupX | 2-4 weeks |
| Provide comprehensive timeout guide | SparkupX | 2-4 weeks |

---

## 8. Evidence Summary

### Request IDs for Reference

**BBPS payRequest Timeout:**
- Request ID: `UMAZITULJX6R9AT0DIZ5TNLGOGK1MRBD`
- Biller: `SBIC00000NATDN` (SBI Credit Card)
- Timestamp: 2026-02-04 09:18:13 UTC

**Payout expressPay2 Timeout:**
- Request ID: `PAYQT1SD88TY60D5C7X`
- Timestamp: 2026-02-04 09:33:52 UTC

### Partner Information
- **Partner ID:** 240054
- **Consumer Key:** b2078d92ff9f8e9e
- **API Base URLs:**
  - BBPS: `https://api.sparkuptech.in/api/ba`
  - Payout: `https://api.sparkuptech.in/api/fzep/payout`

---

## 9. Meeting Notes Template

### Questions Asked:
1. 
2. 
3. 

### Answers Received:
1. 
2. 
3. 

### Commitments Made:
1. 
2. 
3. 

### Next Steps:
1. 
2. 
3. 

### Follow-up Date:
- Date: _______________
- Time: _______________
- Contact: _______________

---

## 10. Closing Statement

**We appreciate SparkupX's support and look forward to resolving these issues quickly.**

**Our priority is to:**
1. Get account verification API documentation (or confirmation it doesn't exist)
2. Resolve timeout issues so our users can process payments/transfers
3. Establish clear communication channels for future issues

**We're committed to working together to ensure smooth operations for both our businesses.**

---

## Appendix: Technical Details

### Our Implementation Status

✅ **Correctly Implemented:**
- Request formatting per API documentation
- Authentication headers
- Error handling
- Timeout configuration (120-180 seconds)
- Wallet balance checks
- Transaction logging

❌ **Blocked By:**
- Missing account verification API
- SparkupX server timeouts (60 seconds too short)

### Code References

**BBPS payRequest:**
- File: `services/bbps/payRequest.ts`
- Endpoint: `/api/ba/bbps/payRequest`
- Timeout: 90 seconds (client), 180 seconds (nginx)

**Payout expressPay2:**
- File: `services/payout/transfer.ts`
- Endpoint: `/api/fzep/payout/expressPay2`
- Timeout: 120 seconds (client), 180 seconds (nginx)

**Account Verification:**
- File: `services/payout/verifyAccount.ts`
- Status: Waiting for API endpoint from SparkupX

---


**End of Presentation Document**



