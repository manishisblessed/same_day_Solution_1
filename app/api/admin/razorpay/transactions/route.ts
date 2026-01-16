import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Helper function to get Supabase client with validation
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables. Please configure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(supabaseUrl, supabaseServiceKey)
}

/**
 * Admin-only API to fetch Razorpay POS transactions
 * 
 * Phase 1: Admin-only access, no role-based filtering
 * Phase 2: Admin sees ALL transactions (backward compatible)
 * Returns paginated list of transactions sorted by transaction_time DESC
 * 
 * Note: Admin always sees all transactions regardless of mapping.
 * Role-based filtering is handled in /api/razorpay/transactions endpoint.
 */
export async function GET(request: NextRequest) {
  try {
    // Log request for debugging
    console.log('[Razorpay Transactions API] Request received:', {
      url: request.url,
      method: request.method,
      headers: {
        host: request.headers.get('host'),
        cookie: request.headers.get('cookie') ? 'present' : 'missing',
      }
    })

    // Validate environment variables early with detailed logging
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
    console.log('[Razorpay Transactions API] Environment check:', {
      hasSupabaseUrl: !!supabaseUrl,
      hasServiceKey: !!supabaseServiceKey,
      supabaseUrlLength: supabaseUrl?.length || 0,
      serviceKeyLength: supabaseServiceKey?.length || 0,
      nodeEnv: process.env.NODE_ENV,
    })
    
    if (!supabaseUrl || !supabaseServiceKey) {
      const missingVars = []
      if (!supabaseUrl) missingVars.push('NEXT_PUBLIC_SUPABASE_URL')
      if (!supabaseServiceKey) missingVars.push('SUPABASE_SERVICE_ROLE_KEY')
      
      console.error('[Razorpay Transactions API] Missing environment variables:', missingVars)
      return NextResponse.json(
        { 
          error: 'Server configuration error. Please contact support.',
          details: {
            message: `Missing environment variables: ${missingVars.join(', ')}`,
            hint: 'Please verify these are set in AWS Amplify environment variables and redeploy.',
            missingVariables: missingVars
          }
        },
        { status: 500 }
      )
    }
    
    // Try to create Supabase client
    let supabase
    try {
      supabase = getSupabaseClient()
    } catch (envError: any) {
      console.error('[Razorpay Transactions API] Supabase client creation error:', {
        error: envError.message,
        stack: envError.stack
      })
      return NextResponse.json(
        { 
          error: 'Server configuration error. Please contact support.',
          details: {
            message: envError.message,
            hint: 'Failed to initialize Supabase client. Check environment variable values.'
          }
        },
        { status: 500 }
      )
    }

    // Check admin authentication with timeout
    const authPromise = getCurrentUserServer()
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Authentication timeout')), 10000)
    )
    
    let admin
    try {
      admin = await Promise.race([authPromise, timeoutPromise]) as any
    } catch (authError: any) {
      console.error('[Razorpay Transactions API] Authentication error or timeout:', {
        error: authError.message,
        stack: authError.stack
      })
      return NextResponse.json(
        { 
          error: 'Authentication failed or timed out. Please try again.',
          details: process.env.NODE_ENV === 'development' ? authError.message : undefined
        },
        { status: 401 }
      )
    }

    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100) // Cap at 100
    const offset = (page - 1) * limit

    // Validate pagination
    if (page < 1 || limit < 1) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters' },
        { status: 400 }
      )
    }

    // Build query - Admin sees ALL transactions (no filtering by mapping)
    // Use a timeout for the query
    const queryPromise = supabase
      .from('razorpay_pos_transactions')
      .select('*', { count: 'exact' })
      .order('transaction_time', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    const queryTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Database query timeout')), 25000)
    )

    let queryResult
    try {
      queryResult = await Promise.race([queryPromise, queryTimeoutPromise]) as any
    } catch (queryError: any) {
      console.error('[Razorpay Transactions API] Query timeout or error:', {
        error: queryError.message,
        code: queryError.code,
        details: queryError.details,
        hint: queryError.hint
      })
      
      // Check if it's a table not found error
      if (queryError.message?.includes('relation') && queryError.message?.includes('does not exist')) {
        return NextResponse.json(
          { 
            error: 'Database table does not exist. Please run the migration: supabase-razorpay-pos-notifications-migration.sql',
            details: {
              hint: 'The razorpay_pos_transactions table needs to be created in your Supabase database',
              migrationFile: 'supabase-razorpay-pos-notifications-migration.sql',
              sqlError: queryError.message
            }
          },
          { status: 500 }
        )
      }
      
      return NextResponse.json(
        { 
          error: 'Database query timed out. The table may be too large. Please try with a smaller page size or contact support.',
          details: process.env.NODE_ENV === 'development' ? queryError.message : undefined
        },
        { status: 504 }
      )
    }

    const { data: transactions, error, count } = queryResult

    if (error) {
      console.error('[Razorpay Transactions API] Database error:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      })
      
      // Check if it's a table not found error
      if (error.code === '42P01' || (error.message?.includes('relation') && error.message?.includes('does not exist'))) {
        return NextResponse.json(
          { 
            error: 'Database table does not exist. Please run the migration: supabase-razorpay-pos-notifications-migration.sql',
            details: {
              hint: 'The razorpay_pos_transactions table needs to be created in your Supabase database',
              migrationFile: 'supabase-razorpay-pos-notifications-migration.sql',
              sqlError: error.message,
              sqlCode: error.code
            }
          },
          { status: 500 }
        )
      }
      
      return NextResponse.json(
        { 
          error: `Failed to fetch transactions: ${error.message || 'Database error'}`,
          details: process.env.NODE_ENV === 'development' ? {
            code: error.code,
            hint: error.hint,
            details: error.details
          } : undefined
        },
        { status: 500 }
      )
    }

    // Calculate pagination metadata
    const totalPages = count ? Math.ceil(count / limit) : 1
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    return NextResponse.json({
      success: true,
      data: transactions || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNextPage,
        hasPrevPage
      }
    })

  } catch (error: any) {
    console.error('[Razorpay Transactions API] Unexpected error:', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code
    })
    
    // Provide more detailed error information
    let errorMessage = 'Internal server error'
    let errorDetails: any = {}
    
    // Check for common errors
    if (error.message?.includes('relation') && error.message?.includes('does not exist')) {
      errorMessage = 'Database table does not exist. Please run the migration: supabase-razorpay-pos-notifications-migration.sql'
      errorDetails = {
        hint: 'The razorpay_pos_transactions table needs to be created in your Supabase database',
        migrationFile: 'supabase-razorpay-pos-notifications-migration.sql'
      }
    } else if (error.message?.includes('JWT') || error.message?.includes('auth')) {
      errorMessage = 'Authentication error. Please check your Supabase configuration.'
      errorDetails = {
        hint: 'Verify SUPABASE_SERVICE_ROLE_KEY is set correctly'
      }
    } else if (error.message?.includes('timeout')) {
      errorMessage = 'Database connection timeout. Please try again.'
    } else {
      errorDetails = {
        message: error.message,
        code: error.code
      }
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'production' ? errorDetails : undefined
      },
      { status: 500 }
    )
  }
}

