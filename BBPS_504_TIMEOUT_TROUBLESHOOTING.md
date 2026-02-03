# BBPS PayRequest 504 Gateway Timeout - Troubleshooting Guide

## Issue
Getting `504 Gateway Timeout` when calling payRequest API, while fetchBill works fine.

## ⚠️ CRITICAL FINDING
**Tested with amount "1" (smallest possible) - STILL TIMES OUT**
- This confirms the timeout is **NOT amount-related**
- The issue is with the payRequest endpoint itself or server infrastructure
- fetchBill works fine, but payRequest consistently times out regardless of amount

## Possible Causes

### 1. Server-Side Processing Delay (MOST LIKELY)
The Sparkup payRequest endpoint is taking longer than the nginx gateway timeout (typically 60 seconds) to process requests. This could be due to:
- Backend service hanging or slow database queries
- Third-party payment gateway integration delays
- reqId validation taking too long
- Server resource constraints

### 2. Request Format Issues
The request might be missing required fields or have incorrect format, causing the server to hang (though format looks correct based on API docs).

### 3. Network/Infrastructure Issues
- nginx gateway timeout (504 suggests nginx is timing out waiting for backend)
- Backend service not responding within timeout window
- Server overload on Sparkup's side
- Database connection issues

### 4. Endpoint-Specific Issue
The payRequest endpoint may have a bug or configuration issue that causes it to hang, while fetchBill works normally.

---

## Immediate Actions

### Step 1: Verify Request Format
Ensure your payRequest body matches **exactly** this format:

```json
{
    "name": "Utility",
    "sub_service_name": "Credit Card",
    "initChannel": "AGT",
    "amount": "100",
    "billerId": "ICIC00000NATSI",
    "billerName": "ICICI Credit Card",
    "inputParams": [
        {
            "paramName": "Last 4 digits of Credit Card Number",
            "paramValue": "0016"
        },
        {
            "paramName": "Registered Mobile Number",
            "paramValue": "9971969046"
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
    "reqId": "D0BO27F6604NG8MG6LL1QAJ2HB560311402"
}
```

**Critical Checks:**
- ✅ `billerName` is included (required per Jan 2026 update)
- ✅ `reqId` matches the one from fetchBill response
- ✅ `paymentInfo` format is correct for Cash mode
- ✅ All field names are exact (case-sensitive)
- ✅ `amount` is a string (not number)

### Step 2: Retry the Request
1. Wait 30-60 seconds
2. Use the **same reqId** from fetchBill
3. Retry the payRequest

**Note:** Some payment gateways have a time window for reqId validity (usually 5-15 minutes).

### Step 3: Try with Different Amount
Try with a smaller test amount (e.g., "1" or "10") to see if it's amount-related.

### Step 4: Check Request Headers
Ensure headers are correct:
```
partnerid: 240054
consumerkey: b2078d92ff9f8e9e
consumersecret: ba6fba9775548f71
Content-Type: application/json
```

---

## Postman-Specific Solutions

### Increase Timeout in Postman
1. Go to Postman Settings (⚙️)
2. Under **General** → **Request timeout**
3. Increase to **120000 ms** (2 minutes) or more
4. Retry the request

### Add Retry Logic (Postman Pre-request Script)
Add this to your payRequest Pre-request Script:

```javascript
// Set max retries
pm.environment.set("maxRetries", 3);
pm.environment.set("retryCount", 0);
```

### Add Better Error Handling (Postman Test Script)
Update your Test Script to handle 504:

```javascript
if (pm.response.code === 504) {
    console.log("⚠️ Gateway Timeout - Server is taking too long");
    console.log("💡 Suggestions:");
    console.log("1. Wait 30-60 seconds and retry");
    console.log("2. Verify reqId is still valid (use within 5-15 min of fetchBill)");
    console.log("3. Check if Sparkup server is experiencing issues");
    console.log("4. Try with a smaller amount");
} else if (pm.response.code === 200) {
    const jsonData = pm.response.json();
    if (jsonData.success) {
        console.log("✅ Payment successful!");
        console.log("Transaction ID:", jsonData.data?.transaction_id);
    } else {
        console.log("❌ Payment failed:", jsonData.message);
    }
}
```

