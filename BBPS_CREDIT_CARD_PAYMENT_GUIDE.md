# BBPS Credit Card Payment - Complete Guide

## Problem
You're getting `"billerName Is required"` error because `billerId` and `billerName` are empty strings. You need to fetch these values first before making the payment request.

## Solution: Complete Flow

The correct flow is:
1. **Step 1**: Get list of Credit Card billers → Find your bank's `billerId` and `billerName`
2. **Step 2**: Fetch bill using `billerId` → Get `reqId` and bill amount
3. **Step 3**: Pay bill using `reqId` from Step 2

---

## Step 1: Get Credit Card Billers

**Endpoint:** `POST /api/ba/billerInfo/getDataBybillerCategory`

**Request:**
```http
POST https://api.sparkuptech.in/api/ba/billerInfo/getDataBybillerCategory
Headers:
  partnerid: 240XX
  consumerKey: 94a5336723c4cxxxx
  consumerSecret: 0498472da8b7xxx
  Content-Type: application/json

Body:
{
    "fieldValue": "Credit Card",
    "paymentChannelName1": "AGT",
    "paymentChannelName2": "",
    "paymentChannelName3": ""
}
```

**Postman cURL:**
```bash
curl --location 'https://api.sparkuptech.in/api/ba/billerInfo/getDataBybillerCategory' \
--header 'partnerid: 240XX' \
--header 'consumerKey: 94a5336723c4cxxxx' \
--header 'consumerSecret: 0498472da8b7xxx' \
--header 'Content-Type: application/json' \
--data '{
    "fieldValue": "Credit Card",
    "paymentChannelName1": "AGT",
    "paymentChannelName2": "",
    "paymentChannelName3": ""
}'
```

**Response Example:**
```json
{
    "success": true,
    "msg": "Detail Fetched",
    "data": [
        {
            "_id": "...",
            "billerId": "KOTA00000NATED",
            "billerName": "Kotak Credit Card",
            "billerCategory": "Credit Card",
            "billerAdhoc": "true",
            "billerInputParams": { ... }
        },
        {
            "_id": "...",
            "billerId": "ICIC00000NATSI",
            "billerName": "ICICI Credit Card",
            "billerCategory": "Credit Card",
            "billerAdhoc": "true",
            "billerInputParams": { ... }
        }
    ]
}
```

**Action:** Find your bank's biller from the list and note:
- `billerId` → Use this directly in payRequest
- `billerName` → Use this directly in payRequest (this endpoint returns the exact format needed!)

---

## Step 2: Fetch Bill

**Endpoint:** `GET /api/ba/bbps/fetchBill`

**Request:**
```http
GET https://api.sparkuptech.in/api/ba/bbps/fetchBill?reqId=TESTABCD1234567890EFGH12345678&billerId=KOTA00000NATED&inputParams[0][paramName]=Last%204%20digits%20of%20Credit%20Card%20Number&inputParams[0][paramValue]=6010&inputParams[1][paramName]=Registered%20Mobile%20Number&inputParams[1][paramValue]=9650582767&initChannel=AGT&paymentInfo[0][infoName]=Remarks&paymentInfo[0][infoValue]=Received&paymentMode=Cash
Headers:
  partnerid: 240XX
  consumerKey: 94a5336723c4cxxxx
  consumerSecret: 0498472da8b7xxx
```

**Postman cURL:**
```bash
curl --location 'https://api.sparkuptech.in/api/ba/bbps/fetchBill?reqId=TESTABCD1234567890EFGH12345678&billerId=KOTA00000NATED&inputParams[0][paramName]=Last%204%20digits%20of%20Credit%20Card%20Number&inputParams[0][paramValue]=6010&inputParams[1][paramName]=Registered%20Mobile%20Number&inputParams[1][paramValue]=9650582767&initChannel=AGT&paymentInfo[0][infoName]=Remarks&paymentInfo[0][infoValue]=Received&paymentMode=Cash' \
--header 'partnerid: 240XX' \
--header 'consumerKey: 94a5336723c4cxxxx' \
--header 'consumerSecret: 0498472da8b7xxx'
```

