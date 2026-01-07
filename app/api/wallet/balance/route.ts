import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

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

    // Get wallet balance
    const { data: balance, error } = await supabase.rpc('get_wallet_balance', {
      p_retailer_id: user.partner_id
    })

    if (error) {
      console.error('Error fetching wallet balance:', error)
      return NextResponse.json(
        { error: 'Failed to fetch wallet balance' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      balance: balance || 0,
      retailer_id: user.partner_id,
    })
  } catch (error: any) {
    console.error('Error in wallet balance API:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

