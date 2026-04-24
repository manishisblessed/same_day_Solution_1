# AEPS Postman Collection — Complete Testing Setup ✅

## What Was Done

### 1. **Postman Collection Updated**
   - **File:** `postman/AEPS-Chagans-API.postman_collection.json`
   - **Added:** New **§5. AEPS Mock** folder with 5 test requests
   - **Purpose:** Test without real Chagans device/biometrics

### 2. **Backend Mock Endpoints Created**
   - **`lib/aeps-mock.ts`** — Mock logic & response builders
   - **`app/api/aeps/mock-login/route.ts`** — Simulates biometric login success
   - **`app/api/aeps/mock-payment/route.ts`** — Simulates all payment types
   - **Purpose:** Run locally on `http://localhost:3000`

### 3. **Documentation**
   - **`AEPS-MOCK-TESTING.md`** — Complete guide to using the mock system

---

## Quick Start

### Step 1: Start your backend
```bash
npm run dev
# Backend runs on http://localhost:3000
```

### Step 2: Import Postman collection
- Open Postman
- **Import** → `postman/AEPS-Chagans-API.postman_collection.json`
- You'll see a new **§5. AEPS Mock** folder

### Step 3: Test the flow (in order)

```
1️⃣  [2.1 Create Merchant] → Uses REAL Chagans (needs credentials)
2️⃣  [2.2 Merchant List] → Verify merchant created
3️⃣  [3.1 Check AEPS Login Status] → Real endpoint (returns loginStatus: false)
4️⃣  [5.1 Mock AEPS Login] → LOCAL mock ✨ (simulates successful login)
5️⃣  [5.2 Mock AEPS Payment — Balance] → LOCAL mock ✨ (gets balance)
6️⃣  [5.2 Mock AEPS Payment — Withdraw] → LOCAL mock ✨ (simulates transaction)
7️⃣  [5.2 Mock AEPS Payment — Mini Statement] → LOCAL mock ✨ (last 5 txns)
```

✨ = No device or Chagans biometric needed

---

## Collection Variables (Postman)

Before running, ensure these are set:

| Variable | Example Value | Source |
|----------|---------------|--------|
| `CHAGHANS_AEPS_CLIENT_ID` | `69ea9363a...` | From `.env.local` |
| `CHAGHANS_AEPS_CONSUMER_SECRET` | `aed1f559-...` | From `.env.local` |
| `CHAGHANS_AEPS_AUTH_TOKEN` | `eyJhbGc...` | From `.env.local` |
| `merchantId` | `69ea3db26d7c0047d40ceb2f` | Auto-set after 2.1 |
| `merchantName` | `Manish Kumar Shah` | Your test name |
| `merchantPan` | `FXNPS8348A` | Your test PAN (individual) |
| `customerAadhaar` | `669812906054` | Your test Aadhaar |
| `customerMobile` | `9971969046` | Your test mobile |
| `bankIin` | `607094` | HDFC IIN |

---

## What Each Mock Request Does

### 5.1 Mock AEPS Login
```json
Request:  { merchantId, type: "deposit|withdraw" }
Response: { loginStatus: true, bankList, wadh, route: "AIRTEL" }
Effect:   Saves `wadh` to collection variables (used by payment requests)
```

### 5.2 Mock AEPS Payment (Balance / Withdraw / Deposit / Mini Statement)
```json
Request:  { merchantId, type, amount, iin, adhar, cMobile }
Response: { orderId, status, bankAccountBalance, utr, miniStatement }
Effect:   Simulates transaction without real biometric
```

---

## Real vs Mock Flow

| Component | § | Real API (Chagans) | Mock (Local) |
|-----------|---|-------------------|--------------|
| Merchant KYC | 2.1 | ✅ `https://chagans.com/aeps/createMerchant` | - |
| Merchant List | 2.2 | ✅ Real endpoint | - |
| Login Status | 3.1 | ✅ Real endpoint | - |
| **Biometric Login** | **3.2** | ❌ Needs device | **✅ 5.1 Mock** |
| **Payment/Balance** | **4.1** | ❌ Needs device | **✅ 5.2 Mock** |

**Real API requires:** certified fingerprint/face device + Chagans SDK + real `pidData`

**Mock endpoints allow:** testing full flow locally, no device needed

---

## When to Switch to Real Chagans

1. **Real Chagans steps still work:** 2.1 (Create Merchant), 2.2 (List), 3.1 (Login Status) — no changes
2. **Replace biometric calls:**
   - Instead of **5.1 Mock AEPS Login** → use **3.2 AEPS Login** (real device)
   - Instead of **5.2 Mock Payment** → use **4.1 AEPS Payment** (real device)
3. **Backend:** Swap `mockAepsLogin()` / `mockAepsPayment()` calls with real Chagans API

---

## Testing Checklist

- [ ] Backend running (`npm run dev`)
- [ ] Postman collection imported with **§5. AEPS Mock** folder visible
- [ ] Collection variables filled (client ID, token, test data)
- [ ] **2.1 Create Merchant** succeeds → merchant KYC validated
- [ ] **2.2 Merchant List** shows your merchant
- [ ] **3.1 Login Status** returns (shows `loginStatus: false` is OK)
- [ ] **5.1 Mock Login** succeeds → `aepsWadh` populated
- [ ] **5.2 Mock Payment (Balance)** succeeds → `bankAccountBalance` returned
- [ ] **5.2 Mock Payment (Withdraw)** succeeds → `orderId` + `utr` returned
- [ ] **5.2 Mock Payment (Mini Statement)** succeeds → transaction history returned

---

## Files Reference

### New/Updated
- **`postman/AEPS-Chagans-API.postman_collection.json`** — Updated with **§5. AEPS Mock**
- **`lib/aeps-mock.ts`** — Mock request/response logic
- **`app/api/aeps/mock-login/route.ts`** — Mock login endpoint
- **`app/api/aeps/mock-payment/route.ts`** — Mock payment endpoint
- **`AEPS-MOCK-TESTING.md`** — Full testing guide

### Existing (unchanged)
- **`postman/Chagans-AEPS.postman_environment.json`** — Credentials template
- **`app/api/aeps/transaction/create/route.ts`** — Your main AEPS handler (still has `TODO` for real API)
- **`.env.local`** — Your Chagans credentials

---

## Next Steps

1. **Test locally with mocks** (full flow, no device)
   → Validate KYC, wallet, ledger logic

2. **Connect to your UI** (use mock endpoints in your app)
   → Build/test merchant dashboard, payment UI

3. **Get device + SDK from Chagans**
   → Real biometrics only when ready

4. **Swap to real endpoints** (3.2, 4.1 instead of 5.1, 5.2)
   → Production testing

---

## Questions?

Refer to **`AEPS-MOCK-TESTING.md`** for detailed troubleshooting, response samples, and integration notes.

Happy testing! 🚀
