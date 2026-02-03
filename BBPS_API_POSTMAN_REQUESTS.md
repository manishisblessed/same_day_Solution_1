# BBPS API Postman Test Requests

This document contains Postman-ready requests for testing the BBPS fetchBill and payRequest APIs after the Sparkup API update (Jan 2026).

---

## 1. Fetch Bill API

### Request Details
- **Method:** `POST`
- **URL:** `https://api.sparkuptech.in/api/ba/bbps/fetchBill`
- **Headers:**
  - `partnerid`: `240054`
  - `consumerkey`: `b2078d92ff9f8e9e`
  - `consumersecret`: `ba6fba9775548f71`
  - `Content-Type`: `application/json` (optional, as it uses query params)

### Query Parameters
```
reqId=TESTABCD1234567890EFGH12345678
billerId=ICIC00000NATSI
inputParams[0][paramName]=Last 4 digits of Credit Card Number
inputParams[0][paramValue]=0016
inputParams[1][paramName]=Registered Mobile Number
inputParams[1][paramValue]=9971969046
initChannel=AGT
paymentInfo[0][infoName]=Remarks
paymentInfo[0][infoValue]=Received
paymentMode=Cash
```

### Full URL (for Postman)
```
https://api.sparkuptech.in/api/ba/bbps/fetchBill?reqId=TESTABCD1234567890EFGH12345678&billerId=ICIC00000NATSI&inputParams[0][paramName]=Last%204%20digits%20of%20Credit%20Card%20Number&inputParams[0][paramValue]=0016&inputParams[1][paramName]=Registered%20Mobile%20Number&inputParams[1][paramValue]=9971969046&initChannel=AGT&paymentInfo[0][infoName]=Remarks&paymentInfo[0][infoValue]=Received&paymentMode=Cash
```

### Expected Response
```json
{
    "success": true,
    "status": "success",
    "message": "Bill fetched Successfully",
    "data": {
        "responseCode": "000",
        "inputParams": {
            "input": [
                {
                    "paramName": "Last 4 digits of Credit Card Number",
                    "paramValue": "0016"
                },
                {
                    "paramName": "Registered Mobile Number",
                    "paramValue": "9971969046"
                }
            ]
        },
        "billerResponse": {
            "billAmount": "29899958",
            "billDate": "2026-01-20",
            "customerName": "MANISH KUMAR SHAH",
            "dueDate": "2026-02-07"
        },
        "additionalInfo": {
            "info": [
                {
                    "infoName": "Minimum Amount Due",
                    "infoValue": "14950.00"
                },
                {
                    "infoName": "Current Outstanding Amount",
                    "infoValue": "299029.58"
                }
            ]
        }
    },
    "reqId": "LEI8FK16MNL5L947J5OIM562O9560301641"
}
```

**IMPORTANT:** Save the `reqId` from the response - you'll need it for the payRequest!

---

## 2. Pay Request API (Cash Mode)

### Request Details
- **Method:** `POST`
- **URL:** `https://api.sparkuptech.in/api/ba/bbps/payRequest`
- **Headers:**
  - `partnerid`: `240054`
  - `consumerkey`: `b2078d92ff9f8e9e`
  - `consumersecret`: `ba6fba9775548f71`
  - `Content-Type`: `application/json`

### Request Body (JSON)
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
    "reqId": "LEI8FK16MNL5L947J5OIM562O9560301641"
}
```

**IMPORTANT:** Replace `reqId` with the actual `reqId` from the fetchBill response!

### Expected Response (Success)
```json
{
    "success": true,
    "status": "success",
    "message": "Payment processed successfully",
    "data": {
        "responseCode": "000",
        "transaction_id": "UTR1313931773081",
        "status": "success"
    }
}
```

### Expected Response (Error - if reqId mismatch)
```json
{
    "success": false,
    "status": "error & refund",
    "message": "No fetch data found for given ref id.",
    "data": {
        "message": "No fetch data found for given ref id.",
        "responseCode": "204",
        "transaction_id": "UTR1313931773081",
        "status": "error"
    }
}
```

---

## 3. Pay Request API (Wallet Mode)

### Request Details
- **Method:** `POST`
- **URL:** `https://api.sparkuptech.in/api/ba/bbps/payRequest`
- **Headers:**
  - `partnerid`: `240054`
  - `consumerkey`: `b2078d92ff9f8e9e`
  - `consumersecret`: `ba6fba9775548f71`
  - `Content-Type`: `application/json`

