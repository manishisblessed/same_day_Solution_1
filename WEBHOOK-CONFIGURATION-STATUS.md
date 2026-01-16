# Webhook Configuration Status ✅

## Current Configuration

Based on your Razorpay Dashboard:

- **Webhook URL:** `https://www.samedaysolution.in/api/razorpay/notification` ✅
- **Status:** Enabled ✅
- **Secret:** Configured ✅
- **Active Events:** 34 events including:
  - `payment.authorized` ✅
  - `payment.captured` ✅
  - `payment.failed` ✅
  - And 31 other events

## ⚠️ Important Note: Event Format Compatibility

Your webhook endpoint `/api/razorpay/notification` is designed to receive **POS transaction notifications** with this payload format:

```json
{
  "txnId": "180829064415993E010034214",
  "status": "AUTHORIZED",
  "amount": 100,
  "paymentMode": "CARD",
  "deviceSerial": "5A609798",
  "tid": "10000002",
  "merchantName": "Merchant Name",
  "createdTime": 1535525056000
}
```

However, the **payment events** (`payment.authorized`, `payment.captured`, etc.) typically send a different format:

```json
{
  "event": "payment.captured",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_1234567890",
        "amount": 10000,
        "status": "captured",
        "method": "card",
        "terminal_id": "10000002"
      }
    }
  }
}
```

## 🔧 What This Means

1. **If you're using Razorpay POS devices:**
   - Razorpay POS devices may send notifications directly to your endpoint
   - These notifications might use the POS format (with `txnId`, `status`, etc.)
   - Your current webhook configuration should work

2. **If you're receiving payment webhook events:**
   - The endpoint might need to handle both formats
   - Or you may need POS-specific events configured in Razorpay

## ✅ Next Steps to Verify

### Step 1: Test the Webhook

Make a test transaction on a POS device and check:

1. **Check Razorpay Dashboard:**
   - Go to your webhook → Event Logs
   - See if any events are being sent
   - Check the payload format

2. **Check Your Server Logs:**
   - Look for incoming webhook requests
   - Check if the payload format matches what the endpoint expects

3. **Check Admin Dashboard:**
   - Go to `/admin/razorpay-transactions`
   - See if transactions appear

### Step 2: Verify Payload Format

If transactions are not appearing, check the webhook payload:

1. In Razorpay Dashboard → Webhooks → Your Webhook → Event Logs
2. Click on a recent event
3. Check the payload structure

**If payload has `txnId` and `status` directly:**
- ✅ Your endpoint should work as-is

**If payload has `event` and `payload.payment.entity`:**
- ⚠️ You may need to update the endpoint to handle this format
- Or configure POS-specific events in Razorpay

### Step 3: Check for POS-Specific Events

In Razorpay Dashboard, check if there are POS-specific events available:
- `terminal.transaction.created`
- `terminal.transaction.authorized`
- `terminal.transaction.failed`
- Or similar terminal/POS events

If available, add these events to your webhook configuration.

## 🧪 Testing the Webhook

### Test 1: Manual Test (POS Format)

```bash
curl -X POST https://www.samedaysolution.in/api/razorpay/notification \
  -H "Content-Type: application/json" \
  -d '{
    "txnId": "TEST_123456789",
    "status": "AUTHORIZED",
    "amount": 100,
    "paymentMode": "CARD",
    "deviceSerial": "TEST123",
    "tid": "10000002",
    "merchantName": "Test Merchant",
    "createdTime": 1737024000000
  }'
```

**Expected Response:**
```json
{
  "received": true,
  "processed": true,
  "transactionId": "uuid-here",
  "txnId": "TEST_123456789",
  "action": "created"
}
```

### Test 2: Check Webhook Logs

1. Go to Razorpay Dashboard
2. Navigate to: Settings → Webhooks → Your Webhook
3. Click on "Event Logs" or "Webhook Logs"
4. Check recent events and their delivery status

### Test 3: Make Real Transaction

1. Make a transaction on a POS device
2. Check if it appears in `/admin/razorpay-transactions` within 10 seconds
3. Check webhook logs in Razorpay dashboard

## 🔍 Troubleshooting

### Issue: Transactions not appearing

**Check:**
1. ✅ Webhook is enabled (you confirmed this)
2. ✅ Webhook URL is correct (you confirmed this)
3. ⚠️ Check webhook event logs in Razorpay dashboard
4. ⚠️ Check server logs for incoming webhook requests
5. ⚠️ Verify payload format matches endpoint expectations

### Issue: Webhook receiving events but not processing

**Possible causes:**
1. Payload format mismatch
2. Missing required fields (`txnId` or `id`)
3. Database connection issues
4. Server errors (check logs)

### Issue: Need to handle payment webhook format

If you need to handle the payment webhook format (`event` + `payload.payment.entity`), you have two options:

**Option 1:** Update `/api/razorpay/notification` to handle both formats

**Option 2:** Use `/api/razorpay/webhook` for payment events (already configured for this)

## 📊 Current Status Summary

| Item | Status | Notes |
|------|--------|-------|
| Webhook URL | ✅ Correct | `https://www.samedaysolution.in/api/razorpay/notification` |
| Status | ✅ Enabled | Active and ready |
| Secret | ✅ Configured | Security enabled |
| Events | ✅ 34 Active | Includes payment events |
| Endpoint Code | ✅ Ready | Handles POS notification format |
| Database Table | ⚠️ Verify | Ensure `razorpay_pos_transactions` exists |
| Testing | ⏳ Pending | Need to test with real transaction |

## ✅ Action Items

1. **Verify Database:**
   - Ensure `razorpay_pos_transactions` table exists
   - Run migration if needed: `supabase-razorpay-pos-notifications-migration.sql`

2. **Test Webhook:**
   - Make a test transaction on POS device
   - Check webhook logs in Razorpay dashboard
   - Verify transaction appears in admin dashboard

3. **Monitor:**
   - Check server logs for webhook requests
   - Monitor webhook delivery status in Razorpay dashboard
   - Verify transactions are being stored

4. **If Needed:**
   - Check if POS-specific events are available in Razorpay
   - Update endpoint to handle payment webhook format if required

## 🎯 Expected Behavior

Once everything is working:

1. **POS Transaction Occurs:**
   - Customer makes payment on POS device
   - Razorpay sends notification to your webhook

2. **Webhook Processes:**
   - Endpoint receives notification
   - Extracts transaction data
   - Stores in `razorpay_pos_transactions` table

3. **Admin Dashboard:**
   - Transaction appears automatically (auto-refresh every 10 seconds)
   - Shows: Date, Transaction ID, Amount, Payment Mode, Status, Device/TID, Merchant Name

## 📝 Notes

- Your webhook is correctly configured and enabled ✅
- The endpoint is ready to receive POS notifications ✅
- You may need to verify the payload format matches expectations
- Test with a real transaction to confirm everything works

---

**Last Updated:** Based on current webhook configuration
**Status:** Configured and Enabled - Ready for Testing

