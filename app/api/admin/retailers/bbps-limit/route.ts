import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/retailers/bbps-limit
 * Update BBPS limit tier for a retailer
 * 
 * Body: {
 *   retailer_id: string (partner_id)
 *   bbps_limit_tier: 49999 | 99999 | 189999
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
    const { retailer_id, bbps_limit_tier } = body

    if (!retailer_id) {
      return NextResponse.json(
        { error: 'retailer_id is required' },
        { status: 400 }
      )
    }

    if (![49999, 99999, 189999].includes(bbps_limit_tier)) {
      return NextResponse.json(
        { error: 'bbps_limit_tier must be 49999, 99999, or 189999' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()

    // Verify retailer exists
    const { data: retailer, error: retailerError } = await supabase
      .from('retailers')
      .select('partner_id, name, bbps_limit_tier')
      .eq('partner_id', retailer_id)
      .single()

    if (retailerError || !retailer) {
      return NextResponse.json(
        { error: 'Retailer not found' },
        { status: 404 }
      )
    }

    // Update BBPS limit tier
    const { data: updatedRetailer, error: updateError } = await supabase
      .from('retailers')
      .update({ bbps_limit_tier })
      .eq('partner_id', retailer_id)
      .select('partner_id, name, bbps_limit_tier')
      .single()

    if (updateError) {
      console.error('Error updating BBPS limit tier:', updateError)
      return NextResponse.json(
        { error: 'Failed to update BBPS limit tier', detail: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `BBPS limit tier updated to ₹${bbps_limit_tier.toLocaleString('en-IN')} for ${retailer.name}`,
      retailer: updatedRetailer
    })

  } catch (error: any) {
    console.error('Error in POST /api/admin/retailers/bbps-limit:', error)
    return NextResponse.json(
      { error: 'Internal server error', detail: error.message },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/retailers/bbps-limit?retailer_id=RET123
 * Get BBPS limit tier for a retailer
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
      .select('partner_id, name, bbps_limit_tier')
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
        bbps_limit_tier: retailer.bbps_limit_tier || 49999
      }
    })

  } catch (error: any) {
    console.error('Error in GET /api/admin/retailers/bbps-limit:', error)
    return NextResponse.json(
      { error: 'Internal server error', detail: error.message },
      { status: 500 }
    )
  }
}

