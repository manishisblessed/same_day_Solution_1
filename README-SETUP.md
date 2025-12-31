# Admin & Role-Based Dashboard Setup Guide

This guide will help you set up the admin dashboard and role-based authentication system for Same Day Solution.

## Prerequisites

1. A Supabase account (sign up at https://supabase.com)
2. Node.js 18+ installed
3. npm or yarn package manager

## Step 1: Create Supabase Project

1. Go to https://supabase.com and create a new project
2. Wait for the project to be fully provisioned
3. Note down your project URL and anon key from Settings > API

## Step 2: Set Up Database Schema

1. In your Supabase dashboard, go to SQL Editor
2. Copy the contents of `supabase-schema.sql`
3. Paste and run the SQL script
4. This will create all necessary tables:
   - `admin_users` - For admin accounts
   - `master_distributors` - For master distributor accounts
   - `distributors` - For distributor accounts
   - `retailers` - For retailer accounts

## Step 3: Configure Environment Variables

Create a `.env.local` file in the root directory:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# For admin user creation, you'll need the service role key (keep this secret!)
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Step 4: Create Admin User

You can create an admin user in multiple ways. **See `HOW-TO-ADD-ADMIN.md` for detailed instructions.**

### Quick Method: Using Script (Recommended)
```bash
npm run create-admin admin@example.com YourSecurePassword123 "Admin Name"
```

Or use defaults:
```bash
npm run create-admin
# Creates: admin@samedaysolution.in / Admin@123 / Admin User
```

### Alternative Methods:
1. **Supabase Dashboard** - See `HOW-TO-ADD-ADMIN.md` Method 1
2. **SQL** - See `HOW-TO-ADD-ADMIN.md` Method 2
3. **Manual** - Create auth user in Dashboard, then insert into `admin_users` table

## Step 5: Install Dependencies

```bash
npm install
```

## Step 6: Run the Development Server

```bash
npm run dev
```

## Step 7: Access the Admin Dashboard

1. Navigate to `http://localhost:3000/admin/login`
2. Login with your admin credentials
3. You'll be redirected to the admin dashboard at `/admin`

## Features

### Admin Dashboard (`/admin`)
- **CRUD Operations**: Create, Read, Update, Delete retailers, distributors, and master distributors
- **Search & Filter**: Search by name, email, partner ID, or phone. Filter by status
- **Statistics**: View total, active, inactive, and suspended counts
- **Real-time Updates**: Changes reflect immediately

### Role-Based Dashboards

#### Retailer Dashboard (`/dashboard/retailer`)
- Transaction statistics
- Revenue tracking
- Customer management
- Commission earnings
- Transaction history
- Performance charts

#### Distributor Dashboard (`/dashboard/distributor`)
- Retailer network management
- Network performance analytics
- Revenue and commission tracking
- Retailer status overview
- Performance metrics

#### Master Distributor Dashboard (`/dashboard/master-distributor`)
- Distributor network overview
- Multi-level network analytics
- Revenue trends
- Commission tracking
- Network growth visualization

## Business Login Flow

1. Navigate to `/business-login`
2. Select your role (Retailer, Distributor, or Master Distributor)
3. Enter email and password
4. You'll be redirected to your role-specific dashboard

## Adding New Users

### As Admin:
1. Login to admin dashboard
2. Select the appropriate tab (Retailers, Distributors, or Master Distributors)
3. Click "Add [Role]" button
4. Fill in the form:
   - **Required**: Name, Email, Phone, Password
   - **Optional**: Business details, address, GST number, commission rate
   - **Relationships**: Link to distributor/master distributor if applicable
5. Click "Create"
6. The system will:
   - Generate a unique Partner ID
   - Create an authentication account
   - Add the user to the appropriate table

## Database Structure

### Relationships:
- **Retailers** can be linked to:
  - A Distributor (via `distributor_id`)
  - A Master Distributor (via `master_distributor_id`)
  
- **Distributors** can be linked to:
  - A Master Distributor (via `master_distributor_id`)

- **Master Distributors** are top-level (no parent)

## Security Notes

1. **Row Level Security (RLS)**: Currently set to allow all reads. For production, implement more restrictive policies based on user roles.

2. **Authentication**: Uses Supabase Auth for secure authentication.

3. **Environment Variables**: Never commit `.env.local` to version control.

4. **Service Role Key**: Keep the service role key secret and only use it server-side.

## Troubleshooting

### "Supabase environment variables are not set"
- Make sure `.env.local` exists and contains `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Restart the development server after adding environment variables

### "User not found or inactive"
- Check that the user exists in the appropriate table (retailers, distributors, or master_distributors)
- Verify the user's status is 'active'

### "Authentication failed"
- Verify the email and password are correct
- Check that the user exists in both Supabase Auth and the respective table

## Next Steps

1. **Customize Dashboards**: Add more features specific to your business needs
2. **Add Transactions**: Create a transactions table and integrate with your payment system
3. **Implement Reports**: Add detailed reporting and analytics
4. **Add Notifications**: Implement email/SMS notifications for important events
5. **Enhance Security**: Implement more restrictive RLS policies based on your requirements

## Support

For issues or questions, please contact the development team.

