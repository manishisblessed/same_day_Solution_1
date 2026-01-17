# Solution: SUPABASE_SERVICE_ROLE_KEY Not Available in AWS Amplify

## 🔴 Confirmed Issue

Based on your build logs and test endpoint:
- Build log shows: `!Failed to set up process.env.secrets`
- Test endpoint shows: `serviceRoleKeyExists: false`
- `NEXT_PUBLIC_SUPABASE_URL` works (has `NEXT_PUBLIC_` prefix)
- `SUPABASE_SERVICE_ROLE_KEY` doesn't work (server-side only)

## ✅ The Real Solution

AWS Amplify has a known limitation: **Server-side environment variables (without `NEXT_PUBLIC_` prefix) are NOT automatically available in Next.js API routes at runtime.**

### Solution 1: Use AWS Amplify Secrets (Recommended)

**This is the correct way to handle server-side secrets in Amplify:**

1. **Go to AWS Amplify Console**
   - Navigate to: https://console.aws.amazon.com/amplify
   - Select your app: `same_day_solution`
   - Go to **App settings** → **Secrets** (NOT Environment variables)

2. **Add Secret**
   - Click **Manage secrets**
   - Click **Add secret**
   - **Key:** `SUPABASE_SERVICE_ROLE_KEY`
   - **Value:** Your Supabase service role key (the long JWT token)
   - Click **Save**

3. **Important:** Secrets are stored in AWS Systems Manager Parameter Store
   - They're automatically available at runtime
   - They're encrypted and secure
   - They work in API routes

4. **Redeploy**
   - Go to **Deployments** tab
   - Click **Redeploy this version**
   - Wait for deployment to complete

5. **Verify**
   - Visit: https://main.dcj9lvldewcag.amplifyapp.com/api/test-env-vars
   - Should show: `serviceRoleKeyExists: true`

### Solution 2: Fix Environment Variables (If Secrets Don't Work)

If you prefer to use Environment Variables instead of Secrets:

1. **Delete and Re-add the Variable**
   - Go to **App settings** → **Environment variables**
   - Delete `SUPABASE_SERVICE_ROLE_KEY` if it exists
   - Click **Manage variables** → **Add variable**
   - **Key:** `SUPABASE_SERVICE_ROLE_KEY` (exact, case-sensitive)
   - **Value:** Your complete service role key
   - **Branch:** Select "All branches" or your specific branch
   - Click **Save**

2. **Verify No Typos**
   - Variable name must be exactly: `SUPABASE_SERVICE_ROLE_KEY`
   - No spaces before or after the value
   - Value should be ~200+ characters (JWT token starting with `eyJ`)

3. **Check Build Settings**
   - Go to **App settings** → **Build settings**
   - Ensure `amplify.yml` exists (we created it)
   - The build should show env vars in preBuild phase

4. **Redeploy**
   - **CRITICAL:** After any env var change, redeploy
   - Go to **Deployments** → **Redeploy this version**

### Solution 3: Use NEXT_PUBLIC_ Prefix (NOT Recommended - Security Risk)

⚠️ **WARNING:** Only use this as a temporary workaround for testing. The service role key will be exposed to the client-side.

1. In Amplify Console → Environment variables
2. Add: `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` (with `NEXT_PUBLIC_` prefix)
3. Update code to use `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` instead
4. **Remove this immediately after testing** - it's a security risk!

## 🔍 Why This Happens

AWS Amplify's architecture:
- **Client-side variables** (`NEXT_PUBLIC_*`): Embedded in the build, available everywhere
- **Server-side variables** (no prefix): Should be available in API routes, but Amplify has limitations
- **Secrets**: Stored in SSM Parameter Store, guaranteed to be available at runtime

The build log shows `!Failed to set up process.env.secrets`, which means:
- Either Secrets aren't configured
- Or there's an SSM permissions issue
- Or the variable is set in Environment Variables but not accessible at runtime

## 📋 Step-by-Step: Use Secrets (Recommended)

1. **Get Your Service Role Key**
   - Go to Supabase Dashboard → Your Project → Settings → API
   - Copy the **service_role key** (secret, not the anon key)
   - It should start with `eyJ` and be ~200+ characters

2. **Add to Amplify Secrets**
   ```
   AWS Amplify Console
   → Your App (same_day_solution)
   → App settings
   → Secrets
   → Manage secrets
   → Add secret
   → Key: SUPABASE_SERVICE_ROLE_KEY
   → Value: [paste your key]
   → Save
   ```

3. **Redeploy**
   ```
   Deployments tab
   → Redeploy this version
   → Wait for completion
   ```

4. **Test**
   ```
   Visit: https://main.dcj9lvldewcag.amplifyapp.com/api/test-env-vars
   Should show: serviceRoleKeyExists: true
   ```

## 🛠️ Troubleshooting

### Issue: Secrets Still Not Working

If Secrets don't work after redeploy:

1. **Check IAM Permissions**
   - Amplify needs permission to read SSM parameters
   - This is usually automatic, but check if there are IAM errors in build logs

2. **Check Build Logs**
   - Look for: `Setting Up SSM Secrets`
   - Should show: `Successfully set up process.env.secrets`
   - If it shows an error, there's a permissions issue

3. **Try Environment Variables Instead**
   - Use Solution 2 above
   - Some Amplify configurations work better with env vars

### Issue: Variable Set But Still Not Available

1. **Check Variable Scope**
   - Ensure it's set for the correct branch (or "All branches")
   - The branch name must match exactly

2. **Check for Typos**
   - Variable name: `SUPABASE_SERVICE_ROLE_KEY` (exact)
   - No extra spaces or characters

3. **Verify Value**
   - Should be a complete JWT token
   - Starts with `eyJ`
   - ~200+ characters long

4. **Force Redeploy**
   - Sometimes Amplify caches env vars
   - Delete and re-add the variable
   - Redeploy

## ✅ Verification Checklist

After implementing the solution:

- [ ] Secret/Variable added in Amplify Console
- [ ] Application redeployed
- [ ] Build logs show variable is set (check preBuild phase)
- [ ] `/api/test-env-vars` shows `serviceRoleKeyExists: true`
- [ ] `/api/admin/upload-document` works without errors
- [ ] CloudWatch logs show variable is accessible

## 📞 If Still Not Working

If after trying all solutions the variable is still not available:

1. **Check AWS Amplify Service Status**
   - Ensure Amplify service is operational

2. **Review Build Logs Carefully**
   - Look for any SSM/Secrets errors
   - Check if variable appears in preBuild phase

3. **Contact AWS Support**
   - This might be an Amplify platform issue
   - Provide them with:
     - Build logs
     - Test endpoint results
     - Steps you've tried

4. **Alternative: Use Different Deployment**
   - Consider deploying API routes to a different service (e.g., AWS Lambda, EC2)
   - Keep frontend on Amplify, API on EC2/Lambda

---

**Last Updated:** January 2025  
**Test Endpoint:** https://main.dcj9lvldewcag.amplifyapp.com/api/test-env-vars

