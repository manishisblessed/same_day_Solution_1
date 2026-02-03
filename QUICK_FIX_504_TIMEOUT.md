# Quick Fix: 504 Gateway Timeout

## Immediate Steps to Try

### ✅ Step 1: Increase Postman Timeout
1. Click **Settings** (⚙️) in Postman
2. Go to **General** tab
3. Find **Request timeout**
4. Change from default to **120000** (2 minutes)
5. Click **Save**
6. Retry the payRequest

### ✅ Step 2: Verify Your Request Body
Make sure your payRequest body has **exactly** this format (use your actual reqId):

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

**Critical:** Replace `reqId` with the one from your fetchBill response!

### ✅ Step 3: Use Fresh reqId
1. Run **"1. Fetch Bill"** again
2. Copy the new `reqId` from response
3. Update your payRequest body with the new `reqId`
4. Retry immediately (within 1-2 minutes)

### ✅ Step 4: Try with Smaller Amount
Change `amount` to `"1"` to test if it's amount-related:

```json
"amount": "1"
```

### ✅ Step 5: Check Request Headers
Ensure these headers are set:
- `partnerid`: `240054`
- `consumerkey`: `b2078d92ff9f8e9e`
- `consumersecret`: `ba6fba9775548f71`
- `Content-Type`: `application/json`

---

## What the 504 Error Means

**504 Gateway Timeout** = The Sparkup server is taking longer than expected to respond.

**Common Causes:**
1. Server is processing (payment gateways can be slow)
2. Server is overloaded
3. Network issues
4. Request format issue causing server to hang

---

## If Still Failing

### Option A: Wait and Retry
- Wait 2-3 minutes
- Use a **fresh reqId** from a new fetchBill
- Retry

### Option B: Contact Sparkup
Email Sparkup support with:
- Error: 504 Gateway Timeout
- reqId: `D0BO27F6604NG8MG6LL1QAJ2HB560311402`
- Request body (full JSON)
- Timestamp of request
- Partner ID: 240054

---

## Updated Postman Collection

I've updated the Postman collection with:
- ✅ Better error handling for 504
- ✅ Pre-request validation
- ✅ Detailed troubleshooting messages

**Re-import the collection** to get the updates, or manually add the test scripts from `BBPS_504_TIMEOUT_TROUBLESHOOTING.md`.

---

## Success Indicators

You'll know it's working when you get:
- ✅ Status: `200 OK`
- ✅ Response: `{ "success": true, "status": "success" }`
- ✅ Transaction ID in response

Not:
- ❌ `504 Gateway Timeout`
- ❌ `"No fetch data found for given ref id"`

