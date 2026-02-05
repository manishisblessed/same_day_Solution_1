# Deployment Guide: Payout Integration Update

## 🎯 Current Architecture

**Split Architecture:**
- **Frontend**: AWS Amplify (serves Next.js pages/components)
- **Backend**: EC2 (serves API routes - BBPS, Payout, Admin APIs)
- **Routing**: API client routes BBPS/Payout APIs to EC2, others to Amplify

## 📍 Where to Deploy

### ✅ **BOTH EC2 AND AMPLIFY** (Required)

**EC2 (Backend):**
- API route changes (`app/api/admin/settlement/release/route.ts`)
- Service changes (`services/payout/transfer.ts`)
- These handle SparkUpTech API calls (need whitelisted IP)

**Amplify (Frontend):**
- Frontend code (if any UI changes)
- Automatically deploys on Git push to main branch
- No manual deployment needed

### 📋 What Changed in This Update

**Backend Files (EC2):**
1. `services/payout/transfer.ts` - APIRequestID generation
2. `app/api/admin/settlement/release/route.ts` - Settlement payout integration

**Frontend Files (Amplify):**
- No frontend changes in this update
- But Amplify will rebuild on Git push (automatic)

---

## 🚀 Deployment Steps (Both EC2 and Amplify)

### Step 1: Commit and Push to Git (From Local Machine)

**This will trigger:**
- ✅ **Amplify**: Automatic deployment (frontend rebuilds)
- ⚠️ **EC2**: Manual deployment required (see Step 2)

```bash
# On your local machine (Windows)
cd D:\tech\same_day_solution

# Check what files changed
git status

# Add all changes
git add .

# Commit with descriptive message
git commit -m "feat: Integrate SparkUpTech Payout APIs with unique APIRequestID generation

- Updated generateAPIRequestId() to prevent duplicate errors
- Integrated settlement process with SparkUpTech Express Pay
- Added automatic BankID resolution from bankList API
- Updated settlement release route to use initiateTransfer
- Added beneficiary mobile fetching from user tables"

# Push to your repository
git push origin main
# or
git push origin master
```

### Step 2: Verify Amplify Deployment (Automatic)

After pushing to Git:
1. **Go to AWS Amplify Console**: https://console.aws.amazon.com/amplify
2. **Check Deployment Status**: Should show "Deploying" or "Success"
3. **Wait for Completion**: Usually takes 3-5 minutes
4. **Verify**: Frontend should be updated automatically

**Note**: Since there are no frontend changes in this update, Amplify rebuild is just a safety check.

### Step 3: Deploy on EC2 (SSH into EC2) - **REQUIRED**

```bash
# SSH into EC2
ssh -i "C:\Users\hp\Desktop\bbps-uat-key.pem" ubuntu@44.193.29.59

# Navigate to project directory
cd ~/bbps-uat

# Pull latest code from Git
git pull origin main
# or
git pull origin master

# Install/update dependencies (if package.json changed)
npm ci

# Build the application
npm run build

# Restart PM2 processes
pm2 restart bbps-uat
pm2 restart settlement

# Check status
pm2 status

# View logs to verify deployment
pm2 logs bbps-uat --lines 50
```

### Step 4: Verify Deployment

```bash
# Check if application is running
pm2 status

# Check logs for errors
pm2 logs bbps-uat --lines 100

# Test payout APIs (if you have test endpoint)
curl http://localhost:3000/api/payout/balance
```

---

## 🔄 Alternative: Manual File Upload (If Git is not set up)

If you don't have Git configured on EC2:

### Option A: Using SCP (From Local Windows - Git Bash or WSL)

```bash
# From your local machine (Git Bash)
cd D:\tech\same_day_solution

# Upload specific files that changed
scp -i "C:\Users\hp\Desktop\bbps-uat-key.pem" \
  services/payout/transfer.ts \
  app/api/admin/settlement/release/route.ts \
  ubuntu@44.193.29.59:~/bbps-uat/

# Or upload entire project (slower)
scp -i "C:\Users\hp\Desktop\bbps-uat-key.pem" \
  -r . ubuntu@44.193.29.59:~/bbps-uat/
```

### Option B: Using WinSCP (GUI Tool)

1. Download WinSCP: https://winscp.net/
2. Connect to EC2 using your PEM key
3. Navigate to `~/bbps-uat` on EC2
4. Upload changed files:
   - `services/payout/transfer.ts`
   - `app/api/admin/settlement/release/route.ts`
   - `SparkUpTech-Payout-API.postman_collection.json` (if needed)

Then on EC2:
```bash
cd ~/bbps-uat
npm run build
pm2 restart bbps-uat
pm2 restart settlement
```

