import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { resolvePay2NewDebitState, type Pay2NewDebitRow } from '@/lib/pay2new/ledger-status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(request: NextRequest) {
  try {
    let authResult
    try {
      authResult = await authenticatePartner(request)
    } catch (error) {
      const e = error as PartnerAuthError
      return NextResponse.json(
        { success: false, error: { code: e.code, message: e.message } },
        { status: e.status }
      )
    }

    const { partner } = authResult
    const access = partnerCanUseApi(partner, 'bbps2')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: access.message } },
        { status: 403 }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        { status: 400 }
      )
    }

    const { order_id, request_id, bill_fetch_ref } = body

    if (!order_id && !request_id && !bill_fetch_ref) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'One of request_id, order_id or bill_fetch_ref is required' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // Resolve the Pay2New DEBIT row from whichever reference the partner holds.
    //   - request_id      -> ledger reference_id (reliable text key)
    //   - bill_fetch_ref   -> dedicated column (the one ref kept after a lost reply)
    //   - order_id (uuid)  -> payout_transaction_id (rare genuine uuid)
    //   - order_id (P2N…)  -> parsed from the description ("OrderID:…")
    let query = supabase
      .from('partner_wallet_ledger')
      .select('id, transaction_type, debit, reference_id, description, status, created_at, bill_fetch_ref')
      .eq('partner_id', partner.id)

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (request_id) {
      query = query.eq('reference_id', request_id)
    } else if (bill_fetch_ref) {
      query = query
        .eq('service_type', 'pay2new')
        .eq('transaction_type', 'DEBIT')
        .eq('bill_fetch_ref', String(bill_fetch_ref))
    } else if (UUID_RE.test(String(order_id))) {
      query = query.eq('payout_transaction_id', order_id)
    } else {
      // Escape LIKE wildcards so the id is matched literally.
      const safeOrderId = String(order_id).replace(/[\\%_]/g, (ch) => `\\${ch}`)
      query = query.ilike('description', `%OrderID:${safeOrderId}%`)
    }

    const { data: ledgerEntries, error: ledgerErr } = await query
      .order('created_at', { ascending: false })
      .limit(5)

    if (ledgerErr) {
      console.error('[Partner Pay2New Status] Ledger query error:', ledgerErr)
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to query transaction' } },
        { status: 500 }
      )
    }

    // Find the debit entry (the payment)
    const debitEntry = ledgerEntries?.find(e => (e.debit || 0) > 0) as Pay2NewDebitRow | undefined

    if (!debitEntry) {
      // No debit found — try to find by refund reference pattern (request_id only).
      if (request_id) {
        const { data: refundCheck } = await supabase
          .from('partner_wallet_ledger')
          .select('id, reference_id, created_at')
          .eq('partner_id', partner.id)
          .eq('reference_id', `REFUND_${request_id}`)
          .limit(1)

        if (refundCheck && refundCheck.length > 0) {
          return NextResponse.json({
            success: true,
            order_id: null,
            status: 'REFUNDED',
            amount: null,
            charge: null,
            operator_reference: null,
            bill_fetch_ref: null,
            created_at: refundCheck[0].created_at,
            updated_at: refundCheck[0].created_at,
            request_id,
          })
        }
      }

      return NextResponse.json(
        { success: false, error: { code: 'ORDER_NOT_FOUND', message: 'No transaction found with the given request_id, order_id or bill_fetch_ref' } },
        { status: 404 }
      )
    }

    // Single source of truth for state (reads order_id from the description, does
    // a non-mutating upstream check for still-pending rows). Fixes the old bug
    // where order_id was read from payout_transaction_id and always came back null.
    const resolved = await resolvePay2NewDebitState(supabase, partner.id, debitEntry)

    return NextResponse.json({
      success: true,
      order_id: resolved.orderId,
      status: resolved.status,
      amount: resolved.amount,
      charge: resolved.charge,
      operator_reference: resolved.operatorReference,
      bill_fetch_ref: resolved.billFetchRef,
      created_at: resolved.createdAt,
      updated_at: resolved.updatedAt,
      request_id: resolved.requestId,
    })
  } catch (error: any) {
    console.error('[Partner Pay2New Status] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
