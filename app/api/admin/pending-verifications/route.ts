import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserServer } from '@/lib/auth-server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

export const dynamic = 'force-dynamic'

/**
 * Get all partners with pending_verification status
 * 
 * Authorization:
 * - Admin access required
 */
export async function GET(request: NextRequest) {
  try {
    // Check admin authentication
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    // Fetch all partners with pending_verification status
    const [retailersResult, distributorsResult, masterDistributorsResult] = await Promise.all([
      supabaseAdmin
        .from('retailers')
        .select('partner_id, name, email, phone, status, verification_status, aadhar_number, aadhar_attachment_url, pan_number, pan_attachment_url, udhyam_number, udhyam_certificate_url, gst_number, gst_certificate_url, created_at')
        .eq('status', 'pending_verification'),
      supabaseAdmin
        .from('distributors')
        .select('partner_id, name, email, phone, status, verification_status, aadhar_number, aadhar_attachment_url, pan_number, pan_attachment_url, udhyam_number, udhyam_certificate_url, gst_number, gst_certificate_url, created_at')
        .eq('status', 'pending_verification'),
      supabaseAdmin
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

