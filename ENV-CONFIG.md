# Environment Configuration Guide

## Environment Files

Create `.env.local` files based on your environment:

### Local Development (.env.local)

```env
# Environment
NODE_ENV=development
APP_ENV=dev

# Enable mock BBPS API (no real API calls)
USE_BBPS_MOCK=true

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# BBPS API Configuration (Not used in mock mode)
# BBPS_API_BASE_URL=https://api.sparkuptech.in/api/ba
# BBPS_PARTNER_ID=your_partner_id (or BBPS_CLIENT_ID for backward compatibility)
# BBPS_CONSUMER_KEY=your_consumer_key
# BBPS_CONSUMER_SECRET=your_consumer_secret

# Application URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### UAT Environment (.env.local on EC2)

```env
# Environment
NODE_ENV=production
APP_ENV=uat

# Use real BBPS API (EC2 IP is whitelisted)
BBPS_USE_MOCK=false
BBPS_FORCE_REAL_API=true

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# BBPS API Configuration (Real API - EC2 IP whitelisted)
BBPS_API_BASE_URL=https://api.sparkuptech.in/api/ba
BBPS_PARTNER_ID=your_uat_partner_id (or BBPS_CLIENT_ID for backward compatibility)
BBPS_CONSUMER_KEY=your_uat_consumer_key
BBPS_CONSUMER_SECRET=your_uat_consumer_secret

# Application URL (Your EC2 instance URL)
NEXT_PUBLIC_APP_URL=http://your-ec2-ip:3000
```

### Production Environment (.env.local on EC2)

```env
# Environment
NODE_ENV=production
APP_ENV=prod

# Use real BBPS API (EC2 IP is whitelisted)
USE_BBPS_MOCK=false

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_prod_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_prod_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_prod_supabase_service_role_key

# BBPS API Configuration (Real API - Production credentials)
# EC2 IP must be whitelisted with SparkUpTech
BBPS_API_BASE_URL=https://api.sparkuptech.in/api/ba
BBPS_PARTNER_ID=your_prod_partner_id (or BBPS_CLIENT_ID for backward compatibility)
BBPS_CONSUMER_KEY=your_prod_consumer_key
BBPS_CONSUMER_SECRET=your_prod_consumer_secret

# Application URL (Your production domain)
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

## Quick Setup

### Local Development
```bash
# Create .env.local with DEV configuration
# Set USE_BBPS_MOCK=true
npm run dev
```

### UAT Deployment
```bash
# On EC2, create .env.local with UAT configuration
# Set USE_BBPS_MOCK=false
# Ensure EC2 IP is whitelisted with SparkUpTech
./ec2-deploy.sh
```

### Production Deployment
```bash
# On EC2, create .env.local with PROD configuration
# Set USE_BBPS_MOCK=false
# Use production credentials
# Ensure EC2 IP is whitelisted with SparkUpTech
./ec2-deploy.sh
```

