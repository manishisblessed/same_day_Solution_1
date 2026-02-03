# Email to Sparkup Support - 504 Gateway Timeout Issue

**Subject:** URGENT: 504 Gateway Timeout on payRequest Endpoint - Partner ID 240054

---

**To:** Sparkup Support Team  
**From:** Same Day Solution Pvt. Ltd.  
**Date:** January 31, 2026  
**Priority:** URGENT

---

## Email Body

Dear Sparkup Support Team,

We are experiencing a critical issue with the BBPS payRequest API endpoint that is preventing us from processing bill payments. We have attached our Postman collection for your reference and testing.

### Issue Summary

We are consistently receiving **504 Gateway Timeout** errors when calling the `payRequest` endpoint, while the `fetchBill` endpoint works perfectly. This issue occurs regardless of the payment amount, including with the smallest possible amount (₹1).

### Key Findings

1. ✅ **fetchBill works correctly:**
   - Successfully retrieves bill details
   - Returns valid reqId
   - Response time: Normal (< 2 seconds)

2. ❌ **payRequest consistently times out:**
   - Returns 504 Gateway Timeout
   - Response: HTML error page from nginx/1.18.0 (Ubuntu)
   - Occurs even with amount "1" (proving it's NOT amount-related)
   - Response time: Exceeds nginx timeout (typically 60 seconds)

### Test Evidence

**Latest fetchBill Response (Working):**
- reqId: `EF17AKDJKHN1LJE9LMJHEPG3BC460311510`
- Bill Amount: ₹29,899,958
- Status: Success
- Response Code: 200

**payRequest Response (Failing):**
- Amount tested: "1" (smallest possible)
- Status: 504 Gateway Timeout
- Error: nginx gateway timeout waiting for backend response

### Request Details

**Endpoint:** `POST https://api.sparkuptech.in/api/ba/bbps/payRequest`

**Headers:**
- partnerid: 240054
- consumerkey: b2078d92ff9f8e9e
- consumersecret: ba6fba9775548f71
- Content-Type: application/json

**Request Body Format:**
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
    "reqId": "EF17AKDJKHN1LJE9LMJHEPG3BC460311510"
}
```

### Questions for Your Team

1. Is the payRequest endpoint currently experiencing issues or maintenance?
2. What is the nginx timeout setting for the /payRequest endpoint?
3. Is there a known issue with reqId validation taking too long?
4. Are there any backend service delays or outages affecting payRequest?
5. Can you check server logs for requests with reqId: `EF17AKDJKHN1LJE9LMJHEPG3BC460311510`?
6. Is there a different endpoint or method we should use for payments?

### Attachments

We have attached:
- **BBPS_API_Postman_Collection.json** - Complete Postman collection with all API requests, including:
  - fetchBill request (working)
  - payRequest requests (failing with 504)
  - Test scripts and error handling
  - Environment variables

You can import this collection directly into Postman to reproduce the issue.

### Impact

This issue is blocking all bill payment transactions for our production environment. We urgently need this resolved to continue serving our customers.

### Request

Please investigate this issue at the earliest and provide:
1. Root cause analysis
2. Expected resolution timeline
3. Any workarounds we can use in the meantime
4. Server logs related to the failing requests

We are available for any additional information or testing you may require.

Thank you for your prompt attention to this matter.

---

**Best Regards,**  
[Your Name]  
[Your Title]  
Same Day Solution Pvt. Ltd.  
Partner ID: 240054  
Email: [your-email@domain.com]  
Phone: [your-phone-number]

---

## Additional Information (for reference)

**Environment:**
- API Base URL: https://api.sparkuptech.in/api/ba/bbps
- Partner ID: 240054
- Environment: Production
- IP Whitelisted: [Your EC2 IP if applicable]

**Timeline:**
- Issue first observed: [Date]
- Consistently reproducible: Yes
- Affects: All payRequest calls, regardless of amount or biller

**Previous Communication:**
- [If you've contacted them before, mention it here]

