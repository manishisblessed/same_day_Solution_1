import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Create Supabase admin client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/tpin
 * 
 * Get TPIN status for the current user
 */
export async function GET(request: NextRequest) {
  try {
    // Get user from request
    const user = await getCurrentUserFromRequest(request)
    
    if (!user || !user.partner_id) {
      const response = NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    // Get TPIN status from database
    const { data: retailer, error } = await supabaseAdmin
      .from('retailers')
      .select('tpin_enabled, tpin_locked_until, tpin_failed_attempts')
      .eq('partner_id', user.partner_id)
      .maybeSingle()

    if (error) {
      console.error('[TPIN] Error fetching status:', error)
      const response = NextResponse.json(
        { success: false, error: 'Failed to fetch TPIN status' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    if (!retailer) {
      const response = NextResponse.json(
        { success: false, error: 'Retailer not found' },
        { status: 404 }
      )
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      tpin_enabled: retailer.tpin_enabled || false,
      is_locked: retailer.tpin_locked_until ? new Date(retailer.tpin_locked_until) > new Date() : false,
      locked_until: retailer.tpin_locked_until,
      failed_attempts: retailer.tpin_failed_attempts || 0,
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[TPIN] Unexpected error:', error)
    const response = NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

/**
 * POST /api/tpin
 * 
 * Set or change TPIN for the current user
 * 
 * Request Body:
 * - tpin: New 4-digit TPIN
 * - current_tpin: Current TPIN (required if already set)
 * - user_id: Fallback auth - retailer partner_id (if cookie auth fails)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { tpin, current_tpin, user_id } = body

    // Get user from request
    let user = await getCurrentUserFromRequest(request)
    
    // Fallback auth using user_id
    if ((!user || !user.partner_id) && user_id) {
      const { data: retailer } = await supabaseAdmin
        .from('retailers')
        .select('partner_id, name, email')
        .eq('partner_id', user_id)
        .maybeSingle()
      
      if (retailer) {
        user = {
          id: user_id,
          email: retailer.email,
          role: 'retailer',
          partner_id: retailer.partner_id,
          name: retailer.name,
        }
      }
    }
    
    if (!user || !user.partner_id) {
      const response = NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    // Validate new TPIN
    if (!tpin || tpin.length !== 4 || !/^\d{4}$/.test(tpin)) {
      const response = NextResponse.json(
        { success: false, error: 'TPIN must be exactly 4 digits' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Check if TPIN is already set
    const { data: retailer, error: fetchError } = await supabaseAdmin
      .from('retailers')
      .select('tpin_enabled, tpin_hash, tpin_locked_until')
      .eq('partner_id', user.partner_id)
      .maybeSingle()

    if (fetchError || !retailer) {
      const response = NextResponse.json(
        { success: false, error: 'Retailer not found' },
        { status: 404 }
      )
      return addCorsHeaders(request, response)
    }

    // Check if account is locked
    if (retailer.tpin_locked_until && new Date(retailer.tpin_locked_until) > new Date()) {
      const response = NextResponse.json(
        { 
          success: false, 
          error: 'Account is locked due to too many failed attempts',
          locked_until: retailer.tpin_locked_until
        },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    // If TPIN is already set, verify current TPIN
    if (retailer.tpin_enabled && retailer.tpin_hash) {
      if (!current_tpin) {
        const response = NextResponse.json(
          { success: false, error: 'Current TPIN is required to change TPIN' },
          { status: 400 }
        )
        return addCorsHeaders(request, response)
      }

      // Verify current TPIN using the database function
      const { data: verifyResult, error: verifyError } = await supabaseAdmin.rpc('verify_retailer_tpin', {
        p_retailer_id: user.partner_id,
        p_tpin: current_tpin
      })

      if (verifyError) {
        console.error('[TPIN] Verification error:', verifyError)
        const response = NextResponse.json(
          { success: false, error: 'Failed to verify current TPIN' },
          { status: 500 }
        )
        return addCorsHeaders(request, response)
      }

      if (!verifyResult?.success) {
        const response = NextResponse.json(
          { 
            success: false, 
            error: verifyResult?.error || 'Current TPIN is incorrect',
            attempts_remaining: verifyResult?.attempts_remaining
          },
          { status: 400 }
        )
        return addCorsHeaders(request, response)
      }
    }

    // Set new TPIN using the database function
    const { data: setResult, error: setError } = await supabaseAdmin.rpc('set_retailer_tpin', {
      p_retailer_id: user.partner_id,
      p_tpin: tpin
    })

    if (setError) {
      console.error('[TPIN] Set error:', setError)
      const response = NextResponse.json(
        { success: false, error: setError.message || 'Failed to set TPIN' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    console.log('[TPIN] TPIN set successfully for:', user.partner_id)
    
    const response = NextResponse.json({
      success: true,
      message: retailer.tpin_enabled ? 'TPIN changed successfully' : 'TPIN set successfully',
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[TPIN] Unexpected error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

