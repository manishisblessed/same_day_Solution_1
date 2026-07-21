import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { getRechargekitBaseUrl, getRechargekitApiToken } from '@/services/rechargekit/config'

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

async function checkUpstreamStatus(requestId: string): Promise<{
  success: boolean
  status?: 'SUCCESS' | 'PENDING' | 'FAILED'
  txn_id?: string
  operator_reference?: string
  message?: string
}> {
  try {
    const base = getRechargekitBaseUrl().replace(/\/$/, '')
    const token = getRechargekitApiToken()
    const url = `${base}/recharge/statusCheck?partner_request_id=${encodeURIComponent(requestId)}`

    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json()
    const providerStatus = Number(data.status)

    if (providerStatus === 1) {
      return {
        success: true,
        status: 'SUCCESS',
        txn_id: data.orderid || data.txn_id,
        operator_reference: data.optransid || data.operator_ref,
        message: data.msg || 'Payment successful',
      }
    }
    if (providerStatus === 3) {
      return { success: true, status: 'FAILED', message: data.msg || 'Payment failed' }
    }
    return { success: true, status: 'PENDING', message: data.msg || 'Payment is still pending' }
  } catch (e: any) {
    console.error('[Partner Rechargekit Status] Upstream check failed:', e)
    return { success: false }
  }
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
    const access = partnerCanUseApi(partner, 'rechargekit')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'SERVICE_NOT_ENABLED', message: access.message } },
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

    const { txn_id, request_id } = body

    if (!txn_id && !request_id) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Either txn_id or request_id is required' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // reference_id (text) holds our request_id. We echo txn_id === request_id in the pay response,
    // and also store the provider TxnID inside the description, so we can look up by either.
    const lookup = String(request_id || txn_id)

    const baseSelect = () => supabase
      .from('partner_wallet_ledger')
      .select('id, transaction_type, credit, debit, reference_id, description, status, created_at')
      .eq('partner_id', partner.id)
      .eq('transaction_type', 'DEBIT')

    let { data: ledgerEntries, error: ledgerErr } = await baseSelect()
      .eq('reference_id', lookup)
      .order('created_at', { ascending: false })
      .limit(5)

    // Fallback: provider txn_id differs from request_id — match it inside the description
    if (!ledgerErr && (!ledgerEntries || ledgerEntries.length === 0) && txn_id) {
      const res2 = await baseSelect()
        .ilike('description', `%TxnID:${txn_id}%`)
        .order('created_at', { ascending: false })
        .limit(5)
      ledgerEntries = res2.data
      ledgerErr = res2.error
    }

    if (ledgerErr) {
      console.error('[Partner Rechargekit Status] Ledger query error:', ledgerErr)
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to query transaction' } },
        { status: 500 }
      )
    }

    const debitEntry = ledgerEntries?.find(e => (e.debit || 0) > 0)

    if (!debitEntry) {
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
            txn_id: null,
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
        { success: false, error: { code: 'ORDER_NOT_FOUND', message: 'No transaction found with the given txn_id or request_id' } },
        { status: 404 }
      )
    }

    const txRequestId = debitEntry.reference_id

    // Check for refund entry
    const { data: refundEntries } = await supabase
      .from('partner_wallet_ledger')
      .select('id, credit, created_at')
      .eq('partner_id', partner.id)
      .eq('reference_id', `REFUND_${txRequestId}`)
      .limit(1)

    const wasRefunded = refundEntries && refundEntries.length > 0

    // Parse provider TxnID + operator_reference from description
    const txnMatch = debitEntry.description?.match(/TxnID:([^\s|]+)/)
    let resolvedTxnId: string | null = txnMatch ? txnMatch[1] : null
    const descMatch = debitEntry.description?.match(/Ref:([^\s|]+)/)
    let operatorReference: string | null = descMatch && descMatch[1] !== 'N/A' ? descMatch[1] : null

    // Extract amounts from description
    const amountMatch = debitEntry.description?.match(/₹([\d.]+)\s*\+\s*₹([\d.]+)\s*charge/)
    const billAmount = amountMatch ? parseFloat(amountMatch[1]) : null
    const chargeAmount = amountMatch ? parseFloat(amountMatch[2]) : null

    // Derive status from the ledger `status` column (set by pay route: SUCCESS/PENDING/FAILED),
    // falling back to 'completed' (debit persisted but provider result not yet recorded) => PENDING.
    const ledgerStatus = (debitEntry.status || '').toUpperCase()
    let txStatus: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REFUNDED' =
      wasRefunded ? 'REFUNDED'
      : ledgerStatus === 'SUCCESS' ? 'SUCCESS'
      : ledgerStatus === 'FAILED' ? 'FAILED'
      : 'PENDING'

    // For PENDING, check upstream provider status
    if (txStatus === 'PENDING' && txRequestId) {
      const upstream = await checkUpstreamStatus(txRequestId)
      if (upstream.success && upstream.status) {
        txStatus = upstream.status
        if (upstream.operator_reference) operatorReference = upstream.operator_reference
        if (upstream.txn_id) resolvedTxnId = upstream.txn_id

        if (txStatus === 'SUCCESS') {
          await supabase
            .from('partner_wallet_ledger')
            .update({ status: 'SUCCESS' })
            .eq('id', debitEntry.id)
        }

        if (txStatus === 'FAILED') {
          // Auto-refund on confirmed failure
          const refundAmount = (billAmount || 0) + (chargeAmount || 0)
          if (refundAmount > 0) {
            const { error: refundErr } = await supabase.rpc('refund_partner_wallet', {
              p_partner_id: partner.id,
              p_amount: refundAmount,
              p_payout_transaction_id: null,
              p_description: `CC-2 refund ₹${refundAmount} | Status check: ${upstream.message || 'failed'}`,
              p_reference_id: `REFUND_${txRequestId}`,
            })
            if (!refundErr) {
              txStatus = 'REFUNDED'
            }
          }
          await supabase
            .from('partner_wallet_ledger')
            .update({ status: 'FAILED' })
            .eq('id', debitEntry.id)
        }
      }
    }

    return NextResponse.json({
      success: true,
      txn_id: txStatus === 'FAILED' ? null : resolvedTxnId,
      status: txStatus,
      amount: billAmount,
      charge: chargeAmount,
      operator_reference: operatorReference,
      created_at: debitEntry.created_at,
      updated_at: wasRefunded ? refundEntries![0].created_at : debitEntry.created_at,
      request_id: txRequestId,
    })
  } catch (error: any) {
    console.error('[Partner Rechargekit Status] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