**Response Example:**
```json
{
    "success": true,
    "reqId": "42NFKEG9E7FCOC54LL9Q88KK2MI50631211",
    "data": {
        "billerResponse": {
            "billAmount": "100",
            "customerName": "John Doe",
            "dueDate": "2024-02-15"
        },
        "additionalInfo": {
            "info": [
                {
                    "infoName": "Minimum Amount Due",
                    "infoValue": "50"
                }
            ]
        }
    }
}
```

**Action:** Save the `reqId` from the response - you'll need it for Step 3!

---

## Step 3: Pay Bill (CORRECTED REQUEST)

**Endpoint:** `POST /api/ba/bbps/payRequest`

**Request:**
```http
POST https://api.sparkuptech.in/api/ba/bbps/payRequest
Headers:
  partnerid: 240XX
  consumerKey: 94a5336723c4cxxxx
  consumerSecret: 0498472da8b7xxx
  Content-Type: application/json

Body:
{
    "name": "Utility",
    "sub_service_name": "Credit Card",
    "initChannel": "AGT",
    "amount": "100",
    "billerId": "KOTA00000NATED",
    "billerName": "ICIC",
    "inputParams": [
        {
            "paramName": "Last 4 digits of Credit Card Number",
            "paramValue": "6010"
        },
        {
            "paramName": "Registered Mobile Number",
            "paramValue": "9650582767"
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
    "reqId": "42NFKEG9E7FCOC54LL9Q88KK2MI50631211"
}
```

**Postman cURL (Working Example from Sparkup):**
```bash
curl --location 'https://api.sparkuptech.in/api/ba/bbps/payRequest' \
--header 'partnerid: 240XX' \
--header 'consumerSecret: 0498472da8b7xxx' \
--header 'consumerKey: 94a5336723c4cxxxx' \
--header 'Content-Type: application/json' \
--data '{
    "name": "Utility",
    "sub_service_name": "Credit Card",
    "initChannel": "AGT",
    "amount": "100",
    "billerId": "KOTA00000NATED",
    "billerName": "ICIC",
    "inputParams": [
        {
            "paramName": "Registered Mobile Number",
            "paramValue": "8085539XX0"
        },
        {
            "paramName": "Last 4 digits of Credit Card Number",
            "paramValue": "1234"
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
    "reqId": "42NFKEG9E7FCOC54LL9Q88KK2MI50631211"
}'
```

---

## Key Differences from Your Request

### ❌ Your Request (WRONG):
```json
{
    "billerId": "",
    "billerName": ""
}
```

### ✅ Correct Request:
```json
{
    "billerId": "KOTA00000NATED",  // From Step 1
    "billerName": "ICIC",           // From Step 1 (short code)
    "reqId": "42NFKEG9E7FCOC54LL9Q88KK2MI50631211"  // From Step 2
}
```

---

## Common Biller IDs for Credit Cards

Based on the working example and common patterns:

| Bank | billerId | billerName |
|------|----------|------------|
| Kotak | `KOTA00000NATED` | `ICIC` or `Kotak` |
| ICICI | `ICIC00000NATSI` | `ICIC` or `ICICI Credit Card` |
| HDFC | `HDFC00000NATXX` | `HDFC` |
| SBI | `SBIN00000NATXX` | `SBI` |

**Note:** The `billerName` might be a short code (like "ICIC") rather than the full name. Check Step 1 response to see what format Sparkup expects.

---

## Complete Postman Collection

### Request 1: Get Credit Card Billers
```
Method: POST
URL: https://api.sparkuptech.in/api/ba/billerInfo/getDataBybillerCategory
Headers:
  partnerid: {{partnerid}}
  consumerKey: {{consumerKey}}
  consumerSecret: {{consumerSecret}}
  Content-Type: application/json

Body (raw JSON):
{
    "fieldValue": "Credit Card",
    "paymentChannelName1": "AGT",
    "paymentChannelName2": "",
    "paymentChannelName3": ""
}
```

