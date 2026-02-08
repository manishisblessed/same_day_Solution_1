# Domain Migration Guide: samedaysolution.co.in → samedaysolution.in

## 🎯 Goal

Migrate from `samedaysolution.co.in` to `samedaysolution.in` as the primary domain while ensuring:
- ✅ All APIs (BBPS, Payout, Razorpay) continue working
- ✅ Razorpay webhooks work correctly
- ✅ EC2 backend APIs remain accessible
- ✅ No service interruption

## 📋 Current Architecture

- **Frontend:** AWS Amplify (both domains working)
- **Backend API (EC2):** `api.samedaysolution.co.in` (for BBPS/Payout APIs)
- **Razorpay Webhook:** Currently configured for `samedaysolution.in` ✅
- **Other APIs:** Next.js API routes on Amplify

## ✅ Pre-Migration Checklist

Before starting, verify:

- [ ] Both `samedaysolution.in` and `samedaysolution.co.in` are working on Amplify
- [ ] EC2 backend is accessible (test `api.samedaysolution.co.in/api/health` or similar)
- [ ] Razorpay webhook is currently configured for `samedaysolution.in` (already done ✅)
- [ ] You have access to:
  - AWS Amplify Console
  - EC2 instance (for DNS/SSL updates)
  - DNS provider (Route 53, GoDaddy, etc.)
  - Razorpay Dashboard

---

## 🚀 Migration Steps

### Step 1: Set Up EC2 Backend Subdomain (if needed)

**If you're using `api.samedaysolution.co.in` for EC2 backend, you need to set up `api.samedaysolution.in`:**

1. **Update DNS Records:**
   - Go to your DNS provider
   - Add A record or CNAME:
     - **Type:** A (or CNAME)
     - **Name:** `api`
     - **Value:** Your EC2 public IP (or `api.samedaysolution.co.in` if using CNAME)
     - **TTL:** 300

