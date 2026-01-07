# Architecture Overview

This document describes the multi-environment architecture for the Same Day Solution application.

## Environment Structure

```
LOCAL MACHINE (DEV)
 ├── UI / Frontend
 ├── API routes (mocked BBPS)
 ├── No real BBPS calls ❌
 └── Fast development

AWS EC2 (UAT)
 ├── Same backend code
 ├── Real BBPS API calls ✅
 ├── Whitelisted IP
 └── Manual / Postman testing

AWS EC2 (PROD - later)
 ├── Same code
 ├── Live BBPS creds
 └── PM2 + domain
```

## Environment Configuration

### Local Development (DEV)

**Location**: Your local machine  
**Purpose**: Fast development with mocked BBPS API

**Configuration** (`.env.local`):
```env
NODE_ENV=development
APP_ENV=dev
BBPS_USE_MOCK=true
```

**Features**:
- ✅ Mock BBPS API responses
- ✅ No real API calls
- ✅ Fast development cycle
- ✅ No IP whitelisting needed
- ✅ Works offline

**Setup**:
1. Copy `.env.example.dev` to `.env.local`
2. Set `BBPS_USE_MOCK=true`
3. Run `npm run dev`

### UAT Environment

**Location**: AWS EC2 Instance  
**Purpose**: Testing with real BBPS API

**Configuration** (`.env.local` on EC2):
```env
NODE_ENV=production
APP_ENV=uat
BBPS_USE_MOCK=false
BBPS_FORCE_REAL_API=true
```

**Features**:
- ✅ Real BBPS API calls
- ✅ EC2 IP whitelisted
- ✅ UAT/test credentials
- ✅ Manual testing via Postman/UI

**Setup**:
1. Deploy code to EC2
2. Copy `.env.example.uat` to `.env.local`
3. Set real BBPS API credentials
4. Ensure EC2 IP is whitelisted
5. Run deployment script

### Production Environment

**Location**: AWS EC2 Instance  
**Purpose**: Live production system

**Configuration** (`.env.local` on EC2):
```env
NODE_ENV=production
APP_ENV=prod
BBPS_USE_MOCK=false
BBPS_FORCE_REAL_API=true
```

**Features**:
- ✅ Real BBPS API calls
- ✅ Production credentials
- ✅ PM2 process management
- ✅ Domain/SSL configured
- ✅ Monitoring & logging

## Code Flow

### BBPS Service Selection

The application automatically selects the appropriate service based on environment:

```typescript
// lib/bbps/service.ts

const USE_MOCK_DATA = 
  process.env.BBPS_USE_MOCK === 'true' ||
  (APP_ENV === 'dev' && process.env.BBPS_FORCE_REAL_API !== 'true')

if (USE_MOCK_DATA) {
  // Use mock-service.ts
  return mockService.getMockBillers(category)
} else {
  // Use real BBPS API
  return fetchFromBBPSAPI(category)
}
```

### Mock Service

Located in `lib/bbps/mock-service.ts`:
- Provides mock billers by category
- Generates mock bill details
- Simulates payment responses
- 90% success rate for testing

### Real Service

Located in `lib/bbps/service.ts`:
- Makes actual API calls to SparkUpTech
- Requires whitelisted IP (EC2)
- Uses real credentials
- Handles errors and retries

## Deployment Workflow

### 1. Local Development

```bash
# On local machine
cp .env.example.dev .env.local
# Edit .env.local with your values
npm run dev
```

**Result**: Application runs with mocked BBPS API

### 2. Deploy to UAT

```bash
# On EC2
git clone <repo>
cd same-day-solution
cp .env.example.uat .env.local
# Edit .env.local with UAT credentials
chmod +x ec2-deploy.sh
./ec2-deploy.sh
```

**Result**: Application runs with real BBPS API (UAT credentials)

### 3. Deploy to Production

```bash
# On EC2 (separate instance or same)
git clone <repo>
cd same-day-solution
cp .env.example.prod .env.local
# Edit .env.local with PROD credentials
chmod +x ec2-deploy.sh
./ec2-deploy.sh
```

**Result**: Application runs with real BBPS API (Production credentials)

## Environment Variables Reference

| Variable | DEV | UAT | PROD | Description |
|----------|-----|-----|------|-------------|
| `NODE_ENV` | `development` | `production` | `production` | Node environment |
| `APP_ENV` | `dev` | `uat` | `prod` | Application environment |
| `BBPS_USE_MOCK` | `true` | `false` | `false` | Use mock BBPS API |
| `BBPS_FORCE_REAL_API` | `false` | `true` | `true` | Force real API even in dev |
| `BBPS_CLIENT_ID` | (optional) | (required) | (required) | BBPS API Client ID |
| `BBPS_CONSUMER_KEY` | (optional) | (required) | (required) | BBPS API Consumer Key |
| `BBPS_CONSUMER_SECRET` | (optional) | (required) | (required) | BBPS API Consumer Secret |

## Testing Strategy

### Local (DEV)
- ✅ Test UI/UX changes
- ✅ Test business logic
- ✅ Test error handling
- ✅ Fast iteration
- ❌ Cannot test real API responses

### UAT
- ✅ Test real API integration
- ✅ Test with Postman
- ✅ Verify IP whitelisting
- ✅ Test payment flows
- ✅ Load testing

### Production
- ✅ Live system
- ✅ Real transactions
- ✅ Monitoring & alerts
- ✅ Backup & recovery

## Switching Between Modes

### Force Real API in Local Dev

```env
# .env.local
BBPS_USE_MOCK=false
BBPS_FORCE_REAL_API=true
```

**Note**: This requires your local IP to be whitelisted or using SSH tunnel.

### Use Mock in UAT (for testing)

```env
# .env.local on EC2
BBPS_USE_MOCK=true
```

**Note**: Useful for testing UI without making real API calls.

## Best Practices

1. **Never commit `.env.local`** - Use `.env.example.*` files
2. **Separate credentials** - Use different credentials for UAT and PROD
3. **IP Whitelisting** - Only whitelist EC2 IPs, not local IPs
4. **Mock Data** - Keep mock data realistic for better testing
5. **Environment Detection** - Always check `APP_ENV` for environment-specific logic

## Troubleshooting

### Mock not working in local dev

Check:
- `BBPS_USE_MOCK=true` in `.env.local`
- `APP_ENV=dev` is set
- Mock service file exists

### Real API not working in UAT

Check:
- `BBPS_USE_MOCK=false` in `.env.local`
- `BBPS_FORCE_REAL_API=true` is set
- EC2 IP is whitelisted
- Credentials are correct
- Test with `/api/bbps/test` endpoint

### Wrong environment detected

Check:
- `APP_ENV` variable is set correctly
- `NODE_ENV` matches environment
- Restart application after changing env vars

