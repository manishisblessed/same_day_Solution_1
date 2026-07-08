import { NextRequest, NextResponse } from 'next/server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getTransferStatus } from '@/services/payout'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const STALE_MINUTES = 2
const NO_REF_REFUND_MINUTES = 5

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/payout/check-pending
 * 
 * Automatically resolves stuck pending/processing payout transactions.
 * - Transactions with UTR: checks SparkUpTech status API
 * - Transactions without UTR older than 48h: auto-refunds
 * - Can be triggered by cron, admin, or frontend
 * 
 * Headers:
 *   x-cron-secret: Optional secret for cron job authentication
 * 
 * Body (optional):
 *   retailer_id: Check only this retailer's transactions
 *   transaction_ids: Check only these specific transactions
 */
export async function POST(request: NextRequest) {
  try {
    const cronSecret = request.headers.get('x-cron-secret')
    const isAuthorizedCron = !!(cronSecret && cronSecret === process.env.CRON_SECRET)

    let authenticatedRetailerId: string | null = null
    if (!isAuthorizedCron) {
      const { user } = await getCurrentUserWithFallback(request)
      if (!user || !user.partner_id) {
        const response = NextResponse.json({ error: 'Authentication required' }, { status: 401 })
        return addCorsHeaders(request, response)
      }
      authenticatedRetailerId = user.partner_id
    }

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      // empty body is fine
    }

    const retailer_id = authenticatedRetailerId || body.retailer_id
    const { transaction_ids } = body

    const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString()
    const noRefRefundThreshold = new Date(Date.now() - NO_REF_REFUND_MINUTES * 60 * 1000).toISOString()

    let query = supabaseAdmin
      .from('payout_transactions')
      .select('id, retailer_id, client_ref_id, transaction_id, status, amount, charges, wallet_debited, created_at, account_holder_name, transfer_mode')
      .in('status', ['pending', 'processing'])
      .lt('created_at', staleThreshold)
      .order('created_at', { ascending: true })
      .limit(50)

    if (retailer_id) {
      query = query.eq('retailer_id', retailer_id)
    }

    if (transaction_ids && Array.isArray(transaction_ids) && transaction_ids.length > 0) {
      query = query.in('id', transaction_ids)
    }

    const { data: pendingTxs, error: fetchError } = await query

    if (fetchError) {
      console.error('[Check Pending] Error fetching transactions:', fetchError)
      const response = NextResponse.json(
        { success: false, error: 'Failed to fetch pending transactions' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    if (!pendingTxs || pendingTxs.length === 0) {
      const response = NextResponse.json({
        success: true,
        message: 'No pending transactions to check',
        checked: 0,
        resolved: 0,
        refunded: 0,
      })
      return addCorsHeaders(request, response)
    }

    console.log(`[Check Pending] Found ${pendingTxs.length} stale transactions to check`)

    // Determine user role from retailer_id — partners use UUIDs, retailers use text codes
    const resolveRole = (retailerId: string): string => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      return uuidRegex.test(retailerId) ? 'partner' : 'retailer'
    }

    let checked = 0
    let resolved = 0
    let refunded = 0
    let stillPending = 0
    const results: Array<{
      id: string
      previous_status: string
      new_status: string
      action: string
    }> = []

    for (const tx of pendingTxs) {
      checked++

      // Case 1: Transaction has UTR — check with SparkUpTech
      if (tx.transaction_id) {
        try {
          const statusResult = await getTransferStatus({
            transactionId: tx.transaction_id,
          })

          if (statusResult.success && statusResult.status) {
            const newStatus = statusResult.status

            if (newStatus !== tx.status) {
              const updateData: any = {
                status: newStatus,
                updated_at: new Date().toISOString(),
              }

              if (statusResult.operator_id) updateData.rrn = statusResult.operator_id
              if (newStatus === 'failed') updateData.failure_reason = statusResult.status_message || 'Transaction failed'
              if (newStatus === 'success' || newStatus === 'failed') {
                updateData.completed_at = new Date().toISOString()
              }

              if (newStatus === 'failed' && tx.wallet_debited) {
                // Atomically claim the failure→refund transition to prevent double-refund
                const { data: claimed } = await supabaseAdmin
                  .from('payout_transactions')
                  .update({
                    ...updateData,
                    status: 'refunded',
                    failure_reason: statusResult.status_message || 'Transaction failed',
                    completed_at: new Date().toISOString(),
                  })
                  .eq('id', tx.id)
                  .in('status', ['pending', 'processing'])
                  .select('id')

                if (claimed && claimed.length > 0) {
                  const totalAmount = parseFloat(String(tx.amount)) + parseFloat(String(tx.charges))
                  await supabaseAdmin.rpc('add_ledger_entry', {
                    p_user_id: tx.retailer_id,
                    p_user_role: resolveRole(tx.retailer_id),
                    p_wallet_type: 'primary',
                    p_fund_category: 'payout',
                    p_service_type: 'payout',
                    p_tx_type: 'REFUND',
                    p_credit: totalAmount,
                    p_debit: 0,
                    p_reference_id: `REFUND_${tx.client_ref_id}`,
                    p_transaction_id: tx.id,
                    p_status: 'completed',
                    p_remarks: `Payout failed - Auto refund (check-pending): ${statusResult.status_message || 'Unknown reason'}`
                  })
                }

                refunded++
                results.push({ id: tx.id, previous_status: tx.status, new_status: 'refunded', action: 'auto_refund_failed' })
              } else {
                await supabaseAdmin
                  .from('payout_transactions')
                  .update(updateData)
                  .eq('id', tx.id)

                resolved++
                results.push({ id: tx.id, previous_status: tx.status, new_status: newStatus, action: 'status_updated' })
              }
            } else {
              stillPending++
              results.push({ id: tx.id, previous_status: tx.status, new_status: tx.status, action: 'still_pending' })
            }
          } else {
            stillPending++
            results.push({ id: tx.id, previous_status: tx.status, new_status: tx.status, action: 'provider_check_failed' })
          }
        } catch (err: any) {
          console.error(`[Check Pending] Error checking tx ${tx.id}:`, err)
          results.push({ id: tx.id, previous_status: tx.status, new_status: tx.status, action: 'error' })
        }

        continue
      }

      // Case 2: No UTR — SparkUp never acknowledged, money never left
      const txAge = Date.now() - new Date(tx.created_at).getTime()
      const txAgeMinutes = txAge / (1000 * 60)

      if (tx.created_at < noRefRefundThreshold && tx.wallet_debited) {
        const totalAmount = parseFloat(String(tx.amount)) + parseFloat(String(tx.charges))

        try {
          // Atomically claim the refund transition to prevent double-refund
          const { data: claimed } = await supabaseAdmin
            .from('payout_transactions')
            .update({
              status: 'refunded',
              failure_reason: `Auto-refunded: No provider response after ${Math.round(txAgeMinutes)} minutes`,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', tx.id)
            .in('status', ['pending', 'processing'])
            .select('id')

          if (claimed && claimed.length > 0) {
            await supabaseAdmin.rpc('add_ledger_entry', {
              p_user_id: tx.retailer_id,
              p_user_role: resolveRole(tx.retailer_id),
              p_wallet_type: 'primary',
              p_fund_category: 'payout',
              p_service_type: 'payout',
              p_tx_type: 'REFUND',
              p_credit: totalAmount,
              p_debit: 0,
              p_reference_id: `REFUND_TIMEOUT_${tx.client_ref_id}`,
              p_transaction_id: tx.id,
              p_status: 'completed',
              p_remarks: `Payout auto-refund: No provider response after ${Math.round(txAgeMinutes)}min (no UTR received)`
            })
          }

          refunded++
          results.push({ id: tx.id, previous_status: tx.status, new_status: 'refunded', action: 'auto_refund_no_reference' })
        } catch (err: any) {
          console.error(`[Check Pending] Error refunding tx ${tx.id}:`, err)
          results.push({ id: tx.id, previous_status: tx.status, new_status: tx.status, action: 'refund_error' })
        }
      } else {
        stillPending++
        results.push({
          id: tx.id,
          previous_status: tx.status,
          new_status: tx.status,
          action: `no_utr_waiting (${Math.round(txAgeMinutes)}min old, refund at ${NO_REF_REFUND_MINUTES}min)`
        })
      }
    }

    console.log(`[Check Pending] Complete: checked=${checked}, resolved=${resolved}, refunded=${refunded}, stillPending=${stillPending}`)

    const response = NextResponse.json({
      success: true,
      checked,
      resolved,
      refunded,
      still_pending: stillPending,
      results: isAuthorizedCron || body.include_details ? results : undefined,
    })
    return addCorsHeaders(request, response)

  } catch (error: any) {
    console.error('[Check Pending] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Failed to check pending transactions' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

/**
 * GET /api/payout/check-pending
 * Quick check for a single retailer's pending transaction count
 */
export async function GET(request: NextRequest) {
  try {
    // Require authentication; callers may only check their OWN pending count
    // (admins/finance may query any retailer).
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !user.partner_id) {
      const response = NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    const { searchParams } = new URL(request.url)
    const isPrivileged = ['admin', 'finance_executive'].includes(user.role as string)
    const retailerId = isPrivileged ? searchParams.get('retailer_id') : user.partner_id

    if (!retailerId) {
      const response = NextResponse.json(
        { success: false, error: 'retailer_id is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const { count, error } = await supabaseAdmin
      .from('payout_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('retailer_id', retailerId)
      .in('status', ['pending', 'processing'])

    if (error) {
      const response = NextResponse.json(
        { success: false, error: 'Failed to check pending count' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      pending_count: count || 0,
    })
    return addCorsHeaders(request, response)

  } catch (error: any) {
    const response = NextResponse.json(
      { success: false, error: error.message || 'Failed' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
