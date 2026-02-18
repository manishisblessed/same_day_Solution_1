import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

// Lazy initialization to avoid build-time errors
let supabase: SupabaseClient | null = null

function getSupabaseAdmin(): SupabaseClient {
  if (!supabase) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not configured')
    }
    
    supabase = createClient(supabaseUrl, supabaseServiceKey)
  }
  return supabase
}

/**
 * Create user (retailer, distributor, or master distributor)
 * 
 * Authorization:
 * - Super admins: Can create any user
 * - Sub-admins: Must have 'users' department permission
 */
export async function POST(request: NextRequest) {
  try {
    // Check admin authentication with fallback and timeout
    const authPromise = getCurrentUserWithFallback(request)
    const authTimeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Authentication timeout')), 10000)
    )
    
    let authResult: { user: any; method: string }
    try {
      authResult = await Promise.race([authPromise, authTimeoutPromise]) as any
    } catch (authError: any) {
      console.error('[Create User API] Authentication error or timeout:', authError)
      return NextResponse.json(
        { error: 'Authentication failed or timed out. Please try again.', code: 'AUTH_TIMEOUT' },
        { status: 401 }
      )
    }

    const { user: admin, method } = authResult
    console.log('[Create User API] Auth method:', method, '| User:', admin?.email || 'none')

    if (!admin) {
      return NextResponse.json(
        { error: 'Session expired. Please log out and log back in.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
    }

    if (admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      )
    }

    // Get Supabase admin client
    const supabase = getSupabaseAdmin()

    // Check admin permissions (super_admin or sub_admin with 'users' department)
    // Use timeout for database query
    const adminQueryPromise = supabase
      .from('admin_users')
      .select('id, admin_type, department, departments, is_active')
      .eq('email', admin.email)
      .single()
    
    const adminQueryTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Database query timeout')), 15000)
    )
    
    let adminQueryResult
    try {
      adminQueryResult = await Promise.race([adminQueryPromise, adminQueryTimeoutPromise]) as any
    } catch (queryError: any) {
      console.error('[Create User API] Admin query timeout or error:', queryError)
      return NextResponse.json(
        { error: 'Database query timed out. Please try again.' },
        { status: 504 }
      )
    }
    
    const { data: adminData, error: adminError } = adminQueryResult

    if (adminError || !adminData) {
      console.error('[Create User API] Error fetching admin data:', adminError)
      return NextResponse.json(
        { error: 'User not allowed' },
        { status: 403 }
      )
    }

    // Check if admin is active
    if (adminData.is_active === false) {
      console.error('[Create User API] Admin is not active')
      return NextResponse.json(
        { error: 'User not allowed' },
        { status: 403 }
      )
    }

    // Determine admin type (handle legacy admins without admin_type)
    const adminType = adminData.admin_type || 'super_admin' // Default to super_admin for legacy admins

    // Super admins have all permissions (including legacy admins without admin_type)
    if (adminType === 'super_admin') {
      // Allow super admin to proceed - they can create any user
      console.log('[Create User API] Super admin authorized to create user')
    } else if (adminType === 'sub_admin') {
      // Check if sub-admin has 'users' department permission
      const hasUsersDepartment = 
        adminData.department === 'users' || 
        adminData.department === 'all' ||
        (adminData.departments && (
          Array.isArray(adminData.departments) && (
            adminData.departments.includes('users') || 
            adminData.departments.includes('all')
          )
        ))

      if (!hasUsersDepartment) {
        console.error('[Create User API] Sub-admin does not have users department permission', {
          department: adminData.department,
          departments: adminData.departments
        })
        return NextResponse.json(
          { error: 'User not allowed' },
          { status: 403 }
        )
      }
      console.log('[Create User API] Sub-admin with users department authorized to create user')
    } else {
      // Unknown admin type - deny access
      console.error('[Create User API] Unknown admin type:', adminType)
      return NextResponse.json(
        { error: 'User not allowed' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { email, password, role, tableName, userData } = body

    if (!email || !password || !role || !tableName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Create auth user with timeout
    const createUserPromise = supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    
    const createUserTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Create user timeout')), 15000)
    )
    
    let createUserResult
    try {
      createUserResult = await Promise.race([createUserPromise, createUserTimeoutPromise]) as any
    } catch (createError: any) {
      console.error('[Create User API] Create user timeout or error:', createError)
      return NextResponse.json(
        { error: 'Failed to create user account. Please try again.' },
        { status: 504 }
      )
    }
    
    const { data: authData, error: authError } = createUserResult

    if (authError) {
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      )
    }

    // Validate hierarchy requirements
    if (tableName === 'partners') {
      // Partners don't have hierarchy requirements - they're standalone
      // If partner record already exists (has id), we'll update it instead of inserting
      // This allows creating password for existing partners
    } else if (tableName === 'distributors') {
      if (!userData.master_distributor_id) {
        await supabase.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Master Distributor is required to create a Distributor' },
          { status: 400 }
        )
      }
      
      // Verify master distributor exists and is active (with timeout)
      const masterDistQueryPromise = supabase
        .from('master_distributors')
        .select('id, partner_id, status')
        .eq('partner_id', userData.master_distributor_id)
        .single()
      
      const masterDistTimeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), 10000)
      )
      
      let masterDistResult
      try {
        masterDistResult = await Promise.race([masterDistQueryPromise, masterDistTimeoutPromise]) as any
      } catch (queryError: any) {
        await supabase.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Database query timed out. Please try again.' },
          { status: 504 }
        )
      }
      
      const { data: masterDist, error: masterError } = masterDistResult

      if (masterError || !masterDist) {
        await supabase.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Master Distributor not found' },
          { status: 400 }
        )
      }

      if (masterDist.status !== 'active') {
        await supabase.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Master Distributor must be active' },
          { status: 400 }
        )
      }
    }

    if (tableName === 'retailers') {
      if (!userData.distributor_id) {
        await supabase.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Distributor is required to create a Retailer' },
          { status: 400 }
        )
      }

      // Verify distributor exists and is active (with timeout)
      const distributorQueryPromise = supabase
        .from('distributors')
        .select('id, partner_id, status, master_distributor_id')
        .eq('partner_id', userData.distributor_id)
        .single()
      
      const distributorTimeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), 10000)
      )
      
      let distributorResult
      try {
        distributorResult = await Promise.race([distributorQueryPromise, distributorTimeoutPromise]) as any
      } catch (queryError: any) {
        await supabase.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Database query timed out. Please try again.' },
          { status: 504 }
        )
      }
      
      const { data: distributor, error: distError } = distributorResult

      if (distError || !distributor) {
        await supabase.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Distributor not found' },
          { status: 400 }
        )
      }

      if (distributor.status !== 'active') {
        await supabase.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Distributor must be active' },
          { status: 400 }
        )
      }

      // Set master_distributor_id from distributor if not provided
      if (!userData.master_distributor_id && distributor.master_distributor_id) {
        userData.master_distributor_id = distributor.master_distributor_id
      }

      // Verify master distributor exists if provided (with timeout)
      if (userData.master_distributor_id) {
        const masterDistQueryPromise2 = supabase
          .from('master_distributors')
          .select('id, partner_id, status')
          .eq('partner_id', userData.master_distributor_id)
          .single()
        
        const masterDistTimeoutPromise2 = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Query timeout')), 10000)
        )
        
        let masterDistResult2
        try {
          masterDistResult2 = await Promise.race([masterDistQueryPromise2, masterDistTimeoutPromise2]) as any
        } catch (queryError: any) {
          await supabase.auth.admin.deleteUser(authData.user.id)
          return NextResponse.json(
            { error: 'Database query timed out. Please try again.' },
            { status: 504 }
          )
        }
        
        const { data: masterDist, error: masterError } = masterDistResult2

        if (masterError || !masterDist) {
          await supabase.auth.admin.deleteUser(authData.user.id)
          return NextResponse.json(
            { error: 'Master Distributor not found' },
            { status: 400 }
          )
        }

        // Verify distributor belongs to the master distributor
        if (distributor.master_distributor_id !== userData.master_distributor_id) {
          await supabase.auth.admin.deleteUser(authData.user.id)
          return NextResponse.json(
            { error: 'Distributor does not belong to the selected Master Distributor' },
            { status: 400 }
          )
        }
      }
    }

    // Validate mandatory bank account fields for all partner types
    // Only validate if fields are provided (to handle cases where migration hasn't been run)
    if (tableName === 'retailers' || tableName === 'distributors' || tableName === 'master_distributors') {
      // Check if any bank field is provided - if so, all must be provided
      const hasAnyBankField = userData.bank_name || userData.account_number || userData.ifsc_code || userData.bank_document_url
      if (hasAnyBankField) {
        if (!userData.bank_name || !userData.account_number || !userData.ifsc_code || !userData.bank_document_url) {
          // Rollback: delete auth user
          await supabase.auth.admin.deleteUser(authData.user.id)
          return NextResponse.json(
            { error: 'Bank Name, Account Number, IFSC Code, and Bank Document (passbook/cheque) are all mandatory when providing bank account details' },
            { status: 400 }
          )
        }
      }
    }

    // Insert or update into appropriate table (with timeout)
    let insertPromise
    if (tableName === 'partners' && userData.id) {
      // Partner record already exists, just update it (don't insert)
      insertPromise = supabase
        .from(tableName)
        .update(userData)
        .eq('id', userData.id)
        .select()
        .single()
    } else {
      // Insert new record
      insertPromise = supabase
        .from(tableName)
        .insert([userData])
        .select()
        .single()
    }
    
    const insertTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Insert timeout')), 15000)
    )
    
    let insertResult
    try {
      insertResult = await Promise.race([insertPromise, insertTimeoutPromise]) as any
    } catch (insertError: any) {
      // Rollback: delete auth user if insert fails
      await supabase.auth.admin.deleteUser(authData.user.id)
      console.error('[Create User API] Insert timeout or error:', insertError)
      return NextResponse.json(
        { error: 'Failed to save user data. Please try again.' },
        { status: 504 }
      )
    }
    
    const { data: tableData, error: tableError } = insertResult

    if (tableError) {
      // Rollback: delete auth user if table insert fails
      await supabase.auth.admin.deleteUser(authData.user.id)
      
      // Check if error is due to missing columns (migration not run)
      const errorMessage = tableError.message || ''
      const errorCode = (tableError as any).code || ''
      
      if (errorMessage.includes('column') && (errorMessage.includes('bank_name') || errorMessage.includes('account_number') || errorMessage.includes('ifsc_code') || errorMessage.includes('bank_document_url')) || 
          errorCode === '42703' || errorMessage.includes('does not exist')) {
        console.error('[Create User API] Database column error - migration may not be run:', tableError)
        return NextResponse.json(
          { 
            error: 'Database migration required. The bank account columns do not exist in the database.',
            details: 'Please run the migration file: supabase-migration-add-bank-account-fields.sql in your Supabase SQL Editor before creating partners with bank account details.'
          },
          { status: 500 }
        )
      }
      
      console.error('[Create User API] Database insert error:', tableError)
      console.error('[Create User API] Error code:', errorCode)
      console.error('[Create User API] Error details:', JSON.stringify(tableError, null, 2))
      
      return NextResponse.json(
        { 
          error: tableError.message || 'Failed to save user data',
          details: errorMessage,
          code: errorCode
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      user: tableData,
    })
  } catch (error: any) {
    console.error('[Create User API] Unexpected error:', error)
    console.error('[Create User API] Error stack:', error?.stack)
    
    // Check if this is a database column error
    const errorMessage = error?.message || ''
    const errorString = JSON.stringify(error) || ''
    
    // Environment variable errors
    if (errorMessage.includes('NEXT_PUBLIC_SUPABASE_URL') || errorMessage.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      return NextResponse.json(
        { 
          error: 'Configuration error',
          message: 'Supabase environment variables are not configured correctly. Please check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
          details: errorMessage
        },
        { status: 500 }
      )
    }
    
    // Database column errors
    if (errorMessage.includes('column') && (errorMessage.includes('bank_name') || errorMessage.includes('account_number') || errorMessage.includes('ifsc_code') || errorMessage.includes('bank_document_url')) ||
        errorString.includes('column') && (errorString.includes('bank_name') || errorString.includes('account_number') || errorString.includes('ifsc_code') || errorString.includes('bank_document_url'))) {
      return NextResponse.json(
        { 
          error: 'Database migration required',
          message: 'The bank account columns do not exist in the database.',
          details: 'Please run the migration file: supabase-migration-add-bank-account-fields.sql in your Supabase SQL Editor before creating partners with bank account details.'
        },
        { status: 500 }
      )
    }
    
    // Database connection errors
    if (errorMessage.includes('connection') || errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED')) {
      return NextResponse.json(
        { 
          error: 'Database connection error',
          message: 'Failed to connect to the database. Please check your Supabase configuration and try again.',
          details: errorMessage
        },
        { status: 500 }
      )
    }
    
    // Generic error with more details
    return NextResponse.json(
      { 
        error: error.message || 'Failed to create user. Please check the console for details.',
        message: errorMessage || 'An unexpected error occurred',
        details: errorMessage
      },
      { status: 500 }
    )
  }
}

