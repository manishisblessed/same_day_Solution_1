import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { createClient } from '@supabase/supabase-js'
import { TransactionFilters, TransactionListResponse } from '@/types/database.types'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

// Mark this route as dynamic (uses cookies for authentication)
export const dynamic = 'force-dynamic'

/**
 * Resolve the set of POS TIDs a non-admin user is allowed to see, based on the
 * device mappings / machines they own. Returns null for admin (no restriction).
 */
async function resolveOwnedTids(adminClient: any, user: any): Promise<string[] | null> {
  if (user.role === 'admin' || user.role === 'finance_executive') return null

  const tids = new Set<string>()

  // pos_device_mapping (distributor / master_distributor / retailer columns)
  const mapCol =
    user.role === 'master_distributor' ? 'master_distributor_id'
    : user.role === 'distributor' ? 'distributor_id'
    : user.role === 'retailer' ? 'retailer_id'
    : null

  if (mapCol) {
    const { data: maps } = await adminClient
      .from('pos_device_mapping')
      .select('tid')
      .eq('status', 'ACTIVE')
      .eq(mapCol, user.partner_id)
    ;(maps || []).forEach((m: any) => { if (m.tid) tids.add(m.tid) })

    const machineCol = mapCol === 'retailer_id' ? 'retailer_id' : mapCol
    const { data: machines } = await adminClient
      .from('pos_machines')
      .select('tid')
      .eq(machineCol, user.partner_id)
    ;(machines || []).forEach((m: any) => { if (m.tid) tids.add(m.tid) })
  }

  return Array.from(tids)
}

export async function GET(request: NextRequest) {
  try {
    // Get env vars at runtime, not module load
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
    }
    
    // Get current user (server-side) with fallback
    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[Transactions API] Auth method:', method, '| User:', user?.email || 'none')
    
    if (!user) {
      return NextResponse.json(
        { error: 'Session expired. Please log out and log back in.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
    }

    const allowedRoles = ['admin', 'finance_executive', 'distributor', 'master_distributor', 'retailer', 'partner']
    if (!allowedRoles.includes(user.role as string)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Use the service-role client so we can enforce ownership scoping ourselves
    // (the table has no RLS owner columns). Non-admins are restricted to their TIDs.
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const ownedTids = await resolveOwnedTids(supabase, user)
    if (ownedTids !== null && ownedTids.length === 0) {
      // Non-admin with no owned devices → no rows (prevents data leak)
      return NextResponse.json({ transactions: [], total: 0, page: 1, limit: 25, totalPages: 0 })
    }

    const { searchParams } = new URL(request.url)

    // Parse filters
    const filters: TransactionFilters = {
      dateFrom: searchParams.get('dateFrom') || undefined,
      dateTo: searchParams.get('dateTo') || undefined,
      tid: searchParams.get('tid') || undefined,
      rrn: searchParams.get('rrn') || undefined,
      status: (searchParams.get('status') as any) || 'all',
      retailer_id: searchParams.get('retailer_id') || undefined,
      distributor_id: searchParams.get('distributor_id') || undefined,
      master_distributor_id: searchParams.get('master_distributor_id') || undefined,
      minAmount: searchParams.get('minAmount') ? parseFloat(searchParams.get('minAmount')!) : undefined,
      maxAmount: searchParams.get('maxAmount') ? parseFloat(searchParams.get('maxAmount')!) : undefined,
      page: parseInt(searchParams.get('page') || '1'),
      limit: (() => {
        const n = parseInt(searchParams.get('limit') || '25', 10)
        return [10, 25, 100].includes(n) ? n : 25
      })(),
      sortBy: (searchParams.get('sortBy') as any) || 'created_at',
      sortOrder: (searchParams.get('sortOrder') as any) || 'desc'
    }

    // Build query based on role
    // Note: The new razorpay_transactions table doesn't have retailer_id, distributor_id, or master_distributor_id columns
    // For role-based filtering, use /api/razorpay/transactions instead which uses razorpay_pos_transactions with device mapping
    let query = supabase
      .from('razorpay_transactions')
      .select('*', { count: 'exact' })

    // Ownership scoping: non-admins only see transactions on TIDs they own.
    if (ownedTids !== null) {
      query = query.in('tid', ownedTids)
    }

    // Apply filters
    if (filters.dateFrom) {
      query = query.gte('created_at', filters.dateFrom)
    }
    if (filters.dateTo) {
      query = query.lte('created_at', filters.dateTo)
    }
    if (filters.tid) {
      query = query.eq('tid', filters.tid)
    }
    if (filters.rrn) {
      query = query.ilike('rrn', `%${filters.rrn}%`)
    }
    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status)
    }
    // Note: These filters are removed because the new razorpay_transactions table doesn't have these columns
    // if (filters.retailer_id) {
    //   query = query.eq('retailer_id', filters.retailer_id)
    // }
    // if (filters.distributor_id) {
    //   query = query.eq('distributor_id', filters.distributor_id)
    // }
    // if (filters.master_distributor_id) {
    //   query = query.eq('master_distributor_id', filters.master_distributor_id)
    // }
    if (filters.minAmount !== undefined) {
      query = query.gte('gross_amount', filters.minAmount)
    }
    if (filters.maxAmount !== undefined) {
      query = query.lte('gross_amount', filters.maxAmount)
    }

    // Apply sorting
    query = query.order(filters.sortBy || 'created_at', { 
      ascending: filters.sortOrder === 'asc' 
    })

    // Apply pagination
    const lim = filters.limit || 25
    const offset = ((filters.page || 1) - 1) * lim
    query = query.range(offset, offset + lim - 1)

    const { data, error, count } = await query

    if (error) {
      console.error('Error fetching transactions:', error)
      return NextResponse.json(
        { error: 'Failed to fetch transactions' },
        { status: 500 }
      )
    }

    const totalPages = Math.ceil((count || 0) / lim)

    const response: TransactionListResponse = {
      transactions: data || [],
      total: count || 0,
      page: filters.page || 1,
      limit: lim,
      totalPages
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, { activity_type: 'view_transactions', activity_category: 'report' }).catch(() => {})

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('Error in transactions API:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

