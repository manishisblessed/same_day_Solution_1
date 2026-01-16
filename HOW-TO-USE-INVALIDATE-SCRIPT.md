# How to Use the CloudFront Invalidation PowerShell Script

## ⚡ Quick Reference

**Most Common Usage:**

```powershell
# Auto-detect distribution and invalidate everything
.\invalidate-cloudfront.ps1

# With Distribution ID (faster)
.\invalidate-cloudfront.ps1 -DistributionId "E2MIH1B011QKFW"

# Invalidate specific paths only (use array syntax for multiple paths)
.\invalidate-cloudfront.ps1 -DistributionId "E2MIH1B011QKFW" -Paths @("/admin", "/admin/*")
```

**Important:** For multiple paths, always use PowerShell array syntax: `@("/path1", "/path2")`

---

## 📋 Prerequisites

Before running the script, you need:

### 1. AWS CLI Installed

**Check if AWS CLI is installed:**
```powershell
aws --version
```

**If not installed, install it:**

**Option A: Using winget (Windows 10/11)**
```powershell
winget install Amazon.AWSCLI
```

**Option B: Using MSI Installer**
1. Download from: https://aws.amazon.com/cli/
2. Run the installer
3. Restart PowerShell after installation

**Option C: Using Chocolatey**
```powershell
choco install awscli
```

### 2. AWS Credentials Configured

**Configure AWS credentials:**
```powershell
aws configure
```

You'll be prompted for:
- **AWS Access Key ID**: Your AWS access key
- **AWS Secret Access Key**: Your AWS secret key
- **Default region name**: e.g., `us-east-1`, `ap-south-1`, etc.
- **Default output format**: `json` (recommended)

**Where to get AWS credentials:**
1. Go to AWS Console → IAM → Users
2. Select your user (or create a new one)
3. Go to "Security credentials" tab
4. Click "Create access key"
5. Download or copy the Access Key ID and Secret Access Key

**Required IAM Permissions:**
Your AWS user needs these permissions:
- `cloudfront:CreateInvalidation`
- `cloudfront:GetInvalidation`
- `cloudfront:ListDistributions`

You can attach the `CloudFrontFullAccess` policy or create a custom policy with just these permissions.

### 3. PowerShell Execution Policy

**Check current execution policy:**
```powershell
Get-ExecutionPolicy
```

**If it's `Restricted`, change it (run PowerShell as Administrator):**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

This allows running local scripts while still requiring signed scripts from the internet.

## 🚀 How to Run the Script

### Method 1: Simple Usage (Auto-Detect Distribution)

The script can automatically find your CloudFront distribution:

```powershell
# Navigate to the project directory
cd D:\tech\same_day_solution

# Run the script
.\invalidate-cloudfront.ps1
```

The script will:
1. ✅ Check if AWS CLI is installed
2. 🔍 Search for CloudFront distribution with domain `samedaysolution.in`
3. 📝 Create invalidation for all paths (`/*`)
4. ⏳ Monitor progress until completion
5. ✅ Show success message when done

### Method 2: Specify Distribution ID Manually

If auto-detection doesn't work, you can provide the Distribution ID:

```powershell
.\invalidate-cloudfront.ps1 -DistributionId "E1234567890ABC"
```

**How to find your Distribution ID:**
1. Go to AWS Console → CloudFront → Distributions
2. Click on your distribution
3. Copy the Distribution ID from the top of the page
4. Or use this command:
   ```powershell
   aws cloudfront list-distributions --query "DistributionList.Items[*].[Id,DomainName,Aliases.Items]" --output table
   ```

### Method 3: Invalidate Specific Paths Only

To invalidate only specific paths (more cost-effective), use **array syntax**:

```powershell
# Invalidate only admin pages (use @() for array syntax)
.\invalidate-cloudfront.ps1 -DistributionId "E2MIH1B011QKFW" -Paths @("/admin", "/admin/*")

# Invalidate multiple specific paths
.\invalidate-cloudfront.ps1 -DistributionId "E2MIH1B011QKFW" -Paths @("/admin", "/admin/*", "/_next/static/*")

# Single path (no array needed)
.\invalidate-cloudfront.ps1 -DistributionId "E2MIH1B011QKFW" -Paths "/admin"
```

**Important:** When passing multiple paths, you **must** use PowerShell array syntax `@("/path1", "/path2")`. Space-separated strings won't work.

**Note:** AWS allows 1,000 free invalidations per month. After that, each path costs $0.005.

### Method 4: Combine Options

```powershell
# With auto-detection and specific paths
.\invalidate-cloudfront.ps1 -Paths @("/admin", "/admin/*")

# With manual Distribution ID and specific paths
.\invalidate-cloudfront.ps1 -DistributionId "E2MIH1B011QKFW" -Paths @("/admin", "/admin/*")
```

## 📺 What to Expect

When you run the script, you'll see output like this:

