/**
 * POST /api/aeps/settlement/check-pending
 *
 * Resolves stuck pending/processing AEPS settlement-to-bank transactions.
 * - With payout_reference_id: checks SparkUp status API
 * - Without reference older than 48h: auto-refunds to AEPS wallet
 * - On confirmed failure: refunds AEPS wallet + reverses margin credits
 *
 * Triggered by cron, admin, or frontend.
 */

import { NextRequest, NextResponse } from 'next/server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getTransferStatus } from '@/services/payout'
import { createClient } from '@supabase/supabase-js'

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

async function refundAEPSWallet(
  settlementId: string,
  userId: string,
  userRole: string,
  totalDebit: number,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const refRefId = `AEPS_SETTLE_REFUND_${settlementId}`

  const { data: existing } = await supabaseAdmin
    .from('wallet_ledger')
    .select('id')
    .eq('reference_id', refRefId)
    .maybeSingle()

  if (existing) {
    return { success: true }
  }

  const { error } = await supabaseAdmin.rpc('add_ledger_entry', {
    p_user_id: userId,
    p_user_role: userRole,
    p_wallet_type: 'aeps',
    p_fund_category: 'settlement',
    p_service_type: 'aeps',
    p_tx_type: 'REFUND',
    p_credit: totalDebit,
    p_debit: 0,
    p_reference_id: refRefId,
    p_transaction_id: settlementId,
    p_status: 'completed',
    p_remarks: `AEPS settlement failed - Auto refund (check-pending): ${reason}`,
  })

  if (error) {
    console.error(`[AEPS Check Pending] CRITICAL: Refund failed for ${settlementId}:`, error)
    return { success: false, error: error.message }
  }
  return { success: true }
}

async function creditMargins(
  settlementId: string,
  chargeBreakdown: any,
  charge: number,
  userId: string
): Promise<void> {
  if (!chargeBreakdown || charge <= 0) return

  const credits = [
    {
      userId: chargeBreakdown.distributor_id,
      role: 'distributor',
      amount: chargeBreakdown.distributor_commission,
      ref: `AEPS_SETTLE_MARGIN_DT_${settlementId}`,
      category: 'commission',
      txType: 'AEPS_SETTLE_MARGIN',
      label: 'DT',
    },
    {
      userId: chargeBreakdown.md_id,
      role: 'master_distributor',
      amount: chargeBreakdown.md_commission,
      ref: `AEPS_SETTLE_MARGIN_MD_${settlementId}`,
      category: 'commission',
      txType: 'AEPS_SETTLE_MARGIN',
      label: 'MD',
    },
  ]

  for (const c of credits) {
    if (!c.userId || !c.amount || c.amount <= 0) continue

    const { data: existing } = await supabaseAdmin
      .from('wallet_ledger')
      .select('id')
      .eq('reference_id', c.ref)
      .maybeSingle()
    if (existing) continue

    const { error } = await supabaseAdmin.rpc('add_ledger_entry', {
      p_user_id: c.userId,
      p_user_role: c.role,
      p_wallet_type: 'primary',
      p_fund_category: c.category,
      p_service_type: 'aeps',
      p_tx_type: c.txType,
      p_credit: c.amount,
      p_debit: 0,
      p_reference_id: c.ref,
      p_transaction_id: settlementId,
      p_status: 'completed',
      p_remarks: `AEPS settlement ${c.label} margin: ₹${c.amount} (check-pending)`,
    })
    if (error) console.error(`[AEPS Check Pending] Margin credit failed (${c.ref}):`, error)
    else console.log(`[AEPS Check Pending] Credited ${c.label} margin: ₹${c.amount}`)
  }

  const companyEarning = charge - (chargeBreakdown.distributor_commission || 0) - (chargeBreakdown.md_commission || 0)
  if (companyEarning > 0) {
    const revenueUserId = process.env.SUBSCRIPTION_REVENUE_USER_ID
    const revenueUserRole = process.env.SUBSCRIPTION_REVENUE_USER_ROLE || 'master_distributor'
    if (revenueUserId) {
      const revenueRef = `AEPS_SETTLE_REVENUE_${settlementId}`
      const { data: existing } = await supabaseAdmin
        .from('wallet_ledger')
        .select('id')
        .eq('reference_id', revenueRef)
        .maybeSingle()
      if (!existing) {
        const { error } = await supabaseAdmin.rpc('add_ledger_entry', {
          p_user_id: revenueUserId,
          p_user_role: revenueUserRole,
          p_wallet_type: 'primary',
          p_fund_category: 'revenue',
          p_service_type: 'aeps',
          p_tx_type: 'COMPANY_REVENUE',
          p_credit: companyEarning,
          p_debit: 0,
          p_reference_id: revenueRef,
          p_transaction_id: settlementId,
          p_status: 'completed',
          p_remarks: `Company revenue from AEPS settlement (check-pending): ₹${companyEarning} on user ${userId}`,
        })
        if (error) console.error(`[AEPS Check Pending] Company revenue failed:`, error)
        else console.log(`[AEPS Check Pending] Company revenue credited: ₹${companyEarning}`)
      }
    }
  }
}

