# EC2 Quick Start Guide (Windows to EC2)

This guide helps you deploy from your Windows machine to EC2.

## Prerequisites

1. **EC2 Instance** running (Ubuntu or Amazon Linux)
2. **SSH Access** to your EC2 instance
3. **EC2 Public IP** whitelisted with SparkUpTech for BBPS API

## Step 1: Connect to EC2

### Using Git Bash / WSL / PowerShell

```bash
# Replace with your EC2 details
ssh -i "your-key.pem" ubuntu@your-ec2-ip
# OR for Amazon Linux:
ssh -i "your-key.pem" ec2-user@your-ec2-ip
```

### Using PuTTY (Windows)

1. Convert `.pem` to `.ppk` using PuTTYgen
2. Connect using PuTTY with your EC2 IP and the `.ppk` file

## Step 2: Upload Files to EC2

### Option A: Using SCP (Git Bash / WSL)

```bash
# From your local machine (in Git Bash)
cd /d/tech/same_day_solution

# Upload entire project
scp -i "your-key.pem" -r . ubuntu@your-ec2-ip:~/same-day-solution

# OR upload just the scripts first
scp -i "your-key.pem" ec2-setup.sh ec2-deploy.sh ec2.config.js ubuntu@your-ec2-ip:~/
```

### Option B: Using Git (Recommended)

```bash
# On EC2 instance (after SSH)
cd ~
git clone <your-repo-url> same-day-solution
cd same-day-solution
```

### Option C: Using WinSCP (Windows GUI)

1. Download WinSCP
2. Connect to EC2 using your `.ppk` file
3. Drag and drop your project folder to EC2

## Step 3: Run Setup Script on EC2

**Important**: Run these commands **ON THE EC2 INSTANCE** (after SSH), not on your Windows machine!

```bash
# SSH into EC2 first, then:
cd ~/same-day-solution  # or wherever you uploaded the files

# Make scripts executable
chmod +x ec2-setup.sh
chmod +x ec2-deploy.sh

# Run initial setup (installs Node.js, PM2, etc.)
./ec2-setup.sh
```

## Step 4: Configure Environment Variables on EC2

```bash
# On EC2 instance
cd ~/same-day-solution
nano .env.local
```

Add your environment variables (see `EC2-DEPLOYMENT.md` for full list):

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# BBPS API (SparkUpTech) - Use real credentials on EC2
BBPS_API_BASE_URL=https://api.sparkuptech.in/api/ba
BBPS_PARTNER_ID=your_partner_id
BBPS_CONSUMER_KEY=your_consumer_key
BBPS_CONSUMER_SECRET=your_consumer_secret

# Application Environment
APP_ENV=uat  # or 'prod' for production
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_APP_URL=http://your-ec2-ip:3000
```

**Important**: 
- Use `APP_ENV=uat` or `APP_ENV=prod` on EC2 (not `dev`)
- Do NOT set `BBPS_USE_MOCK=true` on EC2 (you want real API calls)

## Step 5: Deploy Application

```bash
# On EC2 instance
cd ~/same-day-solution
./ec2-deploy.sh
```

This will:
- Install dependencies (`npm ci`)
- Build the application (`npm run build`)
- Start with PM2 (`pm2 start ec2.config.js`)

## Step 6: Verify Deployment

```bash
# Check PM2 status
pm2 status

# View logs
pm2 logs same-day-solution

# Check if app is running
curl http://localhost:3000
```

## Step 7: Access Your Application

Open in browser:
```
http://your-ec2-ip:3000
```

Or if you have a domain:
```
https://your-domain.com
```

## Troubleshooting

### "sudo: command not found"
- **Problem**: You're running the script on Windows, not EC2
- **Solution**: SSH into EC2 first, then run the script there

### "Permission denied (publickey)"
- **Problem**: SSH key not found or wrong permissions
- **Solution**: 
  ```bash
  # On Windows (Git Bash)
  chmod 400 your-key.pem
  ssh -i "your-key.pem" ubuntu@your-ec2-ip
  ```

### "Port 3000 not accessible"
- **Problem**: Security group not configured
- **Solution**: In AWS Console → EC2 → Security Groups → Add inbound rule for port 3000

### "BBPS API Unauthorized"
- **Problem**: EC2 IP not whitelisted
- **Solution**: Contact SparkUpTech to whitelist your EC2 public IP

## Quick Commands Reference

```bash
# SSH into EC2
ssh -i "your-key.pem" ubuntu@your-ec2-ip

# Upload files
scp -i "your-key.pem" -r . ubuntu@your-ec2-ip:~/same-day-solution

# On EC2: Check Node.js
node --version

# On EC2: Check PM2
pm2 list

# On EC2: Restart app
pm2 restart same-day-solution

# On EC2: View logs
pm2 logs same-day-solution --lines 50

# On EC2: Stop app
pm2 stop same-day-solution
```

## Next Steps

- See `EC2-DEPLOYMENT.md` for detailed deployment instructions
- See `SETUP-SUMMARY.md` for architecture overview
- See `BBPS-LOCAL-DEVELOPMENT.md` for local dev setup

