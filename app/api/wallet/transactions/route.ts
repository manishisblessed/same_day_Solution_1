import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

// Mark this route as dynamic (uses cookies for authentication)
export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function GET(request: NextRequest) {
  try {
    // Get current user (server-side)
    const user = await getCurrentUserServer()
    if (!user || !user.partner_id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Only retailers have wallets
    if (user.role !== 'retailer') {
      return NextResponse.json(
        { error: 'Forbidden: Only retailers have wallets' },
        { status: 403 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)
    const { searchParams } = new URL(request.url)

    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const transactionType = searchParams.get('type') || undefined

    // Build query
    let query = supabase
      .from('wallet_ledger')
      .select('*', { count: 'exact' })
      .eq('retailer_id', user.partner_id)
      .order('created_at', { ascending: false })

    if (transactionType) {
      query = query.eq('transaction_type', transactionType)
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      console.error('Error fetching wallet transactions:', error)
      return NextResponse.json(
        { error: 'Failed to fetch wallet transactions' },
        { status: 500 }
      )
    }

    // Get current balance
    const { data: balance } = await supabase.rpc('get_wallet_balance', {
      p_retailer_id: user.partner_id
    })

    return NextResponse.json({
      success: true,
      transactions: data || [],
      total: count || 0,
      balance: balance || 0,
      limit,
      offset,
    })
  } catch (error: any) {
    console.error('Error in wallet transactions API:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

