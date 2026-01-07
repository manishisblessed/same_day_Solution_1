# BBPS Local Development Setup

## Problem
When developing on localhost, your API calls to BBPS come from your local IP, but the BBPS API only accepts requests from your whitelisted EC2 instance IP.

## Solutions

### Option 1: SSH Tunnel (Recommended for Local Development)

Create an SSH tunnel to route your API calls through the EC2 instance:

```bash
# Create SSH tunnel (replace with your EC2 details)
ssh -L 3001:api.sparkuptech.in:443 -N user@your-ec2-instance-ip

# Or if using SSH key:
ssh -i ~/.ssh/your-key.pem -L 3001:api.sparkuptech.in:443 -N ec2-user@your-ec2-instance-ip
```

Then update your `.env.local`:
```env
BBPS_API_BASE_URL=https://localhost:3001/api/ba
```

**Note:** This requires the EC2 instance to have network access to the BBPS API.

### Option 2: Deploy to EC2 for Testing

Deploy your Next.js app to EC2 and test from there. All API calls will automatically use the EC2 IP.

### Option 3: Use Environment-Specific Configuration

Create different configurations for local vs production:

**For Local Development:**
- Mock the BBPS API responses
- Use cached biller data from database
- Skip actual API calls

**For Production (EC2):**
- Use real BBPS API calls
- All requests come from whitelisted IP

### Option 4: Request Temporary IP Whitelisting

Contact SparkUpTech to temporarily whitelist your local development IP address.

## Recommended Approach

For now, use **Option 3** - work with cached/mock data locally, and test real API calls on EC2.

