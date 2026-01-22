import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
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
 * Returns paginated list of transactions sorted by created_time DESC
 * 
 * Response fields ONLY:
 * - txn_id
 * - amount
 * - payment_mode
 * - status (CAPTURED, FAILED, PENDING)
 * - settlement_status
 * - created_time
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

    // Check admin authentication with fallback
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Razorpay Transactions Old] Auth:', method, '|', admin?.email || 'none')
    
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100) // Cap at 100
    const offset = (page - 1) * limit
    const statusFilter = searchParams.get('status') // Optional filter by status

    // Validate pagination
    if (page < 1 || limit < 1) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters' },
        { status: 400 }
      )
    }

    // Build query - Select only specified fields
    let query = supabase
      .from('razorpay_transactions')
      .select('txn_id, amount, payment_mode, status, settlement_status, created_time', { count: 'exact' })
      .order('created_time', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    // Apply status filter if provided
    if (statusFilter && ['CAPTURED', 'FAILED', 'PENDING'].includes(statusFilter.toUpperCase())) {
      query = query.eq('status', statusFilter.toUpperCase())
    }

    const { data: transactions, error, count } = await query

    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return NextResponse.json(
          { error: 'Table does not exist. Run migration: supabase-razorpay-transactions-migration.sql' },
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