### Request 2: Fetch Bill
```
Method: GET
URL: {{base_url}}/fetchBill?reqId=TESTABCD1234567890EFGH12345678&billerId={{billerId}}&inputParams[0][paramName]=Last%204%20digits%20of%20Credit%20Card%20Number&inputParams[0][paramValue]=6010&inputParams[1][paramName]=Registered%20Mobile%20Number&inputParams[1][paramValue]=9650582767&initChannel=AGT&paymentInfo[0][infoName]=Remarks&paymentInfo[0][infoValue]=Received&paymentMode=Cash
Headers:
  partnerid: {{partnerid}}
  consumerKey: {{consumerKey}}
  consumerSecret: {{consumerSecret}}
```

**Test Script (to save reqId):**
```javascript
if (pm.response.code === 200) {
    const jsonData = pm.response.json();
    if (jsonData.reqId) {
        pm.environment.set("reqId", jsonData.reqId);
        console.log("✅ Saved reqId:", jsonData.reqId);
    }
    if (jsonData.data?.billerResponse?.billAmount) {
        pm.environment.set("billAmount", jsonData.data.billerResponse.billAmount);
        console.log("💰 Bill Amount:", jsonData.data.billerResponse.billAmount);
    }
}
```

### Request 3: Pay Request
```
Method: POST
URL: {{base_url}}/payRequest
Headers:
  partnerid: {{partnerid}}
  consumerKey: {{consumerKey}}
  consumerSecret: {{consumerSecret}}
  Content-Type: application/json

Body (raw JSON):
{
    "name": "Utility",
    "sub_service_name": "Credit Card",
    "initChannel": "AGT",
    "amount": "{{billAmount}}",
    "billerId": "{{billerId}}",
    "billerName": "{{billerName}}",
    "inputParams": [
        {
            "paramName": "Last 4 digits of Credit Card Number",
            "paramValue": "6010"
        },
        {
            "paramName": "Registered Mobile Number",
            "paramValue": "9650582767"
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
    "reqId": "{{reqId}}"
}
```

---

## Environment Variables

Set these in Postman:

```
base_url: https://api.sparkuptech.in/api/ba/bbps
partnerid: 240XX
consumerKey: 94a5336723c4cxxxx
consumerSecret: 0498472da8b7xxx
billerId: KOTA00000NATED  (from Step 1)
billerName: ICIC          (from Step 1)
reqId:                    (auto-set from Step 2)
billAmount:               (auto-set from Step 2)
```

---

## Troubleshooting

### Error: "billerName Is required"
- **Cause:** `billerId` or `billerName` is empty
- **Fix:** Run Step 1 first to get the correct values

### Error: "No fetch data found"
- **Cause:** `reqId` is missing, expired, or doesn't match fetchBill
- **Fix:** Run Step 2 (fetchBill) again to get a fresh `reqId`, then immediately use it in Step 3

### Error: 504 Gateway Timeout
- **Cause:** Server-side processing delay
- **Fix:** 
  - Wait 30-60 seconds and retry
  - Use the same `reqId` from fetchBill (must be within 5-15 minutes)
  - Try with a smaller test amount first

---

## Quick Reference: Your Corrected Request

Replace your current request with this (using values from Steps 1 & 2):

```json
{
    "name": "Utility",
    "sub_service_name": "Credit Card",
    "initChannel": "AGT",
    "amount": "500",
    "billerId": "KOTA00000NATED",
    "billerName": "ICIC",
    "inputParams": [
        {
            "paramName": "Last 4 digits of Credit Card Number",
            "paramValue": "6010"
        },
        {
            "paramName": "Registered Mobile Number",
            "paramValue": "9650582767"
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
    "reqId": "42NFKEG9E7FCOC54LL9Q88KK2MI50631211"
}
```

**Remember:**
- `billerId` and `billerName` come from Step 1 (Get Billers)
- `reqId` comes from Step 2 (Fetch Bill)
- Use the `reqId` within 5-15 minutes of fetching the bill

