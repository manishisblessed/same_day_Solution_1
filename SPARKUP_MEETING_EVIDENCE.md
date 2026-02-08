# SparkupX Meeting - Evidence & Logs

**Partner ID: 240054**  
**For Google Meet Screen Sharing**

---

## Evidence #1: BBPS payRequest Timeout

### Request Details
```
Endpoint: POST https://api.sparkuptech.in/api/ba/bbps/payRequest
Partner ID: 240054
Biller ID: SBIC00000NATDN (SBI Credit Card)
Request ID: UMAZITULJX6R9AT0DIZ5TNLGOGK1MRBD
Request Time: 2026-02-04 09:18:13.966 UTC
Response Time: 2026-02-04 09:19:14.890 UTC
Duration: 61 seconds
```

### Request Body (Correct Format)
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

### Error Response
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

### Server Logs
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

SparkUpTech BBPS Balance: ₹5,050, Lien: ₹0, Available: ₹5,050
```

---

## Evidence #2: Payout expressPay2 Timeout

### Request Details
```
Endpoint: POST https://api.sparkuptech.in/api/fzep/payout/expressPay2
Partner ID: 240054
Request ID: PAYQT1SD88TY60D5C7X
Request Time: 2026-02-04 09:33:52.426 UTC
Response Time: 2026-02-04 09:34:52.687 UTC
Duration: 60 seconds
```

### Request Body (Correct Format)
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

### Error Response
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

### Server Logs
```
[Payout API] POST /expressPay2
Request ID: PAYQT1SD88TY60D5C7X
Timestamp: 2026-02-04T09:33:52.426Z

[Payout API ERROR] {
  "api": "[Payout] POST /expressPay2",
  "reqId": "PAYQT1SD88TY60D5C7X",
  "error": "HTTP 504: Gateway Time-out",
  "timestamp": "2026-02-04T09:34:52.687Z"
}

[Payout] Transfer failed - no success or data: {
  success: false,
  error: 'Gateway Time-out',
  status: 504
}
```

---

## Evidence #3: Missing Account Verification API

### Available Endpoints (from payout.txt)
```
1. POST /api/fzep/payout/bankList ✅
2. POST /api/fzep/payout/expressPay2 ✅
3. POST /api/fzep/payout/statusCheck ✅
4. GET /api/wallet/getBalance ✅
```

### Missing Endpoint
```
❌ POST /api/fzep/payout/accountVerify (or similar)
❌ Account Verification / Penny Drop API
```

### bankList Response Shows Support
```json
{
  "id": 1105,
  "bankName": "HDFC BANK LTD.",
  "isACVerification": true,  // ← Indicates support
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
- Kotak Bank
- And 50+ more banks

**Contradiction:** Banks show they support verification, but no API endpoint exists to perform it.

---

## Technical Comparison

### Our Infrastructure
```
Server: EC2 (Ubuntu 22.04)
nginx timeout: 180 seconds ✅
Client timeout: 
  - BBPS: 90 seconds ✅
  - Payout: 120 seconds ✅
```

### SparkupX Infrastructure (from errors)
```
Server: nginx/1.18.0 (Ubuntu)
nginx timeout: ~60 seconds ❌ (TOO SHORT)
```

### Request Flow
```
[Our Server] 
  ↓ Request sent (correct format)
[SparkupX nginx] 
  ↓ Request received
[SparkupX Backend] 
  ↓ Processing... (takes >60 seconds)
[SparkupX nginx] 
  ❌ TIMEOUT at 60 seconds
  ↓ 504 Gateway Time-out
[Our Server]
  ↓ Error received
[User] 
  ❌ Sees timeout error
```

---

## Analysis Summary

| Component | Status | Evidence |
|-----------|--------|----------|
| Request Format | ✅ Correct | All parameters present, matches docs |
| Authentication | ✅ Valid | Request reaches SparkupX API |
| Provider Balance | ✅ Sufficient | ₹5,050 available |
| Our Timeout | ✅ Sufficient | 120-180 seconds |
| **SparkupX Timeout** | ❌ **Too Short** | **~60 seconds** |

**Conclusion:** The issue is SparkupX's nginx timeout is too short for the processing time required.

---

## Impact Summary

### Business Impact
- **Duration:** 4+ hours of downtime (since 11:00 AM)
- **Affected Services:**
  - BBPS Credit Card payments ❌
  - Payout IMPS/NEFT transfers ❌
  - Account verification ❌
- **User Impact:** Cannot process payments/transfers
- **Revenue Impact:** Blocked transactions

### Technical Impact
- All requests are correctly formatted ✅
- All authentication is valid ✅
- All requests reach SparkupX API ✅
- SparkupX server times out before processing completes ❌

---

## Requested Solutions

### Immediate (Today)
1. **Increase nginx timeout** to 180 seconds for:
   - `/api/ba/bbps/payRequest`
   - `/api/fzep/payout/expressPay2`

2. **Clarify account verification API:**
   - Does it exist? (Yes/No)
   - If yes: Provide endpoint and docs
   - If no: Timeline for availability

### Short-term (This Week)
3. **Investigate backend processing delays:**
   - Why >60 seconds?
   - Can it be optimized?

4. **Provide timeout recommendations:**
   - Different values for different billers?
   - IMPS vs NEFT differences?

### Long-term (This Month)
5. **Optimize backend processing**
6. **Implement account verification API** (if doesn't exist)
7. **Update API documentation**

---

**End of Evidence Document**




