import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { pay2newCheckStatus } from '@/services/pay2new'

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

    const { order_id, request_id } = body

    if (!order_id && !request_id) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Either order_id or request_id is required' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // Look up the transaction in partner_wallet_ledger
    let query = supabase
      .from('partner_wallet_ledger')
      .select('id, transaction_type, credit, debit, reference_id, payout_transaction_id, description, status, created_at')
      .eq('partner_id', partner.id)

    if (order_id) {
      query = query.eq('payout_transaction_id', order_id)
    } else {
      query = query.eq('reference_id', request_id)
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
    const debitEntry = ledgerEntries?.find(e => (e.debit || 0) > 0)

    if (!debitEntry) {
      // No debit found — try to find by refund reference pattern
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
            created_at: refundCheck[0].created_at,
            updated_at: refundCheck[0].created_at,
            request_id,
          })
        }
      }

      return NextResponse.json(
        { success: false, error: { code: 'ORDER_NOT_FOUND', message: 'No transaction found with the given order_id or request_id' } },
        { status: 404 }
      )
    }

    const txRequestId = debitEntry.reference_id
    const txOrderId = debitEntry.payout_transaction_id

    // Check if there's a refund for this transaction
    const { data: refundEntries } = await supabase
      .from('partner_wallet_ledger')
      .select('id, credit, created_at')
      .eq('partner_id', partner.id)
      .eq('reference_id', `REFUND_${txRequestId}`)
      .limit(1)

    const wasRefunded = refundEntries && refundEntries.length > 0

    // Determine status from local records
    let txStatus: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REFUNDED' = 'SUCCESS'
    let operatorReference: string | null = null

    if (wasRefunded) {
      txStatus = 'REFUNDED'
    } else if (txOrderId?.startsWith('FAILED:')) {
      txStatus = 'FAILED'
    } else if (!txOrderId) {
      // No order_id stored yet — might still be processing or was a timeout
      txStatus = 'PENDING'
    }

    // Parse operator_reference from description if available
    const descMatch = debitEntry.description?.match(/Ref:([^\s|]+)/)
    if (descMatch && descMatch[1] !== 'N/A') {
      operatorReference = descMatch[1]
    }

    // Extract charge from debit amount and description
    const amountMatch = debitEntry.description?.match(/₹([\d.]+)\s*\+\s*₹([\d.]+)\s*charge/)
    const billAmount = amountMatch ? parseFloat(amountMatch[1]) : null
    const chargeAmount = amountMatch ? parseFloat(amountMatch[2]) : null

    // Try upstream provider status check for PENDING transactions
    if (txStatus === 'PENDING' && txRequestId) {
      try {
        const upstreamResult = await pay2newCheckStatus({ request_id: txRequestId })
        if (upstreamResult.success && upstreamResult.status) {
          txStatus = upstreamResult.status
          if (upstreamResult.operator_reference) {
            operatorReference = upstreamResult.operator_reference
          }
          // Update ledger with resolved status
          if (txStatus === 'SUCCESS' && upstreamResult.order_id) {
            await supabase
              .from('partner_wallet_ledger')
              .update({ payout_transaction_id: upstreamResult.order_id })
              .eq('id', debitEntry.id)
          }
        }
      } catch (upstreamErr) {
        console.error('[Partner Pay2New Status] Upstream check failed (using local status):', upstreamErr)
      }
    }

    const resolvedOrderId = txOrderId?.startsWith('FAILED:') ? null : txOrderId

    return NextResponse.json({
      success: true,
      order_id: resolvedOrderId || null,
      status: txStatus,
      amount: billAmount,
      charge: chargeAmount,
      operator_reference: operatorReference,
      created_at: debitEntry.created_at,
      updated_at: wasRefunded ? refundEntries![0].created_at : debitEntry.created_at,
      request_id: txRequestId,
    })
  } catch (error: any) {
    console.error('[Partner Pay2New Status] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
