# POS Partner API - EC2 Deployment Guide

## Prerequisites

- AWS EC2 instance (t3.medium or higher recommended)
- Node.js 18+ installed
- PM2 installed globally (`npm install -g pm2`)
- Nginx configured as reverse proxy
- Supabase database with schema applied
- AWS S3 bucket created for exports

---

## Step 1: Upload Code to EC2

```bash
# Option A: Git clone
cd /home/ec2-user
git clone <your-repo-url> pos-partner-api
cd pos-partner-api

# Option B: SCP from local
scp -r -i ~/.ssh/your-key.pem ./pos-partner-api ec2-user@<EC2-IP>:/home/ec2-user/
```

## Step 2: Install Dependencies

```bash
cd /home/ec2-user/pos-partner-api
npm install --production
```

## Step 3: Configure Environment

```bash
cp env.example .env
nano .env
# Fill in all required values:
# - DATABASE_URL (Supabase direct connection string)
# - AWS credentials
# - S3 bucket name
# - RAZORPAY_WEBHOOK_SECRET
```

## Step 4: Run Database Schema

```bash
# Copy the SQL file contents and run in Supabase SQL Editor:
# sql/001-partner-api-schema.sql
```

## Step 5: Create Logs Directory

```bash
mkdir -p logs
```

## Step 6: Start with PM2

```bash
# Start both API server and export worker
pm2 start ecosystem.config.js

# Check status
pm2 status

# View logs
pm2 logs pos-partner-api
pm2 logs export-worker

# Save PM2 process list (auto-restart on reboot)
pm2 save
pm2 startup
```

## Step 7: Configure Nginx

Add to your nginx config (`/etc/nginx/conf.d/pos-partner-api.conf`):

```nginx
upstream pos_partner_api {
    server 127.0.0.1:4000;
    keepalive 32;
}

server {
    listen 80;
    server_name api.samedaysolution.in;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.samedaysolution.in;

    # SSL Configuration (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/api.samedaysolution.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.samedaysolution.in/privkey.pem;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # POS Partner API
    location /api/partner/ {
        proxy_pass http://pos_partner_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        client_max_body_size 1m;
    }

    # Webhook endpoint
    location /api/webhook/ {
        proxy_pass http://pos_partner_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
        client_max_body_size 1m;
    }

    # Health check
    location /health {
        proxy_pass http://pos_partner_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

```bash
# Test nginx config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

## Step 8: Setup SSL (Let's Encrypt)

```bash
sudo certbot --nginx -d api.samedaysolution.in
```

## Step 9: Setup Cron for Monthly Partitions

```bash
crontab -e

# Add this line (runs on 25th of every month at 2 AM):
0 2 25 * * cd /home/ec2-user/pos-partner-api && /usr/bin/node scripts/createPartition.js >> logs/partition-cron.log 2>&1
```

## Step 10: Generate First Partner API Key

```bash
# First, create a partner in the database (via Supabase SQL Editor):
# INSERT INTO partners (name, business_name, email, phone)
# VALUES ('Partner Name', 'Business Name', 'partner@email.com', '9999999999')
# RETURNING id;

# Then generate API key:
node scripts/generateApiKey.js "<partner_id>" "Production Key"
```

## Step 11: Configure Razorpay Webhook

Set this URL in your Razorpay POS dashboard:
```
https://api.samedaysolution.in/api/webhook/razorpay-pos
```

## Step 12: Verify Deployment

```bash
# Health check
curl https://api.samedaysolution.in/health

# Check PM2 processes
pm2 status

# Check logs
pm2 logs --lines 50

# Check nginx
sudo tail -20 /var/log/nginx/access.log
```

---

## AWS S3 Bucket Setup

```bash
# Create bucket via AWS CLI
aws s3 mb s3://sameday-pos-exports --region ap-south-1

# Set bucket policy (block public access)
aws s3api put-public-access-block \
  --bucket sameday-pos-exports \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Set lifecycle policy (auto-delete exports after 7 days)
aws s3api put-bucket-lifecycle-configuration \
  --bucket sameday-pos-exports \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "ExpireExports",
      "Status": "Enabled",
      "Filter": { "Prefix": "exports/" },
      "Expiration": { "Days": 7 }
    }]
  }'
```

### IAM Policy for S3 Access

Create an IAM user with this minimal policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::sameday-pos-exports",
        "arn:aws:s3:::sameday-pos-exports/*"
      ]
    }
  ]
}
```

---

## Monitoring Commands

```bash
# PM2 Dashboard
pm2 monit

# Memory usage
pm2 describe pos-partner-api

# Restart API
pm2 restart pos-partner-api

# Restart worker
pm2 restart export-worker

# Flush logs
pm2 flush

# View real-time logs
pm2 logs --lines 100
```

---

## Security Checklist

- [ ] `.env` file has proper permissions (`chmod 600 .env`)
- [ ] Nginx enforces HTTPS
- [ ] S3 bucket has block public access enabled
- [ ] API keys stored securely (hashed secrets recommended for future)
- [ ] Rate limiting is active
- [ ] Database SSL is enabled
- [ ] PM2 auto-restart configured (`pm2 startup && pm2 save`)
- [ ] Log rotation configured
- [ ] Firewall allows only ports 80, 443, 22
- [ ] Regular security updates applied


