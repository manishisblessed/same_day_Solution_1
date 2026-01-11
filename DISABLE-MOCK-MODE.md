# How to Disable Mock Mode and Use Real BBPS API in Localhost

## Quick Fix

To use the **real BBPS API** in localhost, you need to ensure the following:

### 1. Create/Update `.env.local` file

Create a `.env.local` file in the root directory with these settings:

```env
# Disable Mock Mode - Use Real BBPS API
USE_BBPS_MOCK=false

# OR simply don't set USE_BBPS_MOCK at all (it defaults to false)

# BBPS API Credentials (Required for Real API)
BBPS_PARTNER_ID=2400XX
BBPS_CONSUMER_KEY=b2078d92ff9XXXX
BBPS_CONSUMER_SECRET=ba6fba9775548XXX

# BBPS Auth Token (Required for payRequest endpoint)
BBPS_AUTH_TOKEN=your_bearer_token_here

# BBPS API Base URL (Optional - defaults to production URL)
BBPS_API_BASE_URL=https://api.sparkuptech.in/api/ba

# Force Real API (Optional - helps ensure real API is used)
BBPS_FORCE_REAL_API=true
```

### 2. Restart Your Development Server

After updating `.env.local`, restart your Next.js development server:

```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm run dev
```

### 3. Verify Mock Mode is Disabled

Check the console output when the server starts. You should see:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 BBPS Service Configuration:
{
  APP_ENV: 'dev',
  NODE_ENV: 'development',
  BBPS_USE_MOCK: undefined,  // or 'false'
  BBPS_FORCE_REAL_API: 'true',
  MODE: 'REAL API'  // ✅ Should say "REAL API"
}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Or if using the new services, you should see:
```
🔥 BBPS LIVE API CALLED: getBillersByCategoryAndChannel
```

Instead of:
```
🧪 BBPS MOCK API CALLED: getBillersByCategoryAndChannel
```

## Environment Variables Explained

| Variable | Value | Description |
|----------|-------|-------------|
| `USE_BBPS_MOCK` | `false` or unset | **Disables mock mode** - uses real BBPS API |
| `USE_BBPS_MOCK` | `true` | Enables mock mode - uses fake data |
| `BBPS_PARTNER_ID` | Your partner ID | Required for real API calls |
| `BBPS_CONSUMER_KEY` | Your consumer key | Required for real API calls |
| `BBPS_CONSUMER_SECRET` | Your consumer secret | Required for real API calls |
| `BBPS_AUTH_TOKEN` | Bearer token | Required for payRequest endpoint |
| `BBPS_FORCE_REAL_API` | `true` | Forces real API even in dev mode |

## How Mock Mode Detection Works

The system checks mock mode in this order:

1. **New Services** (`services/bbps/*`):
   - Checks `USE_BBPS_MOCK` environment variable
   - If `USE_BBPS_MOCK === 'true'` → Mock Mode
   - Otherwise → Real API (default)

2. **Old Services** (`lib/bbps/service.ts`):
   - Checks `BBPS_USE_MOCK` environment variable
   - Or automatically uses mock if `APP_ENV=dev` and `BBPS_FORCE_REAL_API` is not set

## Troubleshooting

### Still seeing mock data?

1. **Check your `.env.local` file exists** and has the correct values
2. **Restart your dev server** - environment variables are loaded at startup
3. **Check for typos** - variable names are case-sensitive
4. **Verify credentials** - Make sure your BBPS credentials are correct
5. **Check console logs** - Look for `[BBPS Mock]` or `🧪 BBPS MOCK` messages

### Getting "BBPS API credentials not configured" error?

Make sure you have set:
- `BBPS_PARTNER_ID` (or `BBPS_CLIENT_ID`)
- `BBPS_CONSUMER_KEY`
- `BBPS_CONSUMER_SECRET`

### Getting authentication errors?

- Verify your credentials are correct
- Check if your IP is whitelisted (if required by SparkUpTech)
- Ensure `BBPS_AUTH_TOKEN` is set for payment requests

## Testing

After disabling mock mode, test by:

1. **Fetch Billers**: Should return real billers from SparkUpTech API
2. **Fetch Bill**: Should return real bill details from SparkUpTech API
3. **Make Payment**: Should process real payment through SparkUpTech API

## Production Ready

Once you've verified the real API works in localhost, you're ready for production! The same configuration will work in production environments.

