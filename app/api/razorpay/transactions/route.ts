import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

/**
 * GET /api/razorpay/transactions
 * Role-based API to fetch Razorpay POS transactions
 * 
 * Phase 2: Role-based visibility using POS device mapping
 * 
 * Behavior:
 * - Admin → sees all transactions
 * - Master Distributor → sees transactions where master_distributor_id matches
 * - Distributor → sees transactions where distributor_id matches
 * - Retailer → sees transactions where retailer_id matches
 * - If no mapping exists → show ONLY to Admin, hide from others
 */
export async function GET(request: NextRequest) {
  try {
    // Initialize Supabase client at runtime (not during build)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    // Get current user with fallback
    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[Razorpay Transactions] Auth:', method, '|', user?.email || 'none')
    
    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = (page - 1) * limit

    // For admin, return all transactions (use admin endpoint logic)
    if (user.role === 'admin') {
      let query = supabase
        .from('razorpay_pos_transactions')
        .select('*', { count: 'exact' })
        .order('transaction_time', { ascending: false, nullsFirst: false })
        .range(offset, offset + limit - 1)

      const { data: transactions, error, count } = await query

      if (error) {
        console.error('Error fetching Razorpay POS transactions:', error)
        return NextResponse.json(
          { error: 'Failed to fetch transactions' },
          { status: 500 }
        )
      }

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
    }

    // For non-admin users, get device serials they have access to
    let deviceSerials: string[] = []

    // Get mappings based on role
    let mappingQuery = supabase
      .from('pos_device_mapping')
      .select('device_serial')
      .eq('status', 'ACTIVE')

    if (user.role === 'master_distributor') {
      mappingQuery = mappingQuery.eq('master_distributor_id', user.partner_id)
    } else if (user.role === 'distributor') {
      mappingQuery = mappingQuery.eq('distributor_id', user.partner_id)
    } else if (user.role === 'retailer') {
      mappingQuery = mappingQuery.eq('retailer_id', user.partner_id)
    } else {
      return NextResponse.json(
        { error: 'Invalid user role' },
        { status: 403 }
      )
    }

    const { data: mappings, error: mappingError } = await mappingQuery

    if (mappingError) {
      console.error('Error fetching POS device mappings:', mappingError)
      return NextResponse.json(
        { error: 'Failed to fetch device mappings' },
        { status: 500 }
      )
    }

    // Extract device serials
    deviceSerials = (mappings || []).map((m: any) => m.device_serial).filter(Boolean)

    // If no mappings found, return empty result (non-admin users can't see unmapped transactions)
    if (deviceSerials.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false
        }
      })
    }

    // Fetch transactions for these device serials
    let query = supabase
      .from('razorpay_pos_transactions')
      .select('*', { count: 'exact' })
      .in('device_serial', deviceSerials)
      .order('transaction_time', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    const { data: transactions, error, count } = await query

    if (error) {
      console.error('Error fetching Razorpay POS transactions:', error)
      return NextResponse.json(
        { error: 'Failed to fetch transactions' },
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
    console.error('Error in role-based Razorpay transactions API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

