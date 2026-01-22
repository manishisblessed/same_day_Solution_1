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
 * Get all partners with pending_verification status
 * 
 * Authorization:
 * - Admin access required
 */
export async function GET(request: NextRequest) {
  try {
    // Check admin authentication with fallback
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Pending Verifications] Auth method:', method, '| User:', admin?.email || 'none')
    
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

    // Fetch all partners with pending_verification status
    const [retailersResult, distributorsResult, masterDistributorsResult] = await Promise.all([
      supabase
        .from('retailers')
        .select('partner_id, name, email, phone, status, verification_status, aadhar_number, aadhar_attachment_url, pan_number, pan_attachment_url, udhyam_number, udhyam_certificate_url, gst_number, gst_certificate_url, created_at')
        .eq('status', 'pending_verification'),
      supabase
        .from('distributors')
        .select('partner_id, name, email, phone, status, verification_status, aadhar_number, aadhar_attachment_url, pan_number, pan_attachment_url, udhyam_number, udhyam_certificate_url, gst_number, gst_certificate_url, created_at')
        .eq('status', 'pending_verification'),
      supabase
        .from('master_distributors')
        .select('partner_id, name, email, phone, status, verification_status, aadhar_number, aadhar_attachment_url, pan_number, pan_attachment_url, udhyam_number, udhyam_certificate_url, gst_number, gst_certificate_url, created_at')
        .eq('status', 'pending_verification')
    ])

    // Combine results with partner_type
    const partners = [
      ...(retailersResult.data || []).map(p => ({ ...p, partner_type: 'retailers' as const })),
      ...(distributorsResult.data || []).map(p => ({ ...p, partner_type: 'distributors' as const })),
      ...(masterDistributorsResult.data || []).map(p => ({ ...p, partner_type: 'master_distributors' as const }))
    ]

    // Sort by created_at (newest first)
    partners.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json({
      success: true,
      partners,
      counts: {
        total: partners.length,
        retailers: retailersResult.data?.length || 0,
        distributors: distributorsResult.data?.length || 0,
        master_distributors: masterDistributorsResult.data?.length || 0
      }
    })
  } catch (error: any) {
    console.error('[Pending Verifications API] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch pending verifications' },
      { status: 500 }
    )
  }
}