async function reverseMargins(settlementId: string): Promise<void> {
  const marginRefs = [
    { ref: `AEPS_SETTLE_MARGIN_DT_${settlementId}`, type: 'distributor' },
    { ref: `AEPS_SETTLE_MARGIN_MD_${settlementId}`, type: 'master_distributor' },
    { ref: `AEPS_SETTLE_REVENUE_${settlementId}`, type: 'company' },
  ]

  for (const m of marginRefs) {
    const { data: entry } = await supabaseAdmin
      .from('wallet_ledger')
      .select('id, user_id, user_role, credit')
      .eq('reference_id', m.ref)
      .eq('status', 'completed')
      .maybeSingle()

    if (!entry || !entry.credit || entry.credit <= 0) continue

    const reversalRef = `${m.ref}_REVERSAL`
    const { data: alreadyReversed } = await supabaseAdmin
      .from('wallet_ledger')
      .select('id')
      .eq('reference_id', reversalRef)
      .maybeSingle()

    if (alreadyReversed) continue

    const txType = m.type === 'company' ? 'COMPANY_REVENUE_REVERSAL' : 'MARGIN_REVERSAL'

    const { error } = await supabaseAdmin.rpc('add_ledger_entry', {
      p_user_id: entry.user_id,
      p_user_role: entry.user_role,
      p_wallet_type: 'primary',
      p_fund_category: m.type === 'company' ? 'revenue' : 'commission',
      p_service_type: 'aeps',
      p_tx_type: txType,
      p_credit: 0,
      p_debit: entry.credit,
      p_reference_id: reversalRef,
      p_transaction_id: settlementId,
      p_status: 'completed',
      p_remarks: `AEPS settlement failed - margin reversal for ${settlementId}`,
    })

    if (error) {
      console.error(`[AEPS Check Pending] Margin reversal failed (${m.ref}):`, error)
    } else {
      console.log(`[AEPS Check Pending] Reversed margin ${m.ref}: ₹${entry.credit}`)
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const cronSecret = request.headers.get('x-cron-secret')
    const isAuthorizedCron = cronSecret === process.env.CRON_SECRET

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      // empty body is fine
    }

    const { user_id, settlement_ids } = body

    const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString()
    const noRefRefundThreshold = new Date(Date.now() - NO_REF_REFUND_MINUTES * 60 * 1000).toISOString()

    let query = supabaseAdmin
      .from('aeps_settlements')
      .select('id, user_id, user_role, amount, charge, payout_reference_id, status, ledger_entry_id, created_at, charge_breakdown')
      .in('status', ['pending', 'processing'])
      .lt('created_at', staleThreshold)
      .order('created_at', { ascending: true })
      .limit(50)

    if (user_id) {
      query = query.eq('user_id', user_id)
    }
    if (settlement_ids && Array.isArray(settlement_ids) && settlement_ids.length > 0) {
      query = query.in('id', settlement_ids)
    }

    const { data: pendingTxs, error: fetchError } = await query

    if (fetchError) {
      console.error('[AEPS Check Pending] Fetch error:', fetchError)
      const response = NextResponse.json(
        { success: false, error: 'Failed to fetch pending AEPS settlements' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    if (!pendingTxs || pendingTxs.length === 0) {
      const response = NextResponse.json({
        success: true,
        message: 'No pending AEPS settlements to check',
        checked: 0,
        resolved: 0,
        refunded: 0,
      })
      return addCorsHeaders(request, response)
    }

    console.log(`[AEPS Check Pending] Found ${pendingTxs.length} stale AEPS settlements`)

    let checked = 0
    let resolved = 0
    let refunded = 0
    let stillPending = 0
    const results: Array<{
      id: string
      user_id: string
      amount: number
      previous_status: string
      new_status: string
      action: string
    }> = []

    for (const tx of pendingTxs) {
      checked++
      const totalDebit = parseFloat(String(tx.amount)) + parseFloat(String(tx.charge || 0))
      const userRole = tx.user_role || 'retailer'

      // Case 1: Has payout reference — check SparkUp status
      if (tx.payout_reference_id) {
        try {
          const statusResult = await getTransferStatus({
            transactionId: tx.payout_reference_id,
          })

          if (statusResult.success && statusResult.status) {
            const newStatus = statusResult.status

            if (newStatus === 'success') {
              await supabaseAdmin
                .from('aeps_settlements')
                .update({
                  status: 'success',
                  completed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', tx.id)

              if (tx.ledger_entry_id) {
                await supabaseAdmin
                  .from('wallet_ledger')
                  .update({ status: 'completed' })
                  .eq('id', tx.ledger_entry_id)
              }

              // Credit deferred margins now that payout is confirmed
              await creditMargins(tx.id, tx.charge_breakdown, parseFloat(String(tx.charge || 0)), tx.user_id)

              resolved++
              results.push({ id: tx.id, user_id: tx.user_id, amount: totalDebit, previous_status: tx.status, new_status: 'success', action: 'status_updated' })

            } else if (newStatus === 'failed') {
              // Mark settlement + original ledger as failed
              await supabaseAdmin
                .from('aeps_settlements')
                .update({
                  status: 'failed',
                  failure_reason: statusResult.status_message || 'SparkUp confirmed failed',
                  completed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', tx.id)

              if (tx.ledger_entry_id) {
                await supabaseAdmin
                  .from('wallet_ledger')
                  .update({ status: 'failed' })
                  .eq('id', tx.ledger_entry_id)
              }

              // Refund AEPS wallet
              const refResult = await refundAEPSWallet(
                tx.id, tx.user_id, userRole, totalDebit,
                statusResult.status_message || 'SparkUp confirmed failed'
              )

              // Reverse any margins that were credited
              await reverseMargins(tx.id)

              refunded++
              results.push({
                id: tx.id,
                user_id: tx.user_id,
                amount: totalDebit,
                previous_status: tx.status,
                new_status: 'failed',
                action: refResult.success ? 'auto_refund_failed_provider' : 'refund_error',
              })

            } else {
              stillPending++
              results.push({ id: tx.id, user_id: tx.user_id, amount: totalDebit, previous_status: tx.status, new_status: tx.status, action: 'still_pending' })
            }
          } else {
            stillPending++
            results.push({ id: tx.id, user_id: tx.user_id, amount: totalDebit, previous_status: tx.status, new_status: tx.status, action: 'provider_check_failed' })
          }
        } catch (err: any) {
          console.error(`[AEPS Check Pending] Error checking ${tx.id}:`, err)
          results.push({ id: tx.id, user_id: tx.user_id, amount: totalDebit, previous_status: tx.status, new_status: tx.status, action: 'error' })
        }

        continue
      }

      // Case 2: No payout reference — SparkUp never acknowledged the transfer
      // Money never left SparkUp wallet. Refund after NO_REF_REFUND_MINUTES.
      const txAge = Date.now() - new Date(tx.created_at).getTime()
      const txAgeMinutes = txAge / (1000 * 60)

      if (tx.created_at < noRefRefundThreshold) {
        try {
          await supabaseAdmin
            .from('aeps_settlements')
            .update({
              status: 'failed',
              failure_reason: `No payout reference after ${Math.round(txAgeMinutes)} min - SparkUp never processed`,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', tx.id)

          if (tx.ledger_entry_id) {
            await supabaseAdmin
              .from('wallet_ledger')
              .update({ status: 'failed' })
              .eq('id', tx.ledger_entry_id)
          }

          const refResult = await refundAEPSWallet(
            tx.id, tx.user_id, userRole, totalDebit,
            `No payout reference after ${Math.round(txAgeMinutes)} min - SparkUp never processed`
          )

          await reverseMargins(tx.id)

          refunded++
          results.push({
            id: tx.id,
            user_id: tx.user_id,
            amount: totalDebit,
            previous_status: tx.status,
            new_status: 'failed',
            action: refResult.success ? 'auto_refund_no_reference' : 'refund_error',
          })
        } catch (err: any) {
          console.error(`[AEPS Check Pending] Error refunding ${tx.id}:`, err)
          results.push({ id: tx.id, user_id: tx.user_id, amount: totalDebit, previous_status: tx.status, new_status: tx.status, action: 'refund_error' })
        }
      } else {
        stillPending++
        results.push({
          id: tx.id,
          user_id: tx.user_id,
          amount: totalDebit,
          previous_status: tx.status,
          new_status: tx.status,
          action: `no_ref_waiting (${Math.round(txAgeMinutes)}min old, refund at ${NO_REF_REFUND_MINUTES}min)`,
        })
      }
    }

    console.log(`[AEPS Check Pending] Complete: checked=${checked}, resolved=${resolved}, refunded=${refunded}, stillPending=${stillPending}`)

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
    console.error('[AEPS Check Pending] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Failed to check pending AEPS settlements' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('user_id')

    if (!userId) {
      const response = NextResponse.json(
        { success: false, error: 'user_id is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const { count, error } = await supabaseAdmin
      .from('aeps_settlements')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
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
