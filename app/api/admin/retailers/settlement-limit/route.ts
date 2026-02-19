import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/retailers/settlement-limit
 * Update settlement limit tier for a retailer
 * 
 * Body: {
 *   retailer_id: string (partner_id)
 *   settlement_limit_tier: 100000 | 150000 | 200000
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { user, method } = await getCurrentUserWithFallback(request)
    
    if (!user) {
      return NextResponse.json(
        { error: 'Session expired. Please log out and log back in.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
    }
    
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized. Admin access required.' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { retailer_id, settlement_limit_tier } = body

    if (!retailer_id) {
      return NextResponse.json(
        { error: 'retailer_id is required' },
        { status: 400 }
      )
    }

    if (![100000, 150000, 200000].includes(settlement_limit_tier)) {
      return NextResponse.json(
        { error: 'settlement_limit_tier must be 100000, 150000, or 200000' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()

    // Verify retailer exists
    const { data: retailer, error: retailerError } = await supabase
      .from('retailers')
      .select('partner_id, name, settlement_limit_tier')
      .eq('partner_id', retailer_id)
      .single()

    if (retailerError || !retailer) {
      return NextResponse.json(
        { error: 'Retailer not found' },
        { status: 404 }
      )
    }

    // Update settlement limit tier
    const { data: updatedRetailer, error: updateError } = await supabase
      .from('retailers')
      .update({ settlement_limit_tier })
      .eq('partner_id', retailer_id)
      .select('partner_id, name, settlement_limit_tier')
      .single()

    if (updateError) {
      console.error('Error updating settlement limit tier:', updateError)
      return NextResponse.json(
        { error: 'Failed to update settlement limit tier', detail: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Settlement limit tier updated to ₹${settlement_limit_tier.toLocaleString('en-IN')} for ${retailer.name}`,
      retailer: updatedRetailer
    })

  } catch (error: any) {
    console.error('Error in POST /api/admin/retailers/settlement-limit:', error)
    return NextResponse.json(
      { error: 'Internal server error', detail: error.message },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/retailers/settlement-limit?retailer_id=RET123
 * Get settlement limit tier for a retailer
 */
export async function GET(request: NextRequest) {
  try {
    const { user, method } = await getCurrentUserWithFallback(request)
    
    if (!user) {
      return NextResponse.json(
        { error: 'Session expired. Please log out and log back in.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
    }
    
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized. Admin access required.' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const retailer_id = searchParams.get('retailer_id')

    if (!retailer_id) {
      return NextResponse.json(
        { error: 'retailer_id query parameter is required' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()

    const { data: retailer, error } = await supabase
      .from('retailers')
      .select('partner_id, name, settlement_limit_tier')
      .eq('partner_id', retailer_id)
      .single()

    if (error || !retailer) {
      return NextResponse.json(
        { error: 'Retailer not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      retailer: {
        partner_id: retailer.partner_id,
        name: retailer.name,
        settlement_limit_tier: retailer.settlement_limit_tier || 100000
      }
    })

  } catch (error: any) {
    console.error('Error in GET /api/admin/retailers/settlement-limit:', error)
    return NextResponse.json(
      { error: 'Internal server error', detail: error.message },
      { status: 500 }
    )
  }
}

