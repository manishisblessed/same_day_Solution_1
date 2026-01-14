# Domain Setup for BBPS API - Step by Step

## ✅ Current Status
- ✅ Backend working locally on EC2 (`localhost:3000`)
- ✅ Nginx proxy working locally (`localhost/api/bbps/*`)
- ❌ Domain not reaching EC2 (CloudFront redirecting)

## 🎯 Goal
Make `https://samedaysolution.in/api/bbps/*` work by routing through CloudFront to EC2.

## 📋 Architecture Options

You have **two options**:

### Option 1: Configure CloudFront (Recommended if CloudFront is already set up)
- CloudFront forwards `/api/*` → EC2
- CloudFront forwards `/*` → AWS Amplify (frontend)
- CloudFront handles SSL

### Option 2: Point Domain Directly to EC2 (Simpler, but bypasses CloudFront)
- Domain DNS → EC2 directly
- EC2 handles SSL with Let's Encrypt
- Simpler setup, but loses CloudFront benefits

---

## 🚀 Option 1: Configure CloudFront (Recommended)

### Step 1: Get Your EC2 Public IP or Domain

```bash
# On EC2, get your public IP
curl http://169.254.169.254/latest/meta-data/public-ipv4

# Save this IP - you'll need it for CloudFront origin
```

### Step 2: Configure CloudFront Distribution

1. **Go to AWS Console → CloudFront → Distributions**

2. **Find your distribution** (the one serving `samedaysolution.in`)

3. **Add EC2 as an Origin:**
   - Click on your distribution
   - Go to **Origins** tab
   - Click **Create origin**
   - **Origin domain**: Enter your EC2 public IP (e.g., `54.123.45.67`) OR create a custom domain
   - **Name**: `ec2-api-backend` (or any name)
   - **Origin protocol**: `HTTP only` (CloudFront will handle HTTPS)
   - **HTTP port**: `80`
   - Click **Create origin**

4. **Create Behavior for `/api/*`:**
   - Go to **Behaviors** tab
   - Click **Create behavior**
   - **Path pattern**: `/api/*`
   - **Origin and origin groups**: Select `ec2-api-backend` (the origin you just created)
   - **Viewer protocol policy**: `Redirect HTTP to HTTPS`
   - **Allowed HTTP methods**: `GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE`
   - **Cache policy**: Select **"CachingDisabled"** (important for API calls)
   - **Origin request policy**: `CORS-S3Origin` or `AllViewer` (depending on your needs)
   - **Response headers policy**: As needed
   - Click **Create behavior**

5. **Set Behavior Priority:**
   - Make sure `/api/*` behavior has **higher priority** (lower number) than `/*`
   - CloudFront matches more specific paths first
   - `/api/*` should be priority 0 or 1
   - `/*` should be priority 1 or 2

6. **Update Default Behavior (if needed):**
   - The default `/*` behavior should point to **AWS Amplify** (for frontend)
   - This should already be configured

7. **Deploy Changes:**
   - Click **Invalidations** tab
   - Create invalidation for `/api/*` (optional, but recommended)
   - Wait for distribution to deploy (5-15 minutes)

### Step 3: Test CloudFront Configuration

```bash
# Test from your local machine (not EC2)
curl https://samedaysolution.in/api/bbps/categories

# Should return JSON data, not 301 redirect
```

### Step 4: Verify Nginx on EC2 Accepts CloudFront Requests

Your nginx config should already be correct, but verify:

```bash
# On EC2, check nginx config
sudo cat /etc/nginx/conf.d/samedaysolution.conf

# Should have:
# - listen 80;
# - location /api/ { proxy_pass http://localhost:3000; }
```

If CloudFront sends requests with different Host headers, you might need to update nginx:

```nginx
# Allow requests from CloudFront
server {
    listen 80;
    server_name samedaysolution.in www.samedaysolution.in YOUR_EC2_IP;
    
    location /api/ {
        proxy_pass http://localhost:3000;
        # ... rest of config
    }
}
```

