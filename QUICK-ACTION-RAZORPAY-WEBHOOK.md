# Quick Action: Razorpay Webhook Domain Fix

## 🚨 The Problem

- **Razorpay webhook configured for:** `https://www.samedaysolution.in/api/razorpay/notification`
- **Your app is now on:** `samedaysolution.co.in`
- **Result:** Webhooks are going to the wrong domain!

## ✅ Quick Solution (Recommended)

### Step 1: Test Which URL Works

Test both URLs to find where your webhook endpoint is deployed:

```bash
# Option A: Main domain (Amplify)
curl -X GET https://www.samedaysolution.co.in/api/razorpay/notification

# Option B: API subdomain (EC2)
curl -X GET https://api.samedaysolution.co.in/api/razorpay/notification
```

**Use whichever returns:** `{"message":"Razorpay POS notification endpoint","status":"active",...}`

### Step 2: Update Razorpay Dashboard

1. Go to [Razorpay Dashboard](https://dashboard.razorpay.com/)
2. Navigate to **Settings** → **Webhooks**
3. Find webhook: `https://www.samedaysolution.in/api/razorpay/notification`
4. **Edit** and update URL to:
   - `https://www.samedaysolution.co.in/api/razorpay/notification` (if Option A worked)
   - OR `https://api.samedaysolution.co.in/api/razorpay/notification` (if Option B worked)
5. **Save** changes
6. **Test webhook** from Razorpay dashboard

### Step 3: Verify It Works

- Check webhook logs in Razorpay dashboard (should show 200 OK)
- Monitor your server logs for incoming webhooks
- Test with a real transaction if possible

## ⚠️ If Domain Not Whitelisted

If Razorpay says the domain is not whitelisted:

1. Contact Razorpay support
2. Request whitelisting of `samedaysolution.co.in` (or `api.samedaysolution.co.in`)
3. Provide your Razorpay account details and reason (domain migration)

## 📋 Full Guide

For detailed steps and alternative solutions, see: **`RAZORPAY-WEBHOOK-DOMAIN-MIGRATION-GUIDE.md`**

---

**Time Required:** 5-10 minutes  
**Priority:** High (webhooks won't work until fixed)

