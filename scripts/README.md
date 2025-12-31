# Scripts Directory

This directory contains utility scripts for managing the Same Day Solution application.

## Available Scripts

### create-admin.js

Creates an admin user with password in Supabase.

**Usage:**
```bash
# With custom credentials
npm run create-admin admin@example.com MyPassword123 "Admin Name"

# With defaults (admin@samedaysolution.in / Admin@123 / Admin User)
npm run create-admin
```

**Requirements:**
- `.env.local` file with Supabase credentials:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

**What it does:**
1. Creates an authentication user in Supabase Auth
2. Inserts a record in the `admin_users` table
3. Outputs login credentials

**Example:**
```bash
npm run create-admin admin@samedaysolution.in SecurePass123! "System Admin"
```

Output:
```
🚀 Creating admin user...
Email: admin@samedaysolution.in
Name: System Admin

Step 1: Creating authentication user...
✅ Auth user created: abc123-def456-...

Step 2: Creating admin record...
✅ Admin record created

🎉 Admin user created successfully!

📋 Login Credentials:
   Email: admin@samedaysolution.in
   Password: SecurePass123!
   Name: System Admin

🔗 Login URL: http://localhost:3000/admin/login

⚠️  Remember to change the password after first login!
```

