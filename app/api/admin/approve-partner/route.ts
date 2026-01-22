import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

// Lazy initialization to avoid build-time errors
let supabase: SupabaseClient | null = null

function getSupabaseAdmin(): SupabaseClient {
  if (!supabase) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not configured')
    }
    
    supabase = createClient(supabaseUrl, supabaseServiceKey)
  }
  return supabase
}

/**
 * Approve or reject partner verification
 * 
 * Authorization:
 * - Admin access required
 */
export async function POST(request: NextRequest) {
  try {
    // Check admin authentication with fallback
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Approve Partner] Auth method:', method, '| User:', admin?.email || 'none')
    
    if (!admin) {
      return NextResponse.json(
        { error: 'Session expired. Please log out and log back in.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
    }
    
    if (admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      )
    }

    // Get Supabase admin client
    const supabase = getSupabaseAdmin()

    const body = await request.json()
    const { partner_id, partner_type, action, remarks } = body // action: 'approve' or 'reject'

    if (!partner_id || !partner_type || !action) {
      return NextResponse.json(
        { error: 'partner_id, partner_type, and action are required' },
        { status: 400 }
      )
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "approve" or "reject"' },
        { status: 400 }
      )
    }

    if (!['retailers', 'distributors', 'master_distributors'].includes(partner_type)) {
      return NextResponse.json(
        { error: 'Invalid partner_type' },
        { status: 400 }
      )
    }

    // Get partner data
    const { data: partner, error: partnerError } = await supabase
      .from(partner_type)
      .select('*')
      .eq('partner_id', partner_id)
      .single()

    if (partnerError || !partner) {
      return NextResponse.json(
        { error: 'Partner not found' },
        { status: 404 }
      )
    }

    // Check if partner is in pending_verification status
    if (partner.status !== 'pending_verification') {
      return NextResponse.json(
        { error: `Partner is not in pending verification status. Current status: ${partner.status}` },
        { status: 400 }
      )
    }

    // Update partner status
    const updateData: any = {
      verification_status: action === 'approve' ? 'approved' : 'rejected',
      verified_at: new Date().toISOString(),
      verified_by: admin.id,
      updated_at: new Date().toISOString()
    }

    if (action === 'approve') {
      updateData.status = 'active'
    } else {
      updateData.status = 'inactive'
    }

    const { data: updatedPartner, error: updateError } = await supabase
      .from(partner_type)
      .update(updateData)
      .eq('partner_id', partner_id)
      .select()
      .single()

    if (updateError) {
      console.error('[Approve Partner API] Update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update partner status' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Partner ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
      partner: updatedPartner
    })
  } catch (error: any) {
    console.error('[Approve Partner API] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to process approval' },
      { status: 500 }
    )
  }
}

