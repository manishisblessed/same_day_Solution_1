# EC2 Deployment Guide

This guide will help you deploy the Same Day Solution application to your EC2 instance.

## Prerequisites

1. **EC2 Instance** with:
   - Ubuntu 20.04+ or Amazon Linux 2
   - At least 2GB RAM
   - Security group allowing:
     - Port 22 (SSH)
     - Port 3000 (or your chosen port) for the application
     - Port 443 (HTTPS) if using SSL

2. **BBPS API IP Whitelisting**: Your EC2 instance's public IP must be whitelisted with SparkUpTech

## Step 1: Initial EC2 Setup

**⚠️ IMPORTANT**: These scripts must be run **ON THE EC2 INSTANCE**, not on your local Windows machine!

### First: Upload Files to EC2

From your local machine (Git Bash / WSL):

```bash
# Upload project files to EC2
scp -i "your-key.pem" -r . ubuntu@your-ec2-ip:~/same-day-solution

# OR use Git to clone on EC2 (recommended)
```

### Then: SSH into EC2 and Run Setup

```bash
# SSH into EC2
ssh -i "your-key.pem" ubuntu@your-ec2-ip

# On EC2 instance:
cd ~/same-day-solution
chmod +x ec2-setup.sh
./ec2-setup.sh
```

**Note**: If you see "sudo: command not found", you're running it on Windows. You must SSH into EC2 first!

This will install:
- Node.js 18+
- npm
- PM2 (process manager)
- Git

## Step 2: Deploy Your Application

### Option A: Using Git (Recommended)

```bash
# Clone your repository
cd ~
git clone <your-repo-url> same-day-solution
cd same-day-solution

# Install dependencies and build
npm ci
npm run build
```

### Option B: Upload Files

```bash
# Create directory
mkdir -p ~/same-day-solution
cd ~/same-day-solution

# Upload your project files (using SCP, SFTP, or AWS CLI)
# Then:
npm ci
npm run build
```

## Step 3: Configure Environment Variables

Create a `.env.local` file on your EC2 instance:

```bash
nano ~/same-day-solution/.env.local
```

Add all required environment variables:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# BBPS API (SparkUpTech)
BBPS_API_BASE_URL=https://api.sparkuptech.in/api/ba
BBPS_CLIENT_ID=your_client_id
BBPS_CONSUMER_KEY=your_consumer_key
BBPS_CONSUMER_SECRET=your_consumer_secret

# Razorpay (if using)
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# Application
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_APP_URL=http://your-ec2-ip:3000
```

**Important**: Never commit `.env.local` to Git!

## Step 4: Deploy and Start

```bash
cd ~/same-day-solution
chmod +x ec2-deploy.sh
./ec2-deploy.sh
```

Or manually:

```bash
npm ci
npm run build
pm2 start npm --name "same-day-solution" -- start
pm2 save
```

## Step 5: Configure PM2 (Process Manager)

```bash
# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Follow the instructions it provides

# View application status
pm2 status

# View logs
pm2 logs same-day-solution

# Restart application
pm2 restart same-day-solution

# Stop application
pm2 stop same-day-solution
```

## Step 6: Configure Nginx (Optional but Recommended)

For production, use Nginx as a reverse proxy:

```bash
# Install Nginx
sudo yum install nginx -y  # Amazon Linux
# or
sudo apt-get install nginx -y  # Ubuntu

# Create Nginx configuration
sudo nano /etc/nginx/conf.d/same-day-solution.conf
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;  # or your EC2 IP

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Test Nginx configuration
sudo nginx -t

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

## Step 7: Setup SSL with Let's Encrypt (Optional)

```bash
# Install Certbot
sudo yum install certbot python3-certbot-nginx -y  # Amazon Linux
# or
sudo apt-get install certbot python3-certbot-nginx -y  # Ubuntu

# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is set up automatically
```

## Step 8: Verify Deployment

1. **Check Application Status**:
   ```bash
   pm2 status
   curl http://localhost:3000
   ```

2. **Check BBPS API Connection**:
   Visit: `http://your-ec2-ip:3000/api/bbps/test`
   This should show successful connection if IP is whitelisted.

3. **Check Logs**:
   ```bash
   pm2 logs same-day-solution
   ```

## Troubleshooting

### Application won't start

```bash
# Check Node.js version
node -v  # Should be 18+

# Check if port is in use
sudo netstat -tulpn | grep 3000

# Check PM2 logs
pm2 logs same-day-solution --lines 100
```

### BBPS API Connection Fails

1. Verify EC2 IP is whitelisted with SparkUpTech
2. Check environment variables are set correctly
3. Test API connection: `curl http://localhost:3000/api/bbps/test`
4. Check server logs: `pm2 logs same-day-solution`

### Database Connection Issues

1. Verify Supabase credentials in `.env.local`
2. Check Supabase project is active
3. Verify RLS policies allow connections from your IP

### Memory Issues

```bash
# Check memory usage
free -h
pm2 monit

# If needed, increase swap space
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## Updating the Application

```bash
cd ~/same-day-solution

# Pull latest changes (if using Git)
git pull

# Or upload new files

# Rebuild
npm ci
npm run build

# Restart
pm2 restart same-day-solution
```

## Monitoring

```bash
# View real-time monitoring
pm2 monit

# View application info
pm2 info same-day-solution

# View process list
pm2 list
```

## Security Checklist

- [ ] Environment variables are set and secure
- [ ] `.env.local` is not committed to Git
- [ ] Firewall rules are configured correctly
- [ ] SSL certificate is installed (for production)
- [ ] Regular backups are configured
- [ ] PM2 is configured to auto-restart
- [ ] Logs are being monitored

## Support

If you encounter issues:
1. Check PM2 logs: `pm2 logs same-day-solution`
2. Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
3. Verify all environment variables are set
4. Test BBPS API connection using `/api/bbps/test` endpoint