```
🔍 Searching for CloudFront distribution with domain 'samedaysolution.in'...
✅ Found distribution: E1234567890ABC

Creating CloudFront invalidation...
  Distribution ID: E1234567890ABC
  Paths: /*

✅ Invalidation created successfully!
  Invalidation ID: I1234567890XYZ
  Status: InProgress

⏳ Waiting for invalidation to complete...
   (This usually takes 1-5 minutes)
  Status: InProgress (Elapsed: 00:10)
  Status: InProgress (Elapsed: 00:20)
  Status: InProgress (Elapsed: 00:30)
  Status: Completed (Elapsed: 00:45)

✅ Invalidation completed successfully!
   Your latest deployment should now be visible at:
   https://samedaysolution.in/admin
```

## 🔧 Troubleshooting

### Issue 1: "AWS CLI is not installed"

**Error:**
```
❌ AWS CLI is not installed or not in PATH
```

**Solution:**
1. Install AWS CLI (see Prerequisites section)
2. Restart PowerShell after installation
3. Verify: `aws --version`

### Issue 2: "Could not find CloudFront distribution"

**Error:**
```
❌ Could not find CloudFront distribution for 'samedaysolution.in'
```

**Solutions:**

**Option A: Provide Distribution ID manually**
```powershell
.\invalidate-cloudfront.ps1 -DistributionId "YOUR_DISTRIBUTION_ID"
```

**Option B: Check if domain is correct**
```powershell
# List all distributions to see their domains
aws cloudfront list-distributions --query "DistributionList.Items[*].[Id,Aliases.Items]" --output table
```

**Option C: Check AWS region**
Make sure you're using the correct AWS region where your CloudFront distribution is located:
```powershell
aws configure list
# Check the region value
```

### Issue 3: "Access Denied" or Permission Errors

**Error:**
```
An error occurred (AccessDenied) when calling the CreateInvalidation operation
```

**Solution:**
1. Check your AWS credentials:
   ```powershell
   aws sts get-caller-identity
   ```
2. Verify IAM permissions (see Prerequisites)
3. Make sure you're using the correct AWS account

### Issue 4: "Execution Policy" Error

**Error:**
```
cannot be loaded because running scripts is disabled on this system
```

**Solution:**
Run PowerShell as Administrator and execute:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Issue 5: Script Runs But Invalidation Never Completes

**Solution:**
- The script has a 10-minute timeout
- If it times out, check the AWS Console manually
- Invalidations can take up to 15 minutes for large distributions
- You can check status manually:
  ```powershell
  aws cloudfront get-invalidation --distribution-id "YOUR_DIST_ID" --id "INVALIDATION_ID"
  ```

## 🎯 Quick Start Checklist

- [ ] AWS CLI installed (`aws --version` works)
- [ ] AWS credentials configured (`aws configure` done)
- [ ] PowerShell execution policy allows scripts
- [ ] Navigated to project directory
- [ ] Run: `.\invalidate-cloudfront.ps1`
- [ ] Wait for completion (1-5 minutes)
- [ ] Test: Open `https://samedaysolution.in/admin` in incognito window

## 💡 Pro Tips

### Tip 1: Create an Alias

Add this to your PowerShell profile for quick access:

```powershell
# Open profile
notepad $PROFILE

# Add this line:
function Invalidate-CloudFront { & "D:\tech\same_day_solution\invalidate-cloudfront.ps1" @args }

# Then you can just run:
Invalidate-CloudFront
```

### Tip 2: Add to Git Hooks

You can automatically invalidate CloudFront after deployment by adding to your deployment script or GitHub Actions.

### Tip 3: Use Targeted Invalidations

Instead of invalidating everything (`/*`), invalidate only what changed:
```powershell
# After deploying admin changes
.\invalidate-cloudfront.ps1 -Paths "/admin" "/admin/*"
```

## 📚 Additional Commands

### List All CloudFront Distributions
```powershell
aws cloudfront list-distributions --query "DistributionList.Items[*].[Id,DomainName,Aliases.Items[0],Status]" --output table
```

### Check Invalidation Status Manually
```powershell
aws cloudfront get-invalidation --distribution-id "YOUR_DIST_ID" --id "INVALIDATION_ID"
```

### List Recent Invalidations
```powershell
aws cloudfront list-invalidations --distribution-id "YOUR_DIST_ID" --max-items 10
```

## ✅ Verification After Running

1. **Wait for script to complete** (shows "✅ Invalidation completed successfully!")

2. **Test in browser:**
   - Open `https://samedaysolution.in/admin` in an **incognito/private window**
   - Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)

3. **Compare with Amplify URL:**
   - Both should show the same content
   - `https://main.dcj9lvldewcag.amplifyapp.com/admin` (Amplify)
   - `https://samedaysolution.in/admin` (CloudFront)

4. **If still seeing old content:**
   - Wait 2-3 more minutes (edge locations update asynchronously)
   - Clear browser cache completely
   - Try a different browser or device

---

**Need Help?** If you encounter any issues not covered here, check the error message and refer to the troubleshooting section or AWS CloudFront documentation.

