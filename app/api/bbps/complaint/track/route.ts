import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { createClient } from '@supabase/supabase-js'
import { complaintTracking } from '@/services/bbps'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { complaint_id, complaint_type } = body
    
    // Try cookie-based auth first
    let user = await getCurrentUserFromRequest(request)
    
    // If cookie auth fails, try to verify user from request body (fallback)
    if (!user && body.user_id) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
      const supabase = createClient(supabaseUrl, supabaseServiceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      
      const { data: retailer } = await supabase
        .from('retailers')
        .select('partner_id, name, email')
        .eq('partner_id', body.user_id)
        .maybeSingle()
      
      if (retailer) {
        user = {
          id: body.user_id,
          email: retailer.email,
          role: 'retailer',
          partner_id: retailer.partner_id,
          name: retailer.name,
        }
        // Fallback auth active (cross-origin — no Supabase cookies)
      }
    }
    
    if (!user) {
      console.error('[BBPS Complaint Track] No authenticated user found')
      const response = NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    // Only retailers can track complaints
    if (user.role !== 'retailer') {
      const response = NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    if (!complaint_id) {
      const response = NextResponse.json(
        { error: 'complaint_id is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const complaint = await complaintTracking({
      complaintId: complaint_id,
      complaintType: complaint_type || 'Service',
    })

    // Return response matching tested API format
    // Note: The response format may vary, but we'll return the complaint tracking data
    const response = NextResponse.json({
      success: true,
      status: complaint.status || 'success',
      message: 'Complaint tracking details fetched',
      data: {
        complaintId: complaint.complaint_id,
        complaintType: complaint.complaint_type || complaint_type || 'Service',
        status: complaint.status,
        description: complaint.description,
        resolution: complaint.resolution,
      },
      // Also include full complaint object for backward compatibility
      complaint,
    })
    
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error tracking complaint:', error)
    const response = NextResponse.json(
      { error: 'Failed to track complaint' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}






