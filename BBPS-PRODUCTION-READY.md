# BBPS Production Readiness Checklist

## ✅ Pre-Deployment Checklist

### 1. Environment Variables
- [x] `USE_BBPS_MOCK=false` (for production)
- [x] `BBPS_API_BASE_URL=https://api.sparkuptech.in/api/ba`
- [x] `BBPS_PARTNER_ID` set with production credentials
- [x] `BBPS_CONSUMER_KEY` set with production credentials
- [x] `BBPS_CONSUMER_SECRET` set with production credentials
- [x] All credentials stored in `.env.local` (not committed to Git)

### 2. IP Whitelisting
- [x] EC2 instance IP whitelisted with SparkUpTech
- [x] IP address verified and confirmed with vendor
- [x] Test API call successful from EC2 instance

### 3. Security
- [x] All BBPS endpoints require RETAILER role authentication
- [x] No hardcoded credentials in codebase
- [x] `.env.local` in `.gitignore`
- [x] Headers use correct format: `partnerid`, `consumerKey`, `consumerSecret`

### 4. API Endpoints Status
- [x] Get Billers by Category: `GET /api/bbps/billers`
- [x] Get Billers by Category and Payment Channel: `POST /api/bbps/billers-by-category` (NEW)
- [x] Fetch Biller Info: `POST /api/bbps/biller-info`
- [x] Fetch Bill Details: `POST /api/bbps/bill/fetch`
- [x] Pay Bill: `POST /api/bbps/bill/pay`
- [x] Transaction Status: `POST /api/bbps/transaction-status`
- [x] Complaint Registration: `POST /api/bbps/complaint/register`
- [x] Complaint Tracking: `POST /api/bbps/complaint/track`
- [x] Get Categories: `GET /api/bbps/categories`

### 5. Error Handling
- [x] All endpoints have proper error handling
- [x] Error messages are user-friendly
- [x] Network failures are handled gracefully
- [x] API timeouts configured (30 seconds default)

### 6. Logging
- [x] Live API calls logged with 🔥 emoji
- [x] Mock API calls logged with 🧪 emoji
- [x] No sensitive data in logs
- [x] Logs visible in PM2

### 7. Testing
- [x] All endpoints tested in UAT environment
- [x] Mock mode tested locally
- [x] Live mode tested on EC2
- [x] Retailer authentication verified
- [x] Non-retailer access blocked (403)

## 🚀 Deployment Steps

### 1. Pre-Deployment
```bash
# Verify environment variables
cat .env.local | grep BBPS

# Verify IP whitelisting
curl -I https://api.sparkuptech.in/api/ba/billerId/getList

# Test mock mode locally
USE_BBPS_MOCK=true npm run dev
```

### 2. Deployment
```bash
# On EC2 instance
git pull origin main
npm install
# Ensure .env.local has USE_BBPS_MOCK=false
pm2 restart all
pm2 logs
```

### 3. Post-Deployment Verification
```bash
# Check PM2 logs for BBPS API calls
pm2 logs | grep "BBPS"

# Should see: 🔥 BBPS LIVE API CALLED

# Test endpoint as retailer
curl -X POST https://your-domain.com/api/bbps/billers-by-category \
  -H "Content-Type: application/json" \
  -H "Cookie: your-auth-cookie" \
  -d '{"fieldValue": "Credit Card", "paymentChannelName1": "INT"}'
```

## 📋 Production Environment Variables

```env
# Production BBPS Configuration
USE_BBPS_MOCK=false
BBPS_API_BASE_URL=https://api.sparkuptech.in/api/ba
BBPS_PARTNER_ID=your_production_partner_id
BBPS_CONSUMER_KEY=your_production_consumer_key
BBPS_CONSUMER_SECRET=your_production_consumer_secret
```

## 🔍 Monitoring

### PM2 Logs
```bash
# View all logs
pm2 logs

# View only BBPS-related logs
pm2 logs | grep "BBPS"

# Expected output for live API:
# 🔥 BBPS LIVE API CALLED: getBillersByCategoryAndChannel
```

### Health Checks
- Monitor `/api/bbps/categories` endpoint (should return 200)
- Monitor `/api/bbps/billers-by-category` endpoint (should require auth)
- Check PM2 process status: `pm2 status`

## 🛡️ Security Checklist

- [x] No credentials in code
- [x] No credentials in logs
- [x] `.env.local` in `.gitignore`
- [x] All endpoints require authentication
- [x] RETAILER role check on all BBPS endpoints
- [x] IP whitelisting confirmed
- [x] HTTPS enabled (if using custom domain)

## 📞 Support

If issues arise:
1. Check PM2 logs: `pm2 logs`
2. Verify environment variables: `pm2 env 0`
3. Test IP whitelisting: Contact SparkUpTech support
4. Verify credentials: Check with vendor

## ✅ Ready for Production

Once all checklist items are complete, the BBPS integration is ready for production use by retailers.

