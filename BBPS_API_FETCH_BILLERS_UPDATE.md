# BBPS API - Fetch Billers Update

## What Changed

I've updated the Postman collection and guides to use the **correct BBPS API endpoint** that fetches `billerId` and `billerName` dynamically from Sparkup's API, instead of using demo/hardcoded values.

## Updated Endpoint

### Old Approach (GET - Limited Info)
```
GET /api/ba/billerId/getList?blr_category_name=Credit%20Card
```
- Returns: `blr_id`, `blr_name` (needs transformation)
- Less detailed information

### New Approach (POST - Complete Info) ✅
```
POST /api/ba/billerInfo/getDataBybillerCategory
```
- Returns: `billerId`, `billerName` (exact format needed!)
- Includes all biller details (inputParams, payment modes, etc.)
- Better for production use

## Request Format

**Endpoint:** `POST https://api.sparkuptech.in/api/ba/billerInfo/getDataBybillerCategory`

**Headers:**
```
partnerid: 240XX
consumerKey: 94a5336723c4cxxxx
consumerSecret: 0498472da8b7xxx
Content-Type: application/json
```

**Body:**
```json
{
    "fieldValue": "Credit Card",
    "paymentChannelName1": "AGT",
    "paymentChannelName2": "",
    "paymentChannelName3": ""
}
```

## Response Format

```json
{
    "success": true,
    "msg": "Detail Fetched",
    "data": [
        {
            "billerId": "KOTA00000NATED",
            "billerName": "Kotak Credit Card",
            "billerCategory": "Credit Card",
            "billerAdhoc": "true",
            "billerInputParams": {
                "Last 4 digits of Credit Card Number": {...},
                "Registered Mobile Number": {...}
            },
            "billerPaymentModes": {...},
            "is_active": true
        }
    ]
}
```

## Key Benefits

1. ✅ **Direct Format**: Returns `billerId` and `billerName` in the exact format needed for `payRequest`
2. ✅ **Complete Info**: Includes all biller details (inputParams, payment modes, etc.)
3. ✅ **Dynamic**: Fetches real-time data from Sparkup API, not hardcoded values
4. ✅ **Auto-Population**: Postman collection automatically saves `billerId` and `billerName` to environment variables

## Updated Files

1. **BBPS_API_Postman_Collection.json**
   - Changed "0. Get Credit Card Billers" from GET to POST
   - Updated endpoint to `/billerInfo/getDataBybillerCategory`
   - Updated test script to extract `billerId` and `billerName` directly

2. **BBPS_CREDIT_CARD_PAYMENT_GUIDE.md**
   - Updated Step 1 to use the POST endpoint
   - Updated request/response examples

3. **QUICK_FIX_SUMMARY.md**
   - Updated to reflect the new endpoint

## How to Use

1. **Run "0. Get Credit Card Billers"** in Postman
   - This will fetch all Credit Card billers from Sparkup API
   - Automatically saves `billerId` and `billerName` to environment variables

2. **Select Your Bank**
   - Check the console output to see all available billers
   - The first biller is auto-selected, or manually update environment variables

3. **Continue with Step 2 (Fetch Bill)**
   - Uses the `billerId` from Step 1

4. **Continue with Step 3 (Pay Request)**
   - Uses `billerId` and `billerName` from Step 1
   - Uses `reqId` from Step 2

## Example cURL

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

## Notes

- The `fieldValue` should match the category name exactly (e.g., "Credit Card", "Electricity", "DTH")
- `paymentChannelName1: "AGT"` is required for Agent channel payments
- Empty strings for `paymentChannelName2` and `paymentChannelName3` are fine
- Response includes all biller metadata needed for the payment flow



