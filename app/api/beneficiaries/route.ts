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
 * GET /api/beneficiaries
 * 
 * Get saved beneficiaries for the current retailer
 */
export async function GET(request: NextRequest) {
  try {
    // Get user_id from query params for fallback auth
    const { searchParams } = new URL(request.url)
    const user_id = searchParams.get('user_id')
    
    // Get user from request
    let user = await getCurrentUserFromRequest(request)
    
    // Fallback auth using user_id query param
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

    // Get saved beneficiaries
    const { data: beneficiaries, error } = await supabaseAdmin
      .from('saved_beneficiaries')
      .select('*')
      .eq('retailer_id', user.partner_id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[Beneficiaries] Error fetching:', error)
      // Return empty array if table doesn't exist yet
      const response = NextResponse.json({
        success: true,
        beneficiaries: [],
      })
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      beneficiaries: beneficiaries || [],
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[Beneficiaries] Unexpected error:', error)
    const response = NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

/**
 * POST /api/beneficiaries
 * 
 * Save a new beneficiary
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      account_number, 
      ifsc_code, 
      account_holder_name, 
      bank_id, 
      bank_name, 
      beneficiary_mobile,
      nickname,
      is_default,
      user_id 
    } = body

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

    // Validate required fields
    if (!account_number || !ifsc_code || !bank_name) {
      const response = NextResponse.json(
        { success: false, error: 'Account number, IFSC code, and bank name are required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // If setting as default, unset other defaults first
    if (is_default) {
      await supabaseAdmin
        .from('saved_beneficiaries')
        .update({ is_default: false })
        .eq('retailer_id', user.partner_id)
    }

    // Insert or update beneficiary
    const { data: beneficiary, error } = await supabaseAdmin
      .from('saved_beneficiaries')
      .upsert({
        retailer_id: user.partner_id,
        account_number,
        ifsc_code: ifsc_code.toUpperCase(),
        account_holder_name: account_holder_name || 'Account Holder',
        bank_id: bank_id || null,
        bank_name,
        beneficiary_mobile: beneficiary_mobile || null,
        nickname: nickname || null,
        is_default: is_default || false,
        is_verified: true,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'retailer_id,account_number,ifsc_code',
      })
      .select()
      .single()

    if (error) {
      console.error('[Beneficiaries] Error saving:', error)
      const response = NextResponse.json(
        { success: false, error: error.message || 'Failed to save beneficiary' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    console.log('[Beneficiaries] Saved beneficiary for:', user.partner_id)
    
    const response = NextResponse.json({
      success: true,
      message: 'Beneficiary saved successfully',
      beneficiary,
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[Beneficiaries] Unexpected error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

/**
 * DELETE /api/beneficiaries
 * 
 * Delete a saved beneficiary
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const user_id = searchParams.get('user_id')

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

    if (!id) {
      const response = NextResponse.json(
        { success: false, error: 'Beneficiary ID is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Delete beneficiary (only if it belongs to this retailer)
    const { error } = await supabaseAdmin
      .from('saved_beneficiaries')
      .delete()
      .eq('id', id)
      .eq('retailer_id', user.partner_id)

    if (error) {
      console.error('[Beneficiaries] Error deleting:', error)
      const response = NextResponse.json(
        { success: false, error: 'Failed to delete beneficiary' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      message: 'Beneficiary deleted successfully',
    })
    
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[Beneficiaries] Unexpected error:', error)
    const response = NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

