import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { checkTransactionStatus } from '@/services/shadval-pay'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
 * POST /api/settlement-2/status
 * Check status of a settlement transaction
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request)
    if (!user || user.role !== 'retailer') {
      const response = NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { reference_id } = body

    if (!reference_id) {
      const response = NextResponse.json({ success: false, error: 'reference_id is required' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    // Verify the transaction belongs to this retailer
    const { data: txRecord } = await supabaseAdmin
      .from('shadval_settlement')
      .select('id, retailer_id')
      .eq('reference_id', reference_id)
      .eq('retailer_id', user.partner_id)
      .maybeSingle()

    if (!txRecord) {
      const response = NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 404 })
      return addCorsHeaders(request, response)
    }

    const apiResult = await checkTransactionStatus({ reference_id })

    if (apiResult.status === 'SUCCESS' && apiResult.data) {
      const newStatus = apiResult.data.txn_status?.toLowerCase().includes('success')
        ? 'SUCCESS'
        : apiResult.data.txn_status?.toLowerCase().includes('fail')
        ? 'FAILED'
        : 'PENDING'

      await supabaseAdmin
        .from('shadval_settlement')
        .update({
          status: newStatus,
          utr: apiResult.data.utr || undefined,
          order_id: apiResult.data.order_id || undefined,
          status_message: apiResult.data.status_message || apiResult.data.txn_status,
          provider_timestamp: apiResult.data.timestamp,
        })
        .eq('id', txRecord.id)

      const response = NextResponse.json({ success: true, data: apiResult.data })
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: false,
      error: apiResult.message || 'Status check failed',
      code: apiResult.code,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Settlement-2 Status] Error:', error)
    const response = NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return addCorsHeaders(request, response)
  }
}
