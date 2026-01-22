# Quick Check: Is Mock Mode Enabled?

## The Issue
Consumer name showing "AXXX" means **mock mode is enabled**. This returns fake data instead of real API calls.

## Quick Fix

### Step 1: Check Your Server Console
When you fetch a bill, look at your **server console** (where `npm run dev` is running). You should see one of these:

**If Mock Mode is ON:**
```
[BBPS Mock] Fetching bill with params: { ... }
```

**If Real API is being called:**
```
[BBPS fetchBill] Full API response: { ... }
```

### Step 2: Check Environment Variables

**Check if `.env.local` exists and has:**
```env
USE_BBPS_MOCK=true  ← THIS IS THE PROBLEM
```

**If it exists, either:**
1. **Remove the line** `USE_BBPS_MOCK=true`
2. **OR change it to** `USE_BBPS_MOCK=false`
3. **OR delete the entire `.env.local` file** if you don't need it

### Step 3: Restart Dev Server
After changing `.env.local`:
```bash
# Stop server (Ctrl+C)
npm run dev
```

### Step 4: Test Again
Fetch a bill and check:
- ✅ Consumer name should show real name (not "AXXX")
- ✅ Server console should show `[BBPS fetchBill] Full API response`

## Why This Happened
Mock mode is useful for local development when you don't have BBPS credentials. But if you have credentials and want real data, mock mode must be **OFF**.

## Still Not Working?
If consumer name is still wrong after disabling mock mode, check the server console logs for:
- `[BBPS fetchBill] Consumer name not found or masked` - This will show where it's looking for the name
- The actual API response structure















