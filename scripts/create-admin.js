const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env.local')
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function createAdmin() {
  // Get arguments or use defaults
  const email = process.argv[2] || 'admin@samedaysolution.in'
  const password = process.argv[3] || 'Admin@123'
  const name = process.argv[4] || 'Admin User'

  console.log('\n🚀 Creating admin user...')
  console.log(`Email: ${email}`)
  console.log(`Name: ${name}\n`)

  // Check if user already exists in admin_users table
  const { data: existingAdmin } = await supabase
    .from('admin_users')
    .select('*')
    .eq('email', email)
    .single()

  if (existingAdmin) {
    console.log('⚠️  Admin user already exists in admin_users table')
    console.log('Checking if auth user exists...\n')
    
    // Check if auth user exists
    const { data: { users } } = await supabase.auth.admin.listUsers()
    const authUser = users.find(u => u.email === email)
    
    if (authUser) {
      console.log('✅ Auth user exists. Admin is ready to use!')
      console.log(`Login at: http://localhost:3000/admin/login`)
      return
    } else {
      console.log('❌ Auth user not found. Creating auth user...')
    }
  }

  // Step 1: Create auth user
  console.log('Step 1: Creating authentication user...')
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError) {
    if (authError.message.includes('already registered')) {
      console.log('⚠️  Auth user already exists. Continuing...')
    } else {
      console.error('❌ Error creating auth user:', authError.message)
      process.exit(1)
    }
  } else {
    console.log('✅ Auth user created:', authData.user.id)
  }

  // Step 2: Insert into admin_users table
  console.log('Step 2: Creating admin record...')
  const { data: adminData, error: adminError } = await supabase
    .from('admin_users')
    .insert([{ email, name }])
    .select()
    .single()

  if (adminError) {
    if (adminError.code === '23505') { // Unique constraint violation
      console.log('⚠️  Admin record already exists. Updating...')
      const { data: updatedData, error: updateError } = await supabase
        .from('admin_users')
        .update({ name })
        .eq('email', email)
        .select()
        .single()

      if (updateError) {
        console.error('❌ Error updating admin record:', updateError.message)
        process.exit(1)
      }
      console.log('✅ Admin record updated')
    } else {
      console.error('❌ Error creating admin record:', adminError.message)
      process.exit(1)
    }
  } else {
    console.log('✅ Admin record created')
  }

  console.log('\n🎉 Admin user created successfully!')
  console.log('\n📋 Login Credentials:')
  console.log(`   Email: ${email}`)
  console.log(`   Password: ${password}`)
  console.log(`   Name: ${name}`)
  console.log(`\n🔗 Login URL: http://localhost:3000/admin/login`)
  console.log('\n⚠️  Remember to change the password after first login!\n')
}

createAdmin().catch(console.error)

