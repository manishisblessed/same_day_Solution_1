import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const dynamic = 'force-dynamic'

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
    // Check admin authentication with timeout
    const authPromise = getCurrentUserServer()
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Authentication timeout')), 10000)
    )
    
    let admin
    try {
      admin = await Promise.race([authPromise, timeoutPromise]) as any
    } catch (authError: any) {
      console.error('Authentication error or timeout:', authError)
      return NextResponse.json(
        { error: 'Authentication failed or timed out. Please try again.' },
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
      console.error('Query timeout or error:', queryError)
      return NextResponse.json(
        { error: 'Database query timed out. The table may be too large. Please try with a smaller page size or contact support.' },
        { status: 504 }
      )
    }

    const { data: transactions, error, count } = queryResult

    if (error) {
      console.error('Error fetching Razorpay POS transactions:', error)
      return NextResponse.json(
        { error: `Failed to fetch transactions: ${error.message || 'Database error'}` },
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
    console.error('Error in admin Razorpay transactions API:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

