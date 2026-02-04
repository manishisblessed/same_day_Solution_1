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
    let body
    try {
      body = await request.json()
    } catch (parseError) {
      console.error('[Beneficiaries] Error parsing request body:', parseError)
      const response = NextResponse.json(
        { success: false, error: 'Invalid request body' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

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

    // Normalize IFSC code
    const normalizedIfsc = ifsc_code.toUpperCase().trim()
    const normalizedAccountNumber = account_number.trim()

    // If setting as default, unset other defaults first
    if (is_default) {
      const { error: unsetError } = await supabaseAdmin
        .from('saved_beneficiaries')
        .update({ is_default: false })
        .eq('retailer_id', user.partner_id)
      
      if (unsetError) {
        console.error('[Beneficiaries] Error unsetting defaults:', unsetError)
        // Continue anyway - not critical
      }
    }

    // Check if beneficiary already exists
    const { data: existingBeneficiary, error: checkError } = await supabaseAdmin
      .from('saved_beneficiaries')
      .select('id')
      .eq('retailer_id', user.partner_id)
      .eq('account_number', normalizedAccountNumber)
      .eq('ifsc_code', normalizedIfsc)
      .maybeSingle()

    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('[Beneficiaries] Error checking existing beneficiary:', checkError)
      const response = NextResponse.json(
        { success: false, error: 'Failed to check existing beneficiary. Please ensure the saved_beneficiaries table exists.' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    const beneficiaryData = {
      retailer_id: user.partner_id,
      account_number: normalizedAccountNumber,
      ifsc_code: normalizedIfsc,
      account_holder_name: account_holder_name || 'Account Holder',
      bank_id: bank_id || null,
      bank_name: bank_name.trim(),
      beneficiary_mobile: beneficiary_mobile ? beneficiary_mobile.trim() : null,
      nickname: nickname ? nickname.trim() : null,
      is_default: is_default || false,
      is_verified: true,
      updated_at: new Date().toISOString(),
    }

    let beneficiary
    let error

    if (existingBeneficiary) {
      // Update existing beneficiary
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('saved_beneficiaries')
        .update(beneficiaryData)
        .eq('id', existingBeneficiary.id)
        .select()
        .single()
      
      beneficiary = updated
      error = updateError
    } else {
      // Insert new beneficiary
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('saved_beneficiaries')
        .insert({
          ...beneficiaryData,
          created_at: new Date().toISOString(),
        })
        .select()
        .single()
      
      beneficiary = inserted
      error = insertError
    }

    if (error) {
      console.error('[Beneficiaries] Error saving beneficiary:', error)
      console.error('[Beneficiaries] Error details:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      })
      
      // Provide more helpful error messages
      let errorMessage = 'Failed to save beneficiary'
      if (error.code === '42P01') {
        errorMessage = 'Database table not found. Please run the saved_beneficiaries migration.'
      } else if (error.code === '23505') {
        errorMessage = 'This account is already saved'
      } else if (error.code === '23503') {
        errorMessage = 'Invalid retailer reference. Please contact support.'
      } else if (error.message) {
        errorMessage = error.message
      }
      
      const response = NextResponse.json(
        { success: false, error: errorMessage },
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

