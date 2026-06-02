import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/aeps/reconciliation
 * Fetch transactions under reconciliation with counts
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status') || 'under_reconciliation'
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')

    let query = supabase
      .from('aeps_transactions')
      .select('*', { count: 'exact' })

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    } else {
      query = query.in('status', ['under_reconciliation', 'pending', 'reversed'])
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

    const { data: transactions, error, count } = await query

    if (error) {
      console.error('[Reconciliation] Query error:', error)
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
    }

    // Get counts by status
    const { data: allRecon } = await supabase
      .from('aeps_transactions')
      .select('status')
      .in('status', ['under_reconciliation', 'pending', 'reversed'])

    const counts = {
      under_reconciliation: allRecon?.filter(t => t.status === 'under_reconciliation').length || 0,
      pending: allRecon?.filter(t => t.status === 'pending').length || 0,
      reversed: allRecon?.filter(t => t.status === 'reversed').length || 0,
      total: allRecon?.length || 0,
    }

    return NextResponse.json({
      transactions: transactions || [],
      counts,
      pagination: { total: count || 0, limit, offset, hasMore: (count || 0) > offset + limit },
    })
  } catch (error: any) {
    console.error('[Reconciliation] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}

/**
 * POST /api/admin/aeps/reconciliation
 * Actions: mark_success, mark_failed, force_refund, retry_check
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { transaction_id, action, remarks } = body

    if (!transaction_id || !action) {
      return NextResponse.json({ error: 'transaction_id and action are required' }, { status: 400 })
    }

    // Fetch the transaction
    const { data: txn, error: txError } = await supabase
      .from('aeps_transactions')
      .select('*')
      .eq('id', transaction_id)
      .single()

    if (txError || !txn) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'

    switch (action) {
      case 'mark_success': {
        if (txn.status !== 'under_reconciliation') {
          return NextResponse.json({ error: 'Only under_reconciliation transactions can be marked as success' }, { status: 400 })
        }

        await supabase
          .from('aeps_transactions')
          .update({
            status: 'success',
            completed_at: new Date().toISOString(),
            error_message: remarks ? `Manually resolved: ${remarks}` : 'Manually marked as success by admin',
          })
          .eq('id', transaction_id)

        await logAudit(supabase, admin, txn, 'reconciliation_mark_success', ipAddress, remarks)

        return NextResponse.json({ success: true, message: 'Transaction marked as success' })
      }

      case 'mark_failed': {
        if (txn.status !== 'under_reconciliation' && txn.status !== 'pending') {
          return NextResponse.json({ error: 'Only pending/under_reconciliation transactions can be marked as failed' }, { status: 400 })
        }

        await supabase
          .from('aeps_transactions')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: remarks || 'Manually marked as failed by admin',
          })
          .eq('id', transaction_id)

        // Auto-refund if wallet was debited for a financial transaction
        let refunded = false
        if (txn.is_financial && txn.wallet_debited && txn.amount > 0) {
          const { error: refundError } = await supabase.rpc('add_ledger_entry', {
            p_user_id: txn.user_id,
            p_user_role: txn.user_role,
            p_wallet_type: 'aeps',
            p_fund_category: 'aeps',
            p_service_type: 'aeps',
            p_tx_type: 'REFUND',
            p_credit: parseFloat(txn.amount),
            p_debit: 0,
            p_reference_id: `RECON_REFUND_${txn.id}_${Date.now()}`,
            p_transaction_id: txn.id,
            p_status: 'completed',
            p_remarks: `Reconciliation refund - ${remarks || 'marked failed by admin'}`,
          })

          if (!refundError) {
            refunded = true
            await supabase
              .from('aeps_transactions')
              .update({ wallet_debited: false })
              .eq('id', transaction_id)
          } else {
            console.error('[Reconciliation] Refund error:', refundError)
          }
        }

        await logAudit(supabase, admin, txn, 'reconciliation_mark_failed', ipAddress, remarks)

        return NextResponse.json({
          success: true,
          message: refunded
            ? `Transaction marked as failed. ₹${txn.amount} refunded to wallet.`
            : 'Transaction marked as failed',
          refunded,
        })
      }

      case 'force_refund': {
        if (txn.status === 'reversed') {
          return NextResponse.json({ error: 'Transaction already reversed' }, { status: 400 })
        }
        if (!txn.is_financial || !txn.amount || txn.amount <= 0) {
          return NextResponse.json({ error: 'Not a financial transaction — nothing to refund' }, { status: 400 })
        }

        const amount = parseFloat(txn.amount)

        const { error: refundError } = await supabase.rpc('add_ledger_entry', {
          p_user_id: txn.user_id,
          p_user_role: txn.user_role,
          p_wallet_type: 'aeps',
          p_fund_category: 'aeps',
          p_service_type: 'aeps',
          p_tx_type: 'REFUND',
          p_credit: amount,
          p_debit: 0,
          p_reference_id: `FORCE_REFUND_${txn.id}_${Date.now()}`,
          p_transaction_id: txn.id,
          p_status: 'completed',
          p_remarks: `Admin force refund - ${remarks || 'manual reconciliation'}`,
        })

        if (refundError) {
          console.error('[Reconciliation] Force refund error:', refundError)
          return NextResponse.json({ error: 'Failed to process refund' }, { status: 500 })
        }

        await supabase
          .from('aeps_transactions')
          .update({
            status: 'reversed',
            wallet_debited: false,
            completed_at: new Date().toISOString(),
            error_message: `Force refunded by admin: ${remarks || ''}`.trim(),
          })
          .eq('id', transaction_id)

        await logAudit(supabase, admin, txn, 'reconciliation_force_refund', ipAddress, remarks)

        return NextResponse.json({
          success: true,
          message: `₹${amount} refunded to user's AEPS wallet`,
          amount,
        })
      }

      case 'retry_check': {
        if (txn.status !== 'under_reconciliation') {
          return NextResponse.json({ error: 'Only under_reconciliation transactions can be retried' }, { status: 400 })
        }

        const useMock = process.env.AEPS_USE_MOCK === 'true'
        if (useMock) {
          return NextResponse.json({ error: 'Cannot retry status check in mock mode' }, { status: 400 })
        }

        const clientId = process.env.CHAGHANS_AEPS_CLIENT_ID
        const clientSecret = process.env.CHAGHANS_AEPS_CONSUMER_SECRET
        const authToken = process.env.CHAGHANS_AEPS_AUTH_TOKEN
        const baseUrl = process.env.CHAGHANS_AEPS_BASE_URL || 'https://api.chagans.com/aeps'

        if (!clientId || !clientSecret || !authToken) {
          return NextResponse.json({ error: 'Chagans API credentials not configured' }, { status: 500 })
        }

        const response = await fetch(`${baseUrl}/transactionStatus`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'client-id': clientId,
            'client-secret': clientSecret,
            'authorization': authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`,
            'apiType': 'aeps',
          },
          body: JSON.stringify({
            orderId: txn.order_id,
            merchantId: txn.merchant_id,
          }),
        })

        if (!response.ok) {
          return NextResponse.json({ error: `Chagans API returned HTTP ${response.status}` }, { status: 502 })
        }

        const result = await response.json()

        if (result.success && result.data) {
          const newStatus = result.data.status
          if (newStatus === 'success' || newStatus === 'failed') {
            await supabase
              .from('aeps_transactions')
              .update({
                status: newStatus,
                completed_at: new Date().toISOString(),
                utr: result.data.utr || txn.utr,
                error_message: newStatus === 'failed' ? (result.message || 'Failed after retry check') : null,
              })
              .eq('id', transaction_id)

            if (newStatus === 'failed' && txn.is_financial && txn.wallet_debited && txn.amount > 0) {
              await supabase.rpc('add_ledger_entry', {
                p_user_id: txn.user_id,
                p_user_role: txn.user_role,
                p_wallet_type: 'aeps',
                p_fund_category: 'aeps',
                p_service_type: 'aeps',
                p_tx_type: 'REFUND',
                p_credit: parseFloat(txn.amount),
                p_debit: 0,
                p_reference_id: `RETRY_REFUND_${txn.id}_${Date.now()}`,
                p_transaction_id: txn.id,
                p_status: 'completed',
                p_remarks: `Auto-refund after retry check confirmed failure`,
              })
              await supabase
                .from('aeps_transactions')
                .update({ wallet_debited: false })
                .eq('id', transaction_id)
            }

            await logAudit(supabase, admin, txn, `reconciliation_retry_${newStatus}`, ipAddress, `API status: ${newStatus}`)

            return NextResponse.json({
              success: true,
              message: `Transaction confirmed as ${newStatus} by payment provider`,
              newStatus,
              utr: result.data.utr || null,
            })
          }

          return NextResponse.json({
            success: true,
            message: 'Transaction still processing at payment provider',
            newStatus: 'under_reconciliation',
            providerResponse: result.data.status,
          })
        }

        return NextResponse.json({
          success: false,
          message: 'Unable to determine status from payment provider',
          providerResponse: result,
        })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error: any) {
    console.error('[Reconciliation] Error:', error)
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}

async function logAudit(
  supabase: any, admin: any, txn: any,
  actionType: string, ipAddress: string, remarks?: string
) {
  try {
    await supabase.from('admin_audit_log').insert({
      admin_id: admin.id,
      action_type: actionType,
      target_user_id: txn.user_id,
      target_user_role: txn.user_role,
      wallet_type: 'aeps',
      amount: txn.amount ? parseFloat(txn.amount) : 0,
      ip_address: ipAddress,
      remarks: `${actionType} for txn ${txn.order_id || txn.id} - ${remarks || ''}`.trim(),
      metadata: { transaction_id: txn.id, order_id: txn.order_id },
    })
  } catch (err) {
    console.error('[Reconciliation] Audit log error:', err)
  }
}