---

## Alternative: Test with Minimal Request

Try this minimal request to isolate the issue:

```json
{
    "name": "Utility",
    "sub_service_name": "Credit Card",
    "initChannel": "AGT",
    "amount": "1",
    "billerId": "ICIC00000NATSI",
    "billerName": "ICICI Credit Card",
    "inputParams": [
        {
            "paramName": "Last 4 digits of Credit Card Number",
            "paramValue": "0016"
        },
        {
            "paramName": "Registered Mobile Number",
            "paramValue": "9971969046"
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
    "reqId": "D0BO27F6604NG8MG6LL1QAJ2HB560311402"
}
```

---

## Contact Sparkup Support - URGENT

**This is a server-side issue requiring immediate attention from Sparkup.**

Contact Sparkup support with the following evidence:

### 1. **Test Results:**
- ✅ fetchBill works perfectly (returns reqId and bill details)
- ❌ payRequest times out with 504 Gateway Timeout
- ❌ **Even with amount "1" (smallest possible) - STILL TIMES OUT**
- This proves the issue is NOT amount-related

### 2. **Request Details:**
```
Endpoint: POST https://api.sparkuptech.in/api/ba/bbps/payRequest
Partner ID: 240054
Biller ID: ICIC00000NATSI
Biller Name: ICICI Credit Card
reqId: [from fetchBill response]
Amount tested: "1" (and also tried with full bill amount)
```

### 3. **Error Details:**
- Error: 504 Gateway Timeout
- Server: nginx/1.18.0 (Ubuntu)
- Response: HTML error page (not JSON)
- fetchBill response time: Normal (< 2 seconds)
- payRequest response time: Times out (exceeds nginx timeout, typically 60 seconds)

### 4. **Request Body Format:**
```json
{
    "name": "Utility",
    "sub_service_name": "Credit Card",
    "initChannel": "AGT",
    "amount": "1",
    "billerId": "ICIC00000NATSI",
    "billerName": "ICICI Credit Card",
    "inputParams": [
        {
            "paramName": "Last 4 digits of Credit Card Number",
            "paramValue": "0016"
        },
        {
            "paramName": "Registered Mobile Number",
            "paramValue": "9971969046"
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
    "reqId": "[reqId from fetchBill]"
}
```

### 5. **Questions for Sparkup:**
1. Is the payRequest endpoint experiencing issues?
2. What is the nginx timeout setting for /payRequest?
3. Is there a known issue with reqId validation taking too long?
4. Are there any backend service delays or outages?
5. Can you check server logs for requests with reqId: [latest reqId]?
6. Is there a different endpoint or method we should use?

---

## Common Fixes

### Fix 1: Use Fresh reqId
If you're reusing an old reqId, fetch a new bill and use the new reqId:

1. Run fetchBill again
2. Get new reqId
3. Use it immediately in payRequest

### Fix 2: Verify billerName Format
Ensure `billerName` matches exactly what Sparkup expects. Try:
- "ICICI Credit Card"
- "ICICI Bank Credit Card"
- Check Sparkup documentation for exact format

### Fix 3: Check Amount Format
Ensure amount is:
- A **string** (not number): `"100"` not `100`
- In **rupees** (not paise): `"100"` for ₹100

### Fix 4: Network/Proxy Issues
If behind a corporate proxy or firewall:
- Check if payRequest endpoint is accessible
- Verify SSL/TLS certificates
- Check firewall rules

---

## Expected Behavior

**Normal Flow:**
1. fetchBill → Returns reqId (works ✅)
2. payRequest with reqId → Should return success within 5-30 seconds
3. If timeout → Usually indicates server-side issue

**If 504 persists:**
- Likely Sparkup server issue
- Contact Sparkup support
- Check Sparkup status page (if available)

---

## Next Steps

1. ✅ Verify request format matches exactly
2. ✅ Increase Postman timeout
3. ✅ Retry with same reqId (within 5-15 min window)
4. ✅ Try with minimal amount
5. ✅ Contact Sparkup support if issue persists

