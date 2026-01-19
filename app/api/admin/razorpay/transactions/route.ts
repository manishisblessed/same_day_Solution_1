import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
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
  // Check environment variables FIRST - before anything else
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { 
        error: 'Server configuration error',
        message: `Missing: ${!supabaseUrl ? 'NEXT_PUBLIC_SUPABASE_URL' : ''} ${!supabaseServiceKey ? 'SUPABASE_SERVICE_ROLE_KEY' : ''}`.trim()
      },
      { status: 500 }
    )
  }

  try {
    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check admin authentication with shorter timeout
    let admin
    try {
      const authPromise = getCurrentUserServer()
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Auth timeout')), 5000)
      )
      admin = await Promise.race([authPromise, timeoutPromise]) as any
    } catch (authError: any) {
      return NextResponse.json(
        { error: 'Authentication failed', message: authError.message },
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

    // Build query - Admin sees ALL transactions
    const { data: transactions, error, count } = await supabase
      .from('razorpay_pos_transactions')
      .select('*', { count: 'exact' })
      .order('transaction_time', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return NextResponse.json(
          { error: 'Table does not exist. Run migration: supabase-razorpay-pos-notifications-migration.sql' },
          { status: 500 }
        )
      }
      return NextResponse.json(
        { error: 'Database error', message: error.message },
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
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}

