import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const dynamic = 'force-dynamic'

function calculateVerificationScore(userData: any): number {
  let score = 0
  if (userData.pan_verified) score += 40
  if (userData.bank_verified) score += 40
  if (userData.gst_verified) score += 20
  return score
}

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
 * Create distributor (by master distributor)
 * 
 * Authorization:
 * - Only master distributors can create distributors
 * - Automatically sets master_distributor_id to the logged-in master distributor
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication with fallback
    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[Create Distributor] Auth method:', method, '| User:', user?.email || 'none')
    
    if (!user) {
      return NextResponse.json(
        { error: 'Session expired. Please log out and log back in.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
    }
    
    if (user.role !== 'master_distributor') {
      return NextResponse.json(
        { error: 'Unauthorized: Master Distributor access required' },
        { status: 403 }
      )
    }

    // Get Supabase admin client
    const supabase = getSupabaseAdmin()

    // Get master distributor data
    const { data: masterDist, error: masterError } = await supabase
      .from('master_distributors')
      .select('id, partner_id, status')
      .eq('email', user.email)
      .single()

    if (masterError || !masterDist) {
      return NextResponse.json(
        { error: 'Master Distributor not found' },
        { status: 404 }
      )
    }

    if (masterDist.status !== 'active') {
      return NextResponse.json(
        { error: 'Master Distributor must be active to create distributors' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { email, password, userData } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError) {
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      )
    }

    // Generate partner ID
    const partnerId = `DIS${Date.now().toString().slice(-8)}`

    // Validate mandatory fields (bank details verified via API, no document upload needed)
    if (!userData.account_number || !userData.ifsc_code) {
      await supabase.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json(
        { error: 'Account Number and IFSC Code are mandatory' },
        { status: 400 }
      )
    }

    if (!userData.pan_number) {
      await supabase.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json(
        { error: 'PAN Number is mandatory' },
        { status: 400 }
      )
    }

    // Prepare distributor data with eKYC Hub verified fields
    const distributorData: Record<string, any> = {
      partner_id: partnerId,
      name: userData.name,
      email: email,
      phone: userData.phone,
      business_name: userData.business_name || null,
      address: userData.address || null,
      city: userData.city || null,
      state: userData.state || null,
      pincode: userData.pincode || null,
      gst_number: userData.gst_number || null,
      master_distributor_id: masterDist.partner_id,
      status: 'pending_verification',
      commission_rate: userData.commission_rate ? parseFloat(userData.commission_rate) : null,
      // Bank account details
      bank_name: userData.bank_name || null,
      account_number: userData.account_number,
      ifsc_code: userData.ifsc_code,
      bank_document_url: userData.bank_document_url || null,
      // Identity fields
      aadhar_number: userData.aadhar_number || null,
      aadhar_front_url: userData.aadhar_front_url || null,
      aadhar_back_url: userData.aadhar_back_url || null,
      pan_number: userData.pan_number || null,
      pan_attachment_url: userData.pan_attachment_url || null,
      udhyam_number: userData.udhyam_number || null,
      udhyam_certificate_url: userData.udhyam_certificate_url || null,
      gst_certificate_url: userData.gst_certificate_url || null,
      verification_status: 'pending',
      // eKYC Hub verified fields
      pan_verified: userData.pan_verified || false,
      pan_registered_name: userData.pan_registered_name || null,
      pan_type: userData.pan_type || null,
      pan_verified_at: userData.pan_verified ? new Date().toISOString() : null,
      bank_verified: userData.bank_verified || false,
      bank_verified_name: userData.bank_verified_name || null,
      bank_utr: userData.bank_utr || null,
      bank_branch: userData.bank_branch || null,
      bank_city: userData.bank_city || null,
      bank_verified_at: userData.bank_verified ? new Date().toISOString() : null,
      gst_verified: userData.gst_verified || false,
      gst_legal_name: userData.gst_legal_name || null,
      gst_trade_name: userData.gst_trade_name || null,
      gst_status: userData.gst_status || null,
      gst_taxpayer_type: userData.gst_taxpayer_type || null,
      gst_constitution: userData.gst_constitution || null,
      gst_address: userData.gst_address || null,
      gst_verified_at: userData.gst_verified ? new Date().toISOString() : null,
      cin_number: userData.cin_number || null,
      cin_verified: userData.cin_verified || false,
      cin_company_name: userData.cin_company_name || null,
      cin_status: userData.cin_status || null,
      cin_incorporation_date: userData.cin_incorporation_date || null,
      aadhaar_verified: userData.aadhaar_verified || false,
      aadhaar_name: userData.aadhaar_name || null,
      aadhaar_dob: userData.aadhaar_dob || null,
      aadhaar_gender: userData.aadhaar_gender || null,
      aadhaar_address: userData.aadhaar_address || null,
      aadhaar_uid: userData.aadhaar_uid || null,
      digilocker_verification_id: userData.digilocker_verification_id || null,
      ekychub_order_ids: userData.ekychub_order_ids || {},
      auto_verification_score: calculateVerificationScore(userData),
    }

    // Insert distributor
    const { data: distributor, error: insertError } = await supabase
      .from('distributors')
      .insert([distributorData])
      .select()
      .single()

    if (insertError) {
      // Rollback: delete auth user
      await supabase.auth.admin.deleteUser(authData.user.id)
      
      // Check if error is due to missing columns (migration not run)
      const errorMessage = insertError.message || ''
      const errorCode = (insertError as any).code || ''
      
      if (errorMessage.includes('column') && (errorMessage.includes('bank_name') || errorMessage.includes('account_number') || errorMessage.includes('ifsc_code') || errorMessage.includes('bank_document_url')) || 
          errorCode === '42703' || errorMessage.includes('does not exist')) {
        console.error('[Create Distributor API] Database column error - migration may not be run:', insertError)
        return NextResponse.json(
          { 
            error: 'Database migration required. The bank account columns do not exist in the database.',
            details: 'Please run the migration file: supabase-migration-add-bank-account-fields.sql in your Supabase SQL Editor.'
          },
          { status: 500 }
        )
      }
      
      console.error('[Create Distributor API] Database insert error:', insertError)
      return NextResponse.json(
        { 
          error: insertError.message || 'Failed to create distributor',
          details: errorMessage
        },
        { status: 400 }
      )
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'md_create_distributor',
      activity_category: 'master_dist',
      activity_description: `Master distributor created distributor: ${email || userData?.name || 'unknown'}`,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      distributor: distributor,
    })
  } catch (error: any) {
    console.error('[Create Distributor API] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create distributor' },
      { status: 500 }
    )
  }
}

