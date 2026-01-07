# Deployment Readiness Checklist

## 🔐 Safety Checks

### ✅ Hard Fail Safety Guard
- [x] Real BBPS API blocked in DEV environment
- [x] Throws error if `APP_ENV=dev` and `BBPS_USE_MOCK !== 'true'`
- [x] Prevents accidental real-money calls

### ✅ Startup Logging
- [x] Mode logged once at startup (not on every request)
- [x] Shows APP_ENV, BBPS_USE_MOCK, BBPS_FORCE_REAL_API
- [x] Clear indication of MOCK vs REAL API mode

### ✅ Mock Response Schema
- [x] Mock responses match real BBPS API structure
- [x] Field names match (transaction_id, status, payment_status, etc.)
- [x] Error structures match real API
- [x] Status codes consistent

### ✅ Request IDs
- [x] Request IDs generated in all operations
- [x] Format: `REQ-{timestamp}-{random}` or `TXN-{timestamp}-{random}`
- [x] Consistent across mock and real API

---

## 🧪 UAT Environment Checklist

### Infrastructure
- [ ] EC2 instance created and running
- [ ] EC2 IP address: `_________________`
- [ ] Security group configured:
  - [ ] Port 22 (SSH) open
  - [ ] Port 3000 (or chosen port) open
  - [ ] Port 443 (HTTPS) open (if using SSL)

### BBPS API Configuration
- [ ] EC2 IP whitelisted with SparkUpTech
- [ ] Whitelist confirmation received
- [ ] UAT BBPS credentials obtained:
  - [ ] Client ID: `_________________`
  - [ ] Consumer Key: `_________________`
  - [ ] Consumer Secret: `_________________`

### Environment Variables
- [ ] `.env.local` created on EC2
- [ ] `APP_ENV=uat` set
- [ ] `NODE_ENV=production` set
- [ ] `BBPS_USE_MOCK=false` set
- [ ] `BBPS_FORCE_REAL_API=true` set
- [ ] All BBPS credentials configured
- [ ] Supabase credentials configured
- [ ] `NEXT_PUBLIC_APP_URL` set to EC2 URL

### Code Deployment
- [ ] Code deployed to EC2
- [ ] Dependencies installed (`npm ci`)
- [ ] Build successful (`npm run build`)
- [ ] PM2 configured and running
- [ ] Application accessible at EC2 URL

### Verification Tests
- [ ] Application starts without errors
- [ ] Logs show: `MODE: REAL API`
- [ ] Test endpoint: `http://ec2-ip:3000/api/bbps/test`
  - [ ] Returns `USE_MOCK_MODE: false`
  - [ ] Shows API connection status
  - [ ] Credentials verified
- [ ] BBPS billers endpoint works
- [ ] Can fetch bill details (test with mock consumer number)
- [ ] Payment flow tested (with test amounts)

### Security
- [ ] `.env.local` not committed to Git
- [ ] `.env.local` has correct permissions (600)
- [ ] No sensitive data in logs
- [ ] PM2 logs configured
- [ ] Error logging working

---

## 🚀 Production Environment Checklist

### Infrastructure
- [ ] Separate EC2 instance from UAT
- [ ] Production domain configured: `_________________`
- [ ] SSL certificate installed (Let's Encrypt)
- [ ] Nginx reverse proxy configured
- [ ] Security group locked down
- [ ] Backup strategy in place

### BBPS API Configuration
- [ ] Production EC2 IP whitelisted
- [ ] Production BBPS credentials obtained:
  - [ ] Client ID: `_________________`
  - [ ] Consumer Key: `_________________`
  - [ ] Consumer Secret: `_________________`
- [ ] Separate from UAT credentials

### Environment Variables
- [ ] `.env.local` created on PROD EC2
- [ ] `APP_ENV=prod` set
- [ ] `NODE_ENV=production` set
- [ ] `BBPS_USE_MOCK=false` set
- [ ] `BBPS_FORCE_REAL_API=true` set
- [ ] Production BBPS credentials configured
- [ ] Production Supabase credentials configured
- [ ] `NEXT_PUBLIC_APP_URL` set to production domain

### Code Deployment
- [ ] Code deployed to PROD EC2
- [ ] Dependencies installed
- [ ] Build successful
- [ ] PM2 configured with production settings
- [ ] Application accessible at production domain

### Security & Monitoring
- [ ] All mock code paths disabled (verified)
- [ ] Request/response masking in logs enabled
- [ ] Error logging configured
- [ ] Monitoring alerts set up
- [ ] Backup procedures documented
- [ ] Rollback plan documented

### Testing
- [ ] Smoke tests passed
- [ ] Payment flow tested (small amounts)
- [ ] Error handling verified
- [ ] Performance tested
- [ ] Load testing completed

---

## 🔍 Verification Commands

### Check Active Mode
```bash
# On EC2, check PM2 logs
pm2 logs same-day-solution | grep "BBPS Service Configuration"
```

### Test BBPS API Connection
```bash
# Visit in browser or use curl
curl http://your-ec2-ip:3000/api/bbps/test
```

### Verify Environment
```bash
# On EC2
cd ~/same-day-solution
cat .env.local | grep -E "APP_ENV|BBPS_USE_MOCK|BBPS_FORCE_REAL_API"
```

### Check Application Status
```bash
# On EC2
pm2 status
pm2 info same-day-solution
```

---

## 📝 Notes

- **Never** set `BBPS_USE_MOCK=true` in UAT or PROD
- **Always** verify mode in logs before going live
- **Test** with small amounts first
- **Monitor** logs for first 24 hours after deployment
- **Keep** UAT and PROD credentials separate

---

## 🆘 Emergency Contacts

- BBPS API Support: `_________________`
- EC2 Admin: `_________________`
- DevOps Team: `_________________`

---

**Last Updated**: _______________
**Deployed By**: _______________
**Verified By**: _______________

