# SparkUpTech Payout API - Postman Collection

This Postman collection contains all 5 SparkUpTech Express Pay Payout APIs for testing.

## 📋 Collection File
**File:** `SparkUpTech-Payout-API.postman_collection.json`

## 🚀 Quick Start

1. **Import Collection**
   - Open Postman
   - Click "Import" button
   - Select `SparkUpTech-Payout-API.postman_collection.json`
   - Collection will be imported with all 5 APIs

2. **Set Environment Variables**
   - The collection uses variables for credentials
   - Update these in Postman:
     - `partnerid`: Your partner ID (default: 240054)
     - `consumerkey`: Your consumer key
     - `consumersecret`: Your consumer secret
     - `transaction_id`: UTR from expressPay2 (update after calling expressPay2)

## 📡 APIs Included

### 1. POST bankList
**Endpoint:** `https://api.sparkuptech.in/api/fzep/payout/bankList`

**Description:** Get list of all banks available for payout transfers.

**Request:** No body required (POST with headers only)

**Response:** List of banks with:
- `id`: Bank ID (required for expressPay2)
- `bankName`: Bank name
- `ifsc`: IFSC code
- `isIMPS`: IMPS support
- `isNEFT`: NEFT support
- `isACVerification`: Account verification support

**Usage:** Call this first to get BankID for expressPay2.

---

### 2. POST validate_account
**Endpoint:** `https://api.sparkuptech.in/api/dto/validate_account`

**Description:** Validate bank account and get beneficiary name (penniless transaction).

**Request Body:**
```json
{
    "purpose_message": "This is a penniless transaction",
    "validation_type": "penniless",
    "account_number": "50100104420821",
    "ifscCode": "HDFC0003756"
}
```

**Response:** 
- `beneficiaryName`: Account holder name from bank
- `accountStatus`: "valid" or "invalid"
- `reference_id`: Transaction reference ID

**Usage:** Call this before expressPay2 to verify account and get beneficiary name.

---

### 3. POST expressPay2
**Endpoint:** `https://api.sparkuptech.in/api/fzep/payout/expressPay2`

**Description:** Initiate bank transfer via IMPS or NEFT.

**Important:** 
- Get `BankID` from bankList API first
- Use `beneficiaryName` from validate_account API
- **`APIRequestID` is automatically generated** - unique 16-digit number for each request
- **`transaction_id` is automatically saved** - no need to manually copy it

**Request Body:**
```json
{
    "AccountNo": "50100104420821",
    "AmountR": 100,
    "APIRequestID": {{apiRequestId}},
    "BankID": 31,
    "BeneMobile": "9971969046",
    "BeneName": "Manish Kumar Shah",
    "bankName": "HDFC BANK",
    "IFSC": "HDFC0003756",
    "SenderEmail": "support@samedaysolution.in",
    "SenderMobile": "9311757194",
    "SenderName": "Aryan",
    "paymentType": "IMPS",
    "WebHook": "https://yourdomain.com/webhook",
    "extraParam1": "NA",
    "extraParam2": "NA",
    "extraField1": "TestValue",
    "sub_service_name": "ExpressPay",
    "remark": "Test Transaction"
}
```

**Note:** The `{{apiRequestId}}` variable is automatically generated before each request. This prevents the "Data already exist" error.

**Response:**
- `transaction_id`: UTR number (automatically saved to `{{transaction_id}}` variable)
- `status`: "pending", "success", or "failed"
- `clientReqId`: Client request ID

**Usage:** 
1. Get BankID from bankList
2. Validate account with validate_account
3. Call expressPay2 - **APIRequestID is auto-generated, no need to change it**
4. **transaction_id is automatically saved** - Status Check request will use it automatically

---

### 4. POST statusCheck
**Endpoint:** `https://api.sparkuptech.in/api/fzep/payout/statusCheck?transaction_id={UTR}&sub_service_name=ExpressPay`

**Description:** Check transaction status using UTR from expressPay2.

**Query Parameters:**
- `transaction_id`: UTR from expressPay2 response
- `sub_service_name`: Always "ExpressPay"

**Response:**
- `responseCode`: 2 = SUCCESS, 1 = PENDING, 0 = FAILED
- `status`: "success", "pending", or "failed"
- `transactionAmount`: Actual transfer amount
- `deductedAmount`: Total deducted (amount + charge)
- `serviceCharge`: Service charge
- `rpid`: Reference/Payment ID
- `remark`: Transaction remark

**Usage:** 
- **No need to update `{{transaction_id}}`** - it's automatically saved from expressPay2 response
- Call statusCheck to verify transaction status (uses saved transaction_id automatically)

---

### 5. GET getBalance
**Endpoint:** `https://api.sparkuptech.in/api/wallet/getBalance`

**Description:** Get payout wallet balance.

**Request:** GET with headers only (no body)

**Response:**
- `balance`: Total wallet balance
- `lien`: Lien amount (locked funds)
- `is_active`: Wallet active status
- `client_id`: Client/Partner ID

**Available Balance = balance - lien**

**Usage:** Check wallet balance before initiating transfers.

---

## 🔄 Typical Workflow

1. **Get Balance** → Check available balance
2. **Bank List** → Get BankID for the bank
3. **Validate Account** → Verify account and get beneficiary name
4. **Express Pay** → Initiate transfer (save UTR)
5. **Status Check** → Verify transaction status using UTR

## ⚙️ Configuration

### Headers (All APIs)
All APIs require these headers:
- `partnerid`: Your partner ID
- `consumerkey`: Your consumer key
- `consumersecret`: Your consumer secret
- `Content-Type`: application/json (for POST requests)

### Variables
Update these in Postman collection variables:
- `{{partnerid}}`: 240054 (or your partner ID)
- `{{consumerkey}}`: Your consumer key
- `{{consumersecret}}`: Your consumer secret
- `{{transaction_id}}`: UTR from expressPay2 (**automatically updated** after expressPay2 call)
- `{{apiRequestId}}`: Auto-generated unique 16-digit ID (**automatically generated** before each expressPay2 call)

## 📝 Notes

1. **BankID Resolution:** The system automatically resolves BankID from bankList API before calling expressPay2, but you can also provide it manually.

2. **Transaction ID:** **Automatically saved!** After calling expressPay2, the `transaction_id` (UTR) is automatically saved to `{{transaction_id}}` variable. No manual copying needed.

3. **API Request ID:** **Automatically generated!** A unique 16-digit numeric ID is generated before each expressPay2 request. This prevents the "Data already exist" error. You don't need to change it.

4. **Headers:** The documentation shows lowercase headers (`consumerkey`, `consumersecret`), but the code implementation uses camelCase. If you encounter issues, try both formats.

5. **Testing:** Start with small amounts for testing. Use validate_account first to verify account details.

6. **Avoiding Duplicate Errors:** The Postman collection automatically generates a unique `APIRequestID` for each request, so you won't get "Data already exist" errors when testing multiple times.

## ✅ Testing Checklist

- [ ] Get Balance - Verify wallet has sufficient balance
- [ ] Bank List - Get BankID for your bank
- [ ] Validate Account - Verify account and get beneficiary name
- [ ] Express Pay - Initiate transfer (save UTR)
- [ ] Status Check - Verify transaction completed successfully

## 🐛 Troubleshooting

1. **401 Unauthorized:** Check credentials in collection variables
2. **Invalid BankID:** Get fresh BankID from bankList API
3. **Transaction Pending:** Wait a few minutes and check status again
4. **Account Validation Failed:** Verify account number and IFSC are correct

---

**Created:** 2026-02-04  
**Version:** 1.0  
**APIs:** 5 endpoints fully integrated