2. **Update SSL Certificate on EC2:**

   **✅ RECOMMENDED: Include Both Domains (Safer for Migration)**
   
   This allows both domains to work during migration, giving you a safety net:
   
   ```bash
   # SSH into EC2
   ssh user@your-ec2-ip

   
   # Include both domains in SSL certificate (RECOMMENDED)
   sudo certbot --nginx -d api.samedaysolution.in -d api.samedaysolution.co.in
   ```
   
   **Benefits:**
   - ✅ Both domains work during migration
   - ✅ No downtime if something breaks
   - ✅ Can test thoroughly before removing old domain
   - ✅ Easy rollback if needed
   
   **Alternative: Replace (Only if you're confident)**
   
   If you're certain everything will work and want a clean setup:
   
   ```bash
   # Replace old domain with new one
   sudo certbot --nginx -d api.samedaysolution.in --force-renewal
   ```
   
   **⚠️ Warning:** This removes the old domain from SSL certificate. If something breaks, the old domain won't work as backup.
   
   **💡 Recommendation:** Start with including both domains, then remove the old one after 1-2 weeks of successful operation.

3. **Update Nginx Configuration (if needed):**
   ```bash
   # Edit nginx config
   sudo nano /etc/nginx/sites-available/default
   # or
   sudo nano /etc/nginx/conf.d/samedaysolution.conf
   
   # Update server_name to include both domains (temporarily)
   server_name api.samedaysolution.in api.samedaysolution.co.in;
   ```

4. **Test EC2 Backend:**
   ```bash
   # Test from your local machine
   curl https://api.samedaysolution.in/api/health
   # or
   curl https://api.samedaysolution.in/api/bbps/categories
   ```

### Step 2: Update Codebase References

**Update all `.co.in` references to `.in`:**

1. **Update `lib/api-client.ts`:**
   - Change hardcoded fallback from `api.samedaysolution.co.in` to `api.samedaysolution.in`

2. **Update `lib/cors.ts`:**
   - Update allowed origins to use `.in` domain

3. **Update `middleware.ts`:**
   - Update allowed origins to use `.in` domain

4. **Update `env.example`:**
   - Change `NEXT_PUBLIC_APP_URL` to `https://samedaysolution.in`
   - Update EC2 backend URL example

5. **Update `app/admin/partners/page.tsx`:**
   - Change partner subdomain from `.co.in` to `.in`

6. **Update AWS Amplify Environment Variables:**
   - Set `NEXT_PUBLIC_APP_URL=https://samedaysolution.in`
   - Set `NEXT_PUBLIC_BBPS_BACKEND_URL=https://api.samedaysolution.in` (if using EC2)

### Step 3: Update Razorpay Webhook (Verify)

**Razorpay webhook should already be configured for `samedaysolution.in` ✅**

1. **Verify in Razorpay Dashboard:**
   - Go to [Razorpay Dashboard](https://dashboard.razorpay.com/)
   - Navigate to **Settings** → **Webhooks**
   - Verify webhook URL is: `https://www.samedaysolution.in/api/razorpay/notification`
   - If not, update it (see Step 4)

2. **Test Webhook:**
   ```bash
   curl -X GET https://www.samedaysolution.in/api/razorpay/notification
   ```
   Should return: `{"message":"Razorpay POS notification endpoint","status":"active",...}`

### Step 4: Deploy Code Changes

1. **Commit and Push:**
   ```bash
   git add .
   git commit -m "feat: Migrate domain from samedaysolution.co.in to samedaysolution.in"
   git push origin main
   ```

2. **Verify Amplify Deployment:**
   - Check AWS Amplify Console
   - Wait for deployment to complete
   - Verify both domains still work

### Step 5: Update Environment Variables

**In AWS Amplify Console:**

1. Go to **App settings** → **Environment variables**
2. Update:
   - `NEXT_PUBLIC_APP_URL` → `https://samedaysolution.in`
   - `NEXT_PUBLIC_BBPS_BACKEND_URL` → `https://api.samedaysolution.in` (if using EC2)
3. **Redeploy** if needed (Amplify may auto-redeploy)

**On EC2 (if using separate backend):**

1. SSH into EC2
2. Update `.env` file:
   ```bash
   nano .env
   # Update NEXT_PUBLIC_APP_URL=https://samedaysolution.in
   ```
3. Restart application:
   ```bash
   pm2 restart all
   # or
   npm run build && npm start
   ```

### Step 6: Test All Functionality

**Test Checklist:**

- [ ] **Frontend loads:** `https://www.samedaysolution.in`
- [ ] **BBPS APIs work:** Test bill payment flow
- [ ] **Payout APIs work:** Test payout/transfer
- [ ] **Razorpay webhook:** Test with a transaction
- [ ] **Admin dashboard:** Login and verify functionality
- [ ] **Partner subdomains:** Test partner subdomain (if applicable)
- [ ] **EC2 backend:** Verify `api.samedaysolution.in` is accessible

### Step 7: Update DNS (Make .in Primary)

**Once everything is tested and working:**

1. **Update Primary Domain in Amplify:**
   - Go to AWS Amplify Console
   - **App settings** → **Domain management**
   - Set `samedaysolution.in` as primary domain
   - Remove `samedaysolution.co.in` (or keep as redirect)

2. **Update DNS Records:**
   - Point `samedaysolution.in` to Amplify (if not already)
   - Point `www.samedaysolution.in` to Amplify
   - Point `api.samedaysolution.in` to EC2 (if using subdomain)

### Step 8: Set Up Redirect (Optional - Recommended)

**To ensure no broken links, set up redirect from `.co.in` to `.in`:**

**Option A: Amplify Redirect (Recommended)**
- In Amplify Console, set up redirect rules
- Redirect `samedaysolution.co.in/*` → `samedaysolution.in/*`

**Option B: DNS Redirect**
- Point `samedaysolution.co.in` to a redirect service
- Or use CloudFront/Route 53 redirect

### Step 9: Monitor and Verify

**Monitor for 24-48 hours:**

- [ ] Check application logs for errors
- [ ] Monitor Razorpay webhook logs
- [ ] Check EC2 backend logs
- [ ] Verify no broken links or API calls
- [ ] Test user flows end-to-end

---

## 🔧 Code Changes Required

### 1. `lib/api-client.ts`

```typescript
// Change line 59 and 69:
return 'https://api.samedaysolution.in'  // Changed from .co.in
```

### 2. `lib/cors.ts`

```typescript
// Update allowed domains (lines 25-29):
const allowedDomains = [
  process.env.NEXT_PUBLIC_APP_URL,
  'https://www.samedaysolution.in',
  'https://samedaysolution.in',
  'https://api.samedaysolution.in',  // Changed from .co.in
  // Remove .co.in entries or keep temporarily
].filter(Boolean) as string[]
```

### 3. `middleware.ts`

```typescript
// Update ALLOWED_ORIGINS (lines 5-8):
const ALLOWED_ORIGINS = [
  'https://samedaysolution.in',
  'https://www.samedaysolution.in',
  'https://api.samedaysolution.in',  // Changed from .co.in
  // ... rest
]
```

### 4. `env.example`

```env
NEXT_PUBLIC_APP_URL=https://samedaysolution.in  # Changed from .co.in
# Update comment on line 27:
# Set to EC2 backend URL if using separate server (e.g., https://api.samedaysolution.in)
```

### 5. `app/admin/partners/page.tsx`

```typescript
// Line 166: Change subdomain reference
partner.samedaysolution.in  // Changed from .co.in

// Line 339: Change subdomain display
<span>{partner.subdomain}.samedaysolution.in</span>  // Changed from .co.in

// Line 475: Update any other references
```

---

## ⚠️ Important Notes

### EC2 Backend URL

**If you're using EC2 for BBPS/Payout APIs:**

- **Current:** `api.samedaysolution.co.in`
- **New:** `api.samedaysolution.in`
- **Action:** Set up DNS and SSL for `api.samedaysolution.in`
- **Environment Variable:** Update `NEXT_PUBLIC_BBPS_BACKEND_URL` in Amplify

### Razorpay Webhook

- **Already configured for:** `https://www.samedaysolution.in/api/razorpay/notification` ✅
- **No changes needed** if webhook is already pointing to `.in` domain
- **Verify** webhook is working after migration

### Partner Subdomains

- **Current:** `partner.samedaysolution.co.in`
- **New:** `partner.samedaysolution.in`
- **Action:** Update DNS records for partner subdomains
- **Note:** Existing partners may need DNS updates

### Email Configuration

- Email addresses (`info@samedaysolution.in`) are already correct ✅
- No changes needed

---

## 🔍 Troubleshooting

### Issue: EC2 Backend Not Accessible

**Symptoms:** BBPS/Payout APIs failing

**Solution:**
1. Verify DNS record for `api.samedaysolution.in` is correct
2. Check SSL certificate on EC2 includes new domain
3. Verify Nginx configuration includes new domain
4. Test: `curl https://api.samedaysolution.in/api/health`

### Issue: Razorpay Webhooks Not Working

**Symptoms:** Transactions not appearing in dashboard

**Solution:**
1. Verify webhook URL in Razorpay dashboard: `https://www.samedaysolution.in/api/razorpay/notification`
2. Test endpoint: `curl -X GET https://www.samedaysolution.in/api/razorpay/notification`
3. Check webhook logs in Razorpay dashboard
4. Verify `RAZORPAY_WEBHOOK_SECRET` is set correctly

### Issue: CORS Errors

**Symptoms:** API calls failing with CORS errors

**Solution:**
1. Verify `lib/cors.ts` includes new domain
2. Verify `middleware.ts` includes new domain
3. Check `NEXT_PUBLIC_APP_URL` environment variable
4. Clear browser cache and test

### Issue: Partner Subdomains Not Working

**Symptoms:** Partner subdomains showing errors

**Solution:**
1. Update DNS records for partner subdomains
2. Update code references from `.co.in` to `.in`
3. Verify SSL certificates for partner subdomains

---

## ✅ Post-Migration Checklist

After migration is complete:

- [ ] All APIs working (BBPS, Payout, Razorpay)
- [ ] Razorpay webhooks receiving notifications
- [ ] Frontend loads correctly on `samedaysolution.in`
- [ ] EC2 backend accessible at `api.samedaysolution.in`
- [ ] Partner subdomains working (if applicable)
- [ ] No CORS errors in browser console
- [ ] Environment variables updated in Amplify
- [ ] DNS records updated
- [ ] SSL certificates valid for all domains
- [ ] Redirect from `.co.in` to `.in` working (if set up)
- [ ] Monitoring shows no errors

---

## 📞 Support

If you encounter issues:

1. **Check Application Logs:**
   - Amplify logs in AWS Console
   - EC2 logs (if using separate backend)
   - Browser console for frontend errors

2. **Verify Configuration:**
   - DNS records
   - SSL certificates
   - Environment variables
   - Razorpay webhook configuration

3. **Test Endpoints:**
   ```bash
   # Frontend
   curl https://www.samedaysolution.in
   
   # Razorpay webhook
   curl https://www.samedaysolution.in/api/razorpay/notification
   
   # EC2 backend (if using)
   curl https://api.samedaysolution.in/api/health
   ```

---

**Last Updated:** Based on current codebase
**Status:** Ready for implementation
**Estimated Time:** 1-2 hours (including testing)


