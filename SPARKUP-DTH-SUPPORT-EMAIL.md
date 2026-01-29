# Sparkup Support Request - DTH Payment "Fund Issue" Error

**Date:** January 29, 2026  
**Partner ID:** 240054  
**Company:** Same Day Solution Pvt. Ltd.  
**Contact:** ashvamlearningpvtltd@gmail.com  

---

## Subject: DTH Payment Failing with "Fund Issue" Despite Sufficient Wallet Balance - Partner ID 240054

---

Dear Sparkup Support Team,

We are experiencing an issue with DTH payments through your BBPS API. While DTH service is now enabled (thank you for that!), all payment attempts are failing with a **"Fund Issue"** error despite having sufficient wallet balance.

---

## Issue Summary

| Parameter | Value |
|-----------|-------|
| Error Message | "Fund Issue" |
| Service | DTH (TATA Play) |
| Biller ID | TATASKY00NAT01 |
| Wallet Balance | ₹5,050.00 |
| Lien Amount | ₹0.00 |
| Available Balance | ₹5,050.00 |
| Test Amount | ₹200 - ₹250 |
| Test Environment | Production (from whitelisted EC2 IP: 44.193.29.59) |

---

## Test Evidence

### 1. Wallet Balance Verification

**API Call:**
```
GET https://api.sparkuptech.in/api/wallet/getBalance
Headers:
  partnerid: 240054
  consumerkey: b2078d92ff9f8e9e
  consumersecret: ba6fba9775548f71
```

**Response:**
```json
{
  "success": true,
  "status": 200,
  "message": "Detail Fetched",
  "data": {
    "_id": "695b66d3c0d0b43380c3b42d",
    "balance": 5050,
    "lien": 0,
    "is_active": true,
    "first_name": "Santosh",
    "middle_name": "Kumar",
    "last_name": "Jha",
    "email": "ashvamlearningpvtltd@gmail.com",
    "mobile": "7389599958",
    "client_id": "240054"
  }
}
```

**Conclusion:** Wallet has ₹5,050 available with no lien.

---

### 2. DTH Billers Available

**API Call:**
```
GET https://api.sparkuptech.in/api/ba/billerId/getList?blr_category_name=DTH&limit=100
```

**Response (Summary):**
- Total DTH Billers: 6
- TATA Play: TATASKY00NAT01 ✅ Available

---

### 3. Biller Info - TATA Play

**API Call:**
```
POST https://api.sparkuptech.in/api/ba/bbps/fetchbillerInfo
Body: { "billerIds": "TATASKY00NAT01" }
```

**Response (Key Details):**
```json
{
  "billerId": "TATASKY00NAT01",
  "billerName": "TATA Play",
  "billerCategory": "DTH",
  "billerAdhoc": "true",
  "billerStatus": "ACTIVE",
  "billerFetchRequiremet": "NOT_SUPPORTED",
  "billerInputParams": {
    "paramInfo": [
      { "paramName": "Mobile Number", "dataType": "NUMERIC", "minLength": "10", "maxLength": "10" },
      { "paramName": "Subscriber Number", "dataType": "NUMERIC", "minLength": "10", "maxLength": "10" }
    ]
  },
  "paymentChanel": {
    "paymentChannelName": "AGT",
    "minAmount": "20000",
    "maxAmount": "3000000"
  }
}
```

**Conclusion:** Biller is ACTIVE, adhoc payments supported, min ₹200 / max ₹30,000

---

### 4. Payment Request (FAILING)

**API Call:**
```
POST https://api.sparkuptech.in/api/ba/bbps/payRequest
Headers:
  Content-Type: application/json
  partnerid: 240054
  consumerkey: b2078d92ff9f8e9e
  consumersecret: ba6fba9775548f71
```

**Request Body:**
```json
{
  "name": "Utility",
  "sub_service_name": "DTH",
  "initChannel": "AGT",
  "amount": "20000",
  "billerId": "TATASKY00NAT01",
  "inputParams": [
    { "paramName": "Subscriber Number", "paramValue": "1365519683" }
  ],
  "mac": "01-23-45-67-89-ab",
  "custConvFee": "0",
  "billerAdhoc": "true",
  "paymentInfo": [
    { "infoName": "Remarks", "infoValue": "Test Recharge" }
  ],
  "paymentMode": "Cash",
  "quickPay": "Y",
  "splitPay": "N",
  "reqId": "TESTDTH202601291769673717038"
}
```

**Response (ERROR):**
```json
{
  "success": false,
  "status": 200,
  "message": "Fund Issue",
  "data": {
    "success": false,
    "message": "Fund Issue"
  }
}
```

---

### 5. Multiple Test Attempts

| Request ID | Amount | Time (IST) | Result |
|------------|--------|------------|--------|
| IT0OXYVXHAZJNYR9NAC2MBTVDPBH3QB7 | ₹200 | 13:22 | Fund Issue |
| TESTDTH20260129080500007 | ₹200 | 13:35 | Fund Issue |
| TESTDTH202601291769673717038 | ₹200 | 13:41 | Fund Issue |
| TESTDTH202601291769673761111 | ₹250 | 13:43 | Fund Issue |

All tests performed from whitelisted EC2 IP: **44.193.29.59**

---

## Questions for Sparkup Team

1. **Why is "Fund Issue" occurring when wallet balance shows ₹5,050 available?**

2. **Is there a separate wallet/balance for DTH payments vs other BBPS services?**

3. **Does Partner ID 240054 have DTH payment enabled, or only DTH biller listing?**

4. **Are there any minimum balance requirements or reserves we're not aware of?**

5. **Is there a daily/monthly transaction limit that might have been exceeded?**

6. **Do we need to complete any additional configuration to enable DTH payments?**

---

## Previous Issue (Now Resolved)

Yesterday (January 28, 2026), we were getting error: **"No Service Found with (Utility) - (DTH)"**

This error is now **RESOLVED** - DTH billers are visible and payment requests are being processed. However, they are failing with "Fund Issue".

---

## Request

Please investigate and enable DTH payment service for Partner ID **240054**. We have sufficient wallet balance and are making requests from a whitelisted IP.

If any additional configuration or documentation is required, please let us know.

---

## Contact Information

- **Partner ID:** 240054
- **Company:** Same Day Solution Pvt. Ltd.
- **Email:** ashvamlearningpvtltd@gmail.com
- **Mobile:** 7389599958
- **Whitelisted IP:** 44.193.29.59

Thank you for your prompt assistance.

Best regards,  
**Same Day Solution Pvt. Ltd.**

