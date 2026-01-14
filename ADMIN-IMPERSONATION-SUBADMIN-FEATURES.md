# Admin Impersonation & Sub-Admin System

## Overview
This document describes the implementation of two major admin features:
1. **Admin Impersonation** - Allows admins to login directly as any retailer, distributor, or master distributor
2. **Sub-Admin System** - Department-based role management for admins

## Features Implemented

### 1. Admin Impersonation (Login As)

#### Database Changes
- Created `admin_impersonation_sessions` table to track impersonation sessions
- Tracks: admin_id, impersonated_user_id, role, timestamps, IP address, user agent

#### API Endpoints
- `POST /api/admin/impersonate` - Start impersonation session
- `DELETE /api/admin/impersonate?session_id=xxx` - End impersonation session

#### UI Changes
- Added "Login As" button (blue LogIn icon) in admin dashboard actions
- Button appears for retailers, distributors, and master distributors
- Automatically redirects to appropriate dashboard after impersonation

#### Auth Context Updates
- Added `impersonate()` function to AuthContext
- Added `endImpersonation()` function to return to admin view
- Updated AuthUser type to include impersonation flags

### 2. Sub-Admin System

#### Database Changes
Extended `admin_users` table with:
- `admin_type` - 'super_admin' or 'sub_admin'
- `department` - Department assignment (wallet, commission, mdr, limits, services, reversals, disputes, reports, users, settings, all)
- `permissions` - JSONB field for granular permissions
- `is_active` - Enable/disable admin accounts
- `created_by` - Track who created the sub-admin

#### Permission System
- Super admins have all permissions
- Sub-admins are restricted to their assigned department
- Granular permissions via JSONB field
- Function: `check_admin_permission(admin_id, department, action)`

## Migration Instructions

1. **Run the database migration:**
   ```sql
   -- Run this in Supabase SQL Editor
   -- File: supabase-admin-sub-admin-impersonation-migration.sql
   ```

2. **Update existing admins:**
   - All existing admins will be set as `super_admin` with `department = 'all'`
   - They will have full permissions

## Usage

### Impersonation
1. Navigate to Admin Dashboard
2. Go to Retailers, Distributors, or Master Distributors tab
3. Click the blue "Login As" button (LogIn icon) next to any user
4. You will be automatically logged in as that user
5. A banner will show you're impersonating (to be implemented)
6. Use "Return to Admin" button to end impersonation

### Sub-Admin Management
1. Navigate to Admin Settings
2. Go to "Sub-Admins" tab (to be implemented)
3. Create new sub-admins with:
   - Email and name
   - Department assignment
   - Granular permissions
4. Sub-admins will only see features related to their department

## Security Considerations

1. **Impersonation Sessions:**
   - All impersonation sessions are logged
   - IP address and user agent are tracked
   - Sessions can be ended by the admin
   - Original admin session is preserved

2. **Sub-Admin Permissions:**
   - Sub-admins cannot impersonate users
   - Sub-admins cannot create other admins
   - Department-based access control enforced at API level

## Next Steps (To Be Implemented)

1. **Impersonation Banner:**
   - Add banner component showing "You are logged in as [User Name]"
   - Add "Return to Admin" button in banner

2. **Sub-Admin Management UI:**
   - Create sub-admin management page
   - Add form to create/edit sub-admins
   - List all sub-admins with their departments
   - Enable/disable sub-admins

3. **Role-Based Access Control:**
   - Add middleware to check permissions
   - Hide UI elements based on permissions
   - Add permission checks to all admin API endpoints

4. **Audit Logging:**
   - Log all impersonation actions
   - Log sub-admin actions
   - Track permission changes

## API Examples

### Start Impersonation
```typescript
POST /api/admin/impersonate
{
  "user_id": "RET12345678",
  "user_role": "retailer"
}

Response:
{
  "success": true,
  "user": {
    "id": "...",
    "email": "retailer@example.com",
    "name": "Retailer Name",
    "role": "retailer",
    "partner_id": "RET12345678",
    "is_impersonated": true,
    "original_admin_id": "...",
    "impersonation_session_id": "..."
  },
  "redirect_url": "/dashboard/retailer"
}
```

### End Impersonation
```typescript
DELETE /api/admin/impersonate?session_id=xxx

Response:
{
  "success": true,
  "message": "Impersonation session ended"
}
```

## Database Schema

### admin_impersonation_sessions
```sql
- id (UUID)
- admin_id (UUID) -> admin_users.id
- impersonated_user_id (TEXT)
- impersonated_user_role (TEXT)
- impersonated_user_email (TEXT)
- session_token (TEXT)
- started_at (TIMESTAMP)
- ended_at (TIMESTAMP)
- ip_address (TEXT)
- user_agent (TEXT)
- is_active (BOOLEAN)
```

### admin_users (Extended)
```sql
- id (UUID)
- email (TEXT)
- name (TEXT)
- role (TEXT) - 'admin'
- admin_type (TEXT) - 'super_admin' | 'sub_admin'
- department (TEXT) - Department name
- permissions (JSONB) - Granular permissions
- is_active (BOOLEAN)
- created_by (UUID) -> admin_users.id
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

