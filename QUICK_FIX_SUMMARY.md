# Quick Fix: Credit Card Payment - billerName Required Error

## Problem
You're getting: `"billerName Is required"` because `billerId` and `billerName` are empty strings.

## Solution in 3 Steps

### Step 1: Get Your Bank's Biller ID
Run the new **"0. Get Credit Card Billers"** request in Postman to find your bank's `billerId` and `billerName` using the BBPS API.

**Example Response:**
```json
{
    "success": true,
    "msg": "Detail Fetched",
    "data": [
        {
            "billerId": "KOTA00000NATED",      ← Use this directly
            "billerName": "Kotak Credit Card"   ← Use this directly
        }
    ]
}
```

**Note:** This endpoint (`POST /api/ba/billerInfo/getDataBybillerCategory`) returns `billerId` and `billerName` in the exact format needed for payRequest!

### Step 2: Fetch Bill (Already in your collection)
Use the `billerId` from Step 1. This will give you a `reqId`.

### Step 3: Pay Request (CORRECTED)
Use the `billerId`, `billerName` from Step 1, and `reqId` from Step 2.

**Your Corrected Request:**
```json
{
    "name": "Utility",
    "sub_service_name": "Credit Card",
    "initChannel": "AGT",
    "amount": "500",
    "billerId": "KOTA00000NATED",        ← From Step 1
    "billerName": "ICIC",                 ← From Step 1
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
    "reqId": "42NFKEG9E7FCOC54LL9Q88KK2MI50631211"  ← From Step 2
}
```

## What Changed?

### ❌ Before (Your Request):
```json
{
    "billerId": "",
    "billerName": ""
}
```

### ✅ After (Corrected):
```json
{
    "billerId": "KOTA00000NATED",  // From Step 1
    "billerName": "ICIC"            // From Step 1
}
```

## Files Updated

1. **BBPS_API_Postman_Collection.json** - Added "0. Get Credit Card Billers" request
2. **BBPS_CREDIT_CARD_PAYMENT_GUIDE.md** - Complete guide with all 3 steps

## Next Steps

1. Import the updated Postman collection
2. Run "0. Get Credit Card Billers" to find your bank
3. Update environment variables with `billerId` and `billerName`
4. Run "1. Fetch Bill" to get `reqId`
5. Run "2. Pay Request" to make payment

That's it! 🎉

