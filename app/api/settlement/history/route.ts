import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !user.partner_id) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    if (!['retailer', 'distributor', 'master_distributor'].includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden: Invalid user role' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200)

    const { data: settlements, error } = await supabase
      .from('settlements')
      .select('id, settlement_mode, amount, charge, net_amount, bank_account_number, bank_ifsc, bank_account_name, status, failure_reason, payout_reference_id, created_at, updated_at')
      .eq('user_id', user.partner_id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[Settlement History] Query error:', error)
      return NextResponse.json({ error: 'Failed to fetch settlement history' }, { status: 500 })
    }

    return NextResponse.json({ success: true, settlements: settlements || [] })
  } catch (error: any) {
    console.error('[Settlement History] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch settlement history' }, { status: 500 })
  }
}
