# Testing Transactions API

## Quick Test Steps

### 1. Check Admin Dashboard
- Navigate to: `http://localhost:3001/admin`
- Click on "Transactions" tab
- Should see all POS transactions from `razorpay_pos_transactions` table

### 2. Check Partner Dashboard  
- Navigate to: `http://localhost:3001/dashboard/partner?tab=transactions`
- Should see transactions for that partner's assigned POS machines

### 3. Browser Console Check
Open DevTools (F12) → Console tab, look for:
```
[Razorpay Transactions] Auth: cookie | admin@example.com | Role: admin
```

### 4. Network Tab Check
Open DevTools (F12) → Network tab:
- Filter by: `/api/razorpay/transactions`
- Check response status: Should be `200`
- Check response body: Should have `success: true` and `data` array

### 5. Verify Database Has Data
Run this SQL query in Supabase:
```sql
SELECT COUNT(*) as total_transactions 
FROM razorpay_pos_transactions;
```

If count > 0, transactions exist and should be visible.

### 6. Check Server Logs
Look for console logs when transactions are fetched:
- `[Razorpay Transactions] Auth: ... | Role: admin`
- `[Partner Txn] partner_id: ..., TIDs: [...], serials: [...]`
- `[Retailer Txn] retailer_id: ..., TIDs: [...], serials: [...]`

## Expected Behavior

### Admin
- Sees **ALL** transactions from `razorpay_pos_transactions`
- No filtering by partner/retailer

### Partner
- Sees transactions matching TIDs from:
  - `partner_pos_machines` table (where `partner_id` matches)
  - `pos_machines` table (where `partner_id` matches)

### Retailer
- Sees transactions matching TIDs/serials from:
  - `pos_device_mapping` table (where `retailer_id` matches)
  - `pos_machines` table (where `retailer_id` matches)

## Troubleshooting

**If still showing 0 transactions:**
1. Check if `razorpay_pos_transactions` table has data
2. Check browser console for errors
3. Check Network tab for failed requests
4. Verify user role is correct (admin/partner/retailer)
5. Check server logs for authentication issues

