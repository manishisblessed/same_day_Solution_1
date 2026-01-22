import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { TransactionFilters, TransactionListResponse } from '@/types/database.types'
import { getCurrentUserServer } from '@/lib/auth-server'

// Mark this route as dynamic (uses cookies for authentication)
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Get env vars at runtime, not module load
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
    }
    
    // Get current user (server-side)
    const user = await getCurrentUserServer()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)
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
      limit: parseInt(searchParams.get('limit') || '50'),
      sortBy: (searchParams.get('sortBy') as any) || 'created_at',
      sortOrder: (searchParams.get('sortOrder') as any) || 'desc'
    }

    // Build query based on role
    // Note: The new razorpay_transactions table doesn't have retailer_id, distributor_id, or master_distributor_id columns
    // For role-based filtering, use /api/razorpay/transactions instead which uses razorpay_pos_transactions with device mapping
    let query = supabase
      .from('razorpay_transactions')
      .select('*', { count: 'exact' })

    // Role-based filtering removed - new razorpay_transactions table schema doesn't support it
    // Admin can see all transactions (no filter)
    // For role-based access, use /api/razorpay/transactions endpoint

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
    const offset = ((filters.page || 1) - 1) * (filters.limit || 50)
    query = query.range(offset, offset + (filters.limit || 50) - 1)

    const { data, error, count } = await query

    if (error) {
      console.error('Error fetching transactions:', error)
      return NextResponse.json(
        { error: 'Failed to fetch transactions' },
        { status: 500 }
      )
    }

    const totalPages = Math.ceil((count || 0) / (filters.limit || 50))

    const response: TransactionListResponse = {
      transactions: data || [],
      total: count || 0,
      page: filters.page || 1,
      limit: filters.limit || 50,
      totalPages
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('Error in transactions API:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