---

## 📋 Files Changed (For Reference)

These are the files that were updated for payout integration:

1. **`services/payout/transfer.ts`**
   - Updated `generateAPIRequestId()` function
   - Improved unique ID generation (16 digits)

2. **`app/api/admin/settlement/release/route.ts`**
   - Replaced RazorpayX with SparkUpTech Express Pay
   - Added automatic APIRequestID generation
   - Added beneficiary mobile fetching

3. **`SparkUpTech-Payout-API.postman_collection.json`** (New)
   - Postman collection for testing APIs

4. **`POSTMAN-COLLECTION-README.md`** (New)
   - Documentation for Postman collection

---

## ✅ Pre-Deployment Checklist

Before deploying, verify:

- [ ] Code is committed to Git
- [ ] All changes are tested locally (if possible)
- [ ] Environment variables on EC2 are correct:
  - [ ] `BBPS_PARTNER_ID` (or `BBPS_CLIENT_ID`)
  - [ ] `BBPS_CONSUMER_KEY`
  - [ ] `BBPS_CONSUMER_SECRET`
  - [ ] SparkUpTech Payout credentials (if separate from BBPS)
- [ ] EC2 IP is whitelisted with SparkUpTech
- [ ] PM2 processes are running

---

## 🚨 Post-Deployment Verification

After deployment, verify:

1. **Check PM2 Status**:
   ```bash
   pm2 status
   ```
   Should show both `bbps-uat` and `settlement` as `online`

2. **Check Logs**:
   ```bash
   pm2 logs bbps-uat --lines 50
   ```
   Should show no errors related to payout integration

3. **Test Payout Balance** (if endpoint exists):
   ```bash
   curl http://localhost:3000/api/payout/balance
   ```

4. **Test Settlement Flow**:
   - Create a test settlement
   - Approve it as admin
   - Verify it uses SparkUpTech Express Pay
   - Check that unique APIRequestID is generated

---

## 🔧 Troubleshooting

### If PM2 restart fails:

```bash
# Stop processes
pm2 stop bbps-uat
pm2 stop settlement

# Delete processes
pm2 delete bbps-uat
pm2 delete settlement

# Rebuild
npm run build

# Start fresh
pm2 start npm --name "bbps-uat" -- start
pm2 save
```

### If build fails:

```bash
# Clear Next.js cache
rm -rf .next

# Clear node_modules and reinstall
rm -rf node_modules
npm ci

# Rebuild
npm run build
```

### If you see "Data already exist" errors:

This means the old `generateAPIRequestId()` is still running. Verify:
1. Code was properly updated
2. Application was rebuilt (`npm run build`)
3. PM2 was restarted

---

## 📝 Quick Deployment Command (All-in-One)

```bash
# SSH into EC2, then run:
cd ~/bbps-uat && \
git pull origin main && \
npm ci && \
npm run build && \
pm2 restart bbps-uat && \
pm2 restart settlement && \
pm2 status
```

---

## 🎯 Summary

**For this payout integration update:**
- ✅ **Deploy to BOTH EC2 and Amplify**
- ✅ **Amplify**: Automatic on Git push (no action needed)
- ✅ **EC2**: Manual deployment required (pull, build, restart PM2)
- ✅ **Use Git pull** (recommended) or **SCP upload** (alternative)
- ✅ **Rebuild and restart PM2** after deployment

## 📊 Deployment Flow Diagram

```
Local Machine
    │
    ├─ Git Push ──────────────┐
    │                         │
    │                         ▼
    │                  AWS Amplify (Frontend)
    │                         │
    │                         ├─ Auto-deploys on push
    │                         └─ Frontend updated ✅
    │
    └─ SSH to EC2 ────────────┐
                              │
                              ▼
                         EC2 (Backend)
                              │
                              ├─ git pull
                              ├─ npm ci
                              ├─ npm run build
                              └─ pm2 restart
                              └─ Backend updated ✅
```

## ⚠️ Important Notes

1. **Amplify Deployment**: 
   - Happens automatically on `git push`
   - No manual steps needed
   - Check Amplify console to verify

2. **EC2 Deployment**:
   - **MUST be done manually** after Git push
   - Backend API changes won't work until EC2 is updated
   - Settlement payout will fail if EC2 isn't updated

3. **Order of Operations**:
   - Push to Git first (triggers Amplify)
   - Then deploy to EC2 (manual)
   - Verify both are working

---

**Last Updated**: 2026-02-05  
**Deployment Targets**: 
- **Frontend**: AWS Amplify (auto-deploy on Git push)
- **Backend**: EC2 UAT (`bbps-uat`) - manual deployment required

