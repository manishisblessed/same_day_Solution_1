# Fix for 401 Unauthorized Errors

## Problem
API endpoints returning 401 Unauthorized errors:
- `/api/wallet/balance`
- `/api/bbps/billers?category=...`

## Root Cause
The issue was caused by a mismatch between client-side and server-side Supabase cookie handling:
1. Client was using `@supabase/supabase-js` (stores in localStorage)
2. Server was using `@supabase/ssr` (expects cookies)
3. No middleware to refresh Supabase sessions

## Solution Applied

### 1. Updated Client-Side Supabase (`lib/supabase/client.ts`)
Changed from `createClient` to `createBrowserClient` from `@supabase/ssr`:
```typescript
// Before
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(...)

// After
import { createBrowserClient } from '@supabase/ssr'
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
```

### 2. Created Middleware (`middleware.ts`)
Added middleware to refresh Supabase sessions automatically:
- Refreshes expired sessions
- Ensures cookies are properly set
- Handles session persistence

### 3. Enhanced Error Logging
Added better error logging in API routes to help debug authentication issues:
- Logs when cookies are missing
- Logs authentication errors
- Provides helpful error messages

## Deployment Steps

1. **Pull latest changes:**
   ```bash
   git pull origin main
   ```

2. **Install dependencies (if needed):**
   ```bash
   npm install
   ```

3. **Rebuild and restart:**
   ```bash
   # On EC2 with PM2
   pm2 restart all
   
   # Or rebuild
   npm run build
   pm2 restart all
   ```

4. **Clear browser cookies and re-login:**
   - Users should clear cookies or use incognito mode
   - Log in again to get new session cookies
   - The new cookies will be compatible with SSR

## Verification

After deployment, check:
1. User can log in successfully
2. `/api/wallet/balance` returns 200 (not 401)
3. `/api/bbps/billers?category=...` returns 200 (not 401)
4. Check PM2 logs for any authentication errors

## If Issues Persist

1. **Check environment variables:**
   ```bash
   # On EC2
   pm2 env 0 | grep SUPABASE
   ```

2. **Verify Supabase configuration:**
   - `NEXT_PUBLIC_SUPABASE_URL` is set
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set

3. **Check cookie settings:**
   - Cookies should be set with `SameSite=Lax` or `SameSite=None; Secure`
   - Domain should match your domain (samedaysolution.in)

4. **Clear all cookies and re-login:**
   - This ensures new SSR-compatible cookies are set

## Technical Details

### Why This Fix Works
- `createBrowserClient` from `@supabase/ssr` uses cookies instead of localStorage
- Middleware refreshes sessions before they expire
- Server-side `getCurrentUserServer` can now read the same cookies
- Consistent cookie handling across client and server

### Cookie Flow
1. User logs in → `createBrowserClient` sets cookies
2. API request → Cookies sent with request
3. Middleware → Refreshes session if needed
4. API route → `getCurrentUserServer` reads cookies
5. Authentication → User authenticated successfully

## Files Changed
- `lib/supabase/client.ts` - Updated to use SSR client
- `middleware.ts` - Created middleware for session refresh
- `lib/auth-server.ts` - Enhanced error logging
- `app/api/wallet/balance/route.ts` - Enhanced error logging
- `app/api/bbps/billers/route.ts` - Enhanced error logging