### Request Body (JSON)
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
            "infoName": "WalletName",
            "infoValue": "Wallet"
        },
        {
            "infoName": "MobileNo",
            "infoValue": "9971969046"
        }
    ],
    "paymentMode": "Wallet",
    "quickPay": "Y",
    "splitPay": "N",
    "reqId": "LEI8FK16MNL5L947J5OIM562O9560301641"
}
```

**IMPORTANT:** 
- Replace `reqId` with the actual `reqId` from the fetchBill response!
- Replace `MobileNo` value with the actual customer mobile number

---

## Postman Collection Setup Instructions

### Step 1: Create Environment Variables
Create a Postman environment with these variables:
- `base_url`: `https://api.sparkuptech.in/api/ba/bbps`
- `partnerid`: `240054`
- `consumerkey`: `b2078d92ff9f8e9e`
- `consumersecret`: `ba6fba9775548f71`
- `billerId`: `ICIC00000NATSI`
- `billerName`: `ICICI Credit Card`
- `reqId`: (will be set from fetchBill response)

### Step 2: Fetch Bill Request
1. Create a new POST request
2. URL: `{{base_url}}/fetchBill`
3. Add query parameters as shown above
4. Add headers:
   - `partnerid`: `{{partnerid}}`
   - `consumerkey`: `{{consumerkey}}`
   - `consumersecret`: `{{consumersecret}}`
5. Add a **Test** script to save the reqId:
```javascript
if (pm.response.code === 200) {
    const jsonData = pm.response.json();
    if (jsonData.reqId) {
        pm.environment.set("reqId", jsonData.reqId);
        console.log("Saved reqId:", jsonData.reqId);
    }
}
```

### Step 3: Pay Request (Cash Mode)
1. Create a new POST request
2. URL: `{{base_url}}/payRequest`
3. Body: Raw JSON (use the Cash Mode body above)
4. Replace `reqId` in body with `{{reqId}}`
5. Add headers:
   - `partnerid`: `{{partnerid}}`
   - `consumerkey`: `{{consumerkey}}`
   - `consumersecret`: `{{consumersecret}}`
   - `Content-Type`: `application/json`

### Step 4: Pay Request (Wallet Mode)
1. Create a new POST request
2. URL: `{{base_url}}/payRequest`
3. Body: Raw JSON (use the Wallet Mode body above)
4. Replace `reqId` in body with `{{reqId}}`
5. Add headers (same as Cash Mode)

---

## Testing Checklist

- [ ] Fetch Bill API returns success with reqId
- [ ] Pay Request (Cash) includes `billerName` field
- [ ] Pay Request (Cash) has correct `paymentInfo` for Cash mode
- [ ] Pay Request (Cash) uses the reqId from fetchBill
- [ ] Pay Request (Cash) returns success (not "No fetch data found")
- [ ] Pay Request (Wallet) includes `billerName` field
- [ ] Pay Request (Wallet) has correct `paymentInfo` for Wallet mode (WalletName + MobileNo)
- [ ] Pay Request (Wallet) uses the reqId from fetchBill
- [ ] Pay Request (Wallet) returns success (not "No fetch data found")

---

## Common Issues & Solutions

### Issue: "No fetch data found for given ref id"
**Solution:** 
- Ensure you're using the exact `reqId` from the fetchBill response
- Make sure fetchBill was successful before calling payRequest
- Check that both requests use the same `billerId` and `inputParams`

### Issue: Missing billerName
**Solution:**
- Ensure `billerName` is included in the payRequest body
- Use the exact biller name format (e.g., "ICICI Credit Card")

### Issue: Wrong paymentInfo format
**Solution:**
- For Cash: Use `{ "infoName": "Payment Account Info", "infoValue": "Cash Payment" }`
- For Wallet: Use both `WalletName` and `MobileNo` entries
- Ensure `paymentMode` matches the `paymentInfo` structure

---

## Notes

1. **reqId is critical:** The `reqId` from fetchBill must be used in payRequest within a reasonable time window (typically a few minutes).

2. **billerName is now required:** Per Sparkup API update (Jan 2026), `billerName` must be included in payRequest.

3. **paymentInfo format changed:** The format now depends on `paymentMode`:
   - Cash: Single entry with "Payment Account Info"
   - Wallet: Two entries (WalletName + MobileNo)

4. **Test with real credentials:** Replace the example credentials with your actual Sparkup API credentials.

