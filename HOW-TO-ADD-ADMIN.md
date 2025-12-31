# How to Add Admin User with Password

This guide shows you multiple ways to create an admin user with a password for the Same Day Solution admin dashboard.

## Method 1: Using Supabase Dashboard (Easiest)

### Step 1: Create Auth User
1. Go to your Supabase project dashboard
2. Navigate to **Authentication** > **Users**
3. Click **"Add User"** button
4. Fill in the form:
   - **Email**: Enter admin email (e.g., `admin@samedaysolution.in`)
   - **Password**: Enter a strong password
   - **Auto Confirm User**: ✅ Check this box (so user can login immediately)
5. Click **"Create User"**

### Step 2: Add to admin_users Table
1. Go to **Table Editor** > **admin_users**
2. Click **"Insert"** > **"Insert Row"**
3. Fill in:
   - **email**: Same email you used in Step 1
   - **name**: Admin's full name (e.g., "Admin User")
4. Click **"Save"**

✅ **Done!** You can now login at `/admin/login` with the email and password you created.

---

## Method 2: Using SQL (Quick)

### Step 1: Create Auth User via SQL
Run this SQL in Supabase SQL Editor:

```sql
-- This creates the auth user (you'll need to use Supabase Management API or Dashboard for password)
-- For now, create the auth user via Dashboard (Method 1, Step 1), then run Step 2 below
```

### Step 2: Insert into admin_users Table
After creating the auth user via Dashboard, run:

```sql
INSERT INTO admin_users (email, name) 
VALUES ('admin@samedaysolution.in', 'Admin User')
ON CONFLICT (email) DO NOTHING;
```

---

## Method 3: Using Node.js Script (Automated)

Create a file `scripts/create-admin.js` and run it:

```javascript
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function createAdmin() {
  const email = process.argv[2] || 'admin@samedaysolution.in'
  const password = process.argv[3] || 'Admin@123'
  const name = process.argv[4] || 'Admin User'

  console.log(`Creating admin user: ${email}`)

  // Step 1: Create auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError) {
    console.error('Error creating auth user:', authError.message)
    process.exit(1)
  }

  console.log('✅ Auth user created:', authData.user.id)

  // Step 2: Insert into admin_users table
  const { data: adminData, error: adminError } = await supabase
    .from('admin_users')
    .insert([{ email, name }])
    .select()
    .single()

  if (adminError) {
    console.error('Error creating admin record:', adminError.message)
    // Try to delete auth user if admin creation fails
    await supabase.auth.admin.deleteUser(authData.user.id)
    process.exit(1)
  }

  console.log('✅ Admin user created successfully!')
  console.log('Email:', email)
  console.log('Password:', password)
  console.log('Name:', name)
  console.log('\nYou can now login at: http://localhost:3000/admin/login')
}

createAdmin()
```

**Usage:**
```bash
node scripts/create-admin.js admin@example.com MySecurePassword123 "Admin Name"
```

---

## Method 4: Using API Route (From Your App)

You can also create an admin user programmatically using the existing API route, but you'll need to modify it slightly or create a one-time script.

---

## Quick Setup Commands

### Using Supabase Dashboard:
1. **Auth User**: Dashboard > Authentication > Users > Add User
2. **Admin Record**: Dashboard > Table Editor > admin_users > Insert Row

### Using SQL (after creating auth user):
```sql
INSERT INTO admin_users (email, name) 
VALUES ('your-admin@email.com', 'Admin Name');
```

---

## Verify Admin User

After creating the admin user, verify it works:

1. Start your development server: `npm run dev`
2. Navigate to: `http://localhost:3000/admin/login`
3. Login with:
   - **Email**: The email you used
   - **Password**: The password you set
4. You should be redirected to `/admin` dashboard

---

## Troubleshooting

### "User not found or inactive"
- Make sure the email in `admin_users` table matches the email in Auth users
- Check that you created both the auth user AND the admin_users record

### "Invalid credentials"
- Verify the password is correct
- Make sure the auth user was created successfully
- Check that email confirmation is enabled (auto-confirm)

### "Email already exists"
- The email is already registered in Supabase Auth
- Use a different email or reset the password in Authentication > Users

---

## Security Best Practices

1. **Use Strong Passwords**: Minimum 12 characters, mix of uppercase, lowercase, numbers, and symbols
2. **Change Default Passwords**: Never use default passwords like "admin123"
3. **Limit Admin Users**: Only create admin users for trusted personnel
4. **Enable 2FA**: Consider enabling two-factor authentication in Supabase
5. **Regular Audits**: Periodically review admin users and remove unused accounts

---

## Example Admin Credentials (Change These!)

```
Email: admin@samedaysolution.in
Password: ChangeThisPassword123!
Name: System Administrator
```

**⚠️ Remember to change the default password immediately after first login!**

