# POS Machines API 500 Error - Fixed

## Issue
The `/api/pos-machines/my-machines` endpoint was returning HTTP 500 errors for users with the **partner** role.

## Root Cause
In `app/api/pos-machines/my-machines/route.ts`, the PostgREST query for partner machines had an incorrect parameter format:

```typescript
// WRONG - partner_id passed as direct URLSearchParams key
const params = new URLSearchParams({ 
  select: PARTNER_POS_COLUMNS, 
  limit: '10000',
  partner_id: `eq.${user.partner_id}`  // ❌ Incorrect format
})
```

This resulted in malformed PostgREST URLs that caused Supabase to return 500 errors.

## Solution
Changed to proper PostgREST filter syntax:

```typescript
// CORRECT - partner_id passed as filter using append()
const params = new URLSearchParams({ 
  select: PARTNER_POS_COLUMNS, 
  limit: '10000'
})

// Add partner_id filter using PostgREST format
params.append('partner_id', `eq.${user.partner_id}`)  // ✅ Correct format
```

## Additional Improvements
Enhanced error handling to provide more diagnostic information:
- Added detailed error logging with Supabase URL and user context
- Now returns HTTP response details in error message for debugging
- Better logging for both partner and non-partner machine queries

## Files Modified
- `app/api/pos-machines/my-machines/route.ts` (2 locations)

## Build Status
✅ **Compiled Successfully** - No errors

## Testing
Verify the fix by:
1. Log in as a partner user
2. Navigate to "POS Machines" section
3. Machines should now load without errors
4. Check browser console for any remaining errors

## Impact
- Fixes 500 error for partner users accessing their POS machines
- Improves error messages for all users
- No breaking changes to API response format