---

## 🚀 Option 2: Point Domain Directly to EC2 (Simpler)

If you don't need CloudFront for the API, you can point the domain directly to EC2.

### Step 1: Get EC2 Public IP

```bash
# On EC2
curl http://169.254.169.254/latest/meta-data/public-ipv4
```

### Step 2: Update DNS Records

1. **Go to your DNS provider** (Route 53, GoDaddy, etc.)

2. **Update A Record:**
   - **Type**: A
   - **Name**: `samedaysolution.in` (or `@`)
   - **Value**: Your EC2 public IP
   - **TTL**: 300 (or as needed)

3. **Update CNAME for www (if needed):**
   - **Type**: CNAME
   - **Name**: `www`
   - **Value**: `samedaysolution.in`

### Step 3: Setup SSL on EC2

```bash
# Install Certbot
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d samedaysolution.in -d www.samedaysolution.in

# Certbot will automatically update your nginx config
```

### Step 4: Update Nginx for HTTPS

Certbot should have updated your config, but verify:

```bash
sudo cat /etc/nginx/conf.d/samedaysolution.conf
```

Should have both HTTP (redirect) and HTTPS blocks.

### Step 5: Test

```bash
# Test HTTPS
curl https://samedaysolution.in/api/bbps/categories

# Should return JSON data
```

---

## 🔍 Troubleshooting

### Issue: Still Getting 301 Redirect

**Solution:**
- Wait for DNS propagation (can take up to 48 hours, usually 5-15 minutes)
- Clear DNS cache: `ipconfig /flushdns` (Windows) or `sudo systemd-resolve --flush-caches` (Linux)
- Test with: `curl -v https://samedaysolution.in/api/bbps/categories`

### Issue: 502 Bad Gateway

**Solution:**
- Check if backend is running: `pm2 status`
- Check nginx logs: `sudo tail -50 /var/log/nginx/error.log`
- Verify nginx config: `sudo nginx -t`
- Check if backend is listening: `sudo ss -tlnp | grep 3000`

### Issue: CORS Errors

**Solution:**
- Add CORS headers in nginx or backend
- Verify CloudFront origin request policy allows CORS

### Issue: CloudFront Caching API Responses

**Solution:**
- Make sure `/api/*` behavior uses **"CachingDisabled"** cache policy
- Create invalidation for `/api/*` in CloudFront

---

## ✅ Verification Checklist

After setup, verify:

- [ ] `curl https://samedaysolution.in/api/bbps/categories` returns JSON
- [ ] No 301/302 redirects
- [ ] Backend logs show requests: `pm2 logs bbps-api --lines 20`
- [ ] Nginx logs show requests: `sudo tail -20 /var/log/nginx/samedaysolution.access.log`
- [ ] Frontend can call API (test in browser DevTools → Network tab)

---

## 🎯 Quick Decision Guide

**Choose Option 1 (CloudFront) if:**
- ✅ CloudFront is already set up for frontend
- ✅ You want CDN benefits
- ✅ You want centralized SSL management
- ✅ You have time to configure CloudFront behaviors

**Choose Option 2 (Direct to EC2) if:**
- ✅ You want simpler setup
- ✅ You don't need CloudFront for API
- ✅ You can manage SSL on EC2
- ✅ You want faster setup

---

## 📝 Next Steps After Setup

1. **Test from browser:**
   - Open `https://www.samedaysolution.in`
   - Open DevTools → Network tab
   - Check API calls return 200 OK

2. **Monitor logs:**
   ```bash
   # Backend logs
   pm2 logs bbps-api
   
   # Nginx logs
   sudo tail -f /var/log/nginx/samedaysolution.access.log
   ```

3. **Update frontend (if needed):**
   - Make sure frontend uses relative URLs: `/api/bbps/*`
   - Or set `NEXT_PUBLIC_API_BASE_URL=https://samedaysolution.in` in Amplify

