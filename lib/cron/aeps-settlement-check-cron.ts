import cron, { ScheduledTask } from 'node-cron'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getTransferStatus } from '@/services/payout'

const CRON_EXPRESSION = '*/2 * * * *' // Every 2 minutes
const NO_REF_REFUND_MINUTES = 5

const g = globalThis as any
if (!g.__aepsSettlementCheckState) {
  g.__aepsSettlementCheckState = {
    task: null as ScheduledTask | null,
    isRunning: false,
  }
}
const state = g.__aepsSettlementCheckState

async function refundAEPSWallet(
  settlementId: string,
  userId: string,
  userRole: string,
  totalDebit: number,
  reason: string
): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const refRefId = `AEPS_SETTLE_REFUND_${settlementId}`

  const { data: existing } = await supabase
    .from('wallet_ledger')
    .select('id')
    .eq('reference_id', refRefId)
    .maybeSingle()

  if (existing) return true

  const { error } = await supabase.rpc('add_ledger_entry', {
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
    p_remarks: `AEPS settlement auto-refund: ${reason}`,
  })

  if (error) {
    console.error(`[AEPS-Cron] CRITICAL: Refund failed for ${settlementId}:`, error)
    return false
  }
  return true
}

async function reverseMargins(settlementId: string): Promise<void> {
  const supabase = getSupabaseAdmin()
  const marginRefs = [
    { ref: `AEPS_SETTLE_MARGIN_DT_${settlementId}`, type: 'distributor' },
    { ref: `AEPS_SETTLE_MARGIN_MD_${settlementId}`, type: 'master_distributor' },
    { ref: `AEPS_SETTLE_REVENUE_${settlementId}`, type: 'company' },
  ]

  for (const m of marginRefs) {
    const { data: entry } = await supabase
      .from('wallet_ledger')
      .select('id, user_id, user_role, credit')
      .eq('reference_id', m.ref)
      .eq('status', 'completed')
      .maybeSingle()

    if (!entry || !entry.credit || entry.credit <= 0) continue

    const reversalRef = `${m.ref}_REVERSAL`
    const { data: alreadyReversed } = await supabase
      .from('wallet_ledger')
      .select('id')
      .eq('reference_id', reversalRef)
      .maybeSingle()

    if (alreadyReversed) continue

    const txType = m.type === 'company' ? 'COMPANY_REVENUE_REVERSAL' : 'MARGIN_REVERSAL'
    await supabase.rpc('add_ledger_entry', {
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
  }
}

async function creditMargins(
  settlementId: string,
  chargeBreakdown: any,
  charge: number,
  userId: string
): Promise<void> {
  if (!chargeBreakdown || charge <= 0) return
  const supabase = getSupabaseAdmin()

  const credits = [
    {
      userId: chargeBreakdown.distributor_id,
      role: 'distributor',
      amount: chargeBreakdown.distributor_commission,
      ref: `AEPS_SETTLE_MARGIN_DT_${settlementId}`,
      txType: 'AEPS_SETTLE_MARGIN',
      label: 'DT',
    },
    {
      userId: chargeBreakdown.md_id,
      role: 'master_distributor',
      amount: chargeBreakdown.md_commission,
      ref: `AEPS_SETTLE_MARGIN_MD_${settlementId}`,
      txType: 'AEPS_SETTLE_MARGIN',
      label: 'MD',
    },
  ]

  for (const c of credits) {
    if (!c.userId || !c.amount || c.amount <= 0) continue

    const { data: existing } = await supabase
      .from('wallet_ledger')
      .select('id')
      .eq('reference_id', c.ref)
      .maybeSingle()
    if (existing) continue

    await supabase.rpc('add_ledger_entry', {
      p_user_id: c.userId,
      p_user_role: c.role,
      p_wallet_type: 'primary',
      p_fund_category: 'commission',
      p_service_type: 'aeps',
      p_tx_type: c.txType,
      p_credit: c.amount,
      p_debit: 0,
      p_reference_id: c.ref,
      p_transaction_id: settlementId,
      p_status: 'completed',
      p_remarks: `AEPS settlement ${c.label} margin: ₹${c.amount}`,
    })
  }

  const companyEarning = charge - (chargeBreakdown.distributor_commission || 0) - (chargeBreakdown.md_commission || 0)
  if (companyEarning > 0) {
    const revenueUserId = process.env.SUBSCRIPTION_REVENUE_USER_ID
    const revenueUserRole = process.env.SUBSCRIPTION_REVENUE_USER_ROLE || 'master_distributor'
    if (revenueUserId) {
      const revenueRef = `AEPS_SETTLE_REVENUE_${settlementId}`
      const { data: existing } = await supabase
        .from('wallet_ledger')
        .select('id')
        .eq('reference_id', revenueRef)
        .maybeSingle()
      if (!existing) {
        await supabase.rpc('add_ledger_entry', {
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
          p_remarks: `Company revenue from AEPS settlement: ₹${companyEarning}`,
        })
      }
    }
  }
}

async function runCheck(): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7867/ingest/aac68605-cf2d-4bda-9cb1-86d2057b4562',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'afdf80'},body:JSON.stringify({sessionId:'afdf80',location:'aeps-settlement-check-cron.ts:runCheck-entry',message:'runCheck called',data:{isRunning:state.isRunning},timestamp:Date.now(),hypothesisId:'H-A,H-E'})}).catch(()=>{});
  // #endregion
  if (state.isRunning) return
  state.isRunning = true

  try {
    const supabase = getSupabaseAdmin()

    const { data: pendingTxs, error } = await supabase
      .from('aeps_settlements')
      .select('id, user_id, user_role, amount, charge, payout_reference_id, status, ledger_entry_id, created_at, charge_breakdown')
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: true })
      .limit(50)

    // #region agent log
    fetch('http://127.0.0.1:7867/ingest/aac68605-cf2d-4bda-9cb1-86d2057b4562',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'afdf80'},body:JSON.stringify({sessionId:'afdf80',location:'aeps-settlement-check-cron.ts:db-query',message:'DB query result',data:{error:error?.message||null,count:pendingTxs?.length||0,txIds:pendingTxs?.map((t:any)=>({id:t.id,status:t.status,hasRef:!!t.payout_reference_id,ref:t.payout_reference_id}))||[]},timestamp:Date.now(),hypothesisId:'H-B'})}).catch(()=>{});
    // #endregion
    if (error || !pendingTxs || pendingTxs.length === 0) return

    console.log(`[AEPS-Cron] Checking ${pendingTxs.length} pending settlements`)

    for (const tx of pendingTxs) {
      const totalDebit = parseFloat(String(tx.amount)) + parseFloat(String(tx.charge || 0))
      const userRole = tx.user_role || 'retailer'

      if (tx.payout_reference_id) {
        // Has reference → SparkUp debited, check status
        try {
          const statusResult = await getTransferStatus({ transactionId: tx.payout_reference_id })

          // #region agent log
          fetch('http://127.0.0.1:7867/ingest/aac68605-cf2d-4bda-9cb1-86d2057b4562',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'afdf80'},body:JSON.stringify({sessionId:'afdf80',location:'aeps-settlement-check-cron.ts:status-result',message:'getTransferStatus result',data:{txId:tx.id,ref:tx.payout_reference_id,success:statusResult.success,status:statusResult.status,statusMessage:statusResult.status_message,error:statusResult.error},timestamp:Date.now(),hypothesisId:'H-C'})}).catch(()=>{});
          // #endregion
          if (!statusResult.success || !statusResult.status) continue

          if (statusResult.status === 'success') {
            await supabase.from('aeps_settlements').update({
              status: 'success',
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq('id', tx.id)

            if (tx.ledger_entry_id) {
              await supabase.from('wallet_ledger').update({ status: 'completed' }).eq('id', tx.ledger_entry_id)
            }

            await creditMargins(tx.id, tx.charge_breakdown, parseFloat(String(tx.charge || 0)), tx.user_id)
            console.log(`[AEPS-Cron] ${tx.id} → success`)

          } else if (statusResult.status === 'failed') {
            // SparkUp confirmed failed → money returned to SparkUp → refund retailer
            await supabase.from('aeps_settlements').update({
              status: 'failed',
              failure_reason: statusResult.status_message || 'SparkUp confirmed failed',
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq('id', tx.id)

            if (tx.ledger_entry_id) {
              await supabase.from('wallet_ledger').update({ status: 'failed' }).eq('id', tx.ledger_entry_id)
            }

            await refundAEPSWallet(tx.id, tx.user_id, userRole, totalDebit, statusResult.status_message || 'SparkUp confirmed failed')
            await reverseMargins(tx.id)
            console.log(`[AEPS-Cron] ${tx.id} → failed, refunded`)
          }
          // pending/processing → do nothing, check again next cycle
        } catch (err: any) {
          // #region agent log
          fetch('http://127.0.0.1:7867/ingest/aac68605-cf2d-4bda-9cb1-86d2057b4562',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'afdf80'},body:JSON.stringify({sessionId:'afdf80',location:'aeps-settlement-check-cron.ts:catch-error',message:'getTransferStatus threw error',data:{txId:tx.id,ref:tx.payout_reference_id,error:err.message,stack:err.stack?.slice(0,300)},timestamp:Date.now(),hypothesisId:'H-D'})}).catch(()=>{});
          // #endregion
          console.error(`[AEPS-Cron] Error checking ${tx.id}:`, err.message)
        }

      } else {
        // No payout reference → SparkUp never acknowledged, money never left
        // Refund after NO_REF_REFUND_MINUTES
        const ageMs = Date.now() - new Date(tx.created_at).getTime()
        if (ageMs < NO_REF_REFUND_MINUTES * 60 * 1000) continue

        await supabase.from('aeps_settlements').update({
          status: 'failed',
          failure_reason: `No payout reference after ${NO_REF_REFUND_MINUTES} min - SparkUp never processed`,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', tx.id)

        if (tx.ledger_entry_id) {
          await supabase.from('wallet_ledger').update({ status: 'failed' }).eq('id', tx.ledger_entry_id)
        }

        await refundAEPSWallet(tx.id, tx.user_id, userRole, totalDebit, 'No payout reference - SparkUp never processed')
        await reverseMargins(tx.id)
        console.log(`[AEPS-Cron] ${tx.id} → no reference, refunded after ${NO_REF_REFUND_MINUTES}min`)
      }
    }
  } catch (err: any) {
    console.error('[AEPS-Cron] Error:', err.message)
  } finally {
    state.isRunning = false
  }
}

export async function initAEPSSettlementCheckCron(): Promise<void> {
  if (state.task) {
    state.task.stop()
    state.task = null
  }

  state.task = cron.schedule(CRON_EXPRESSION, runCheck, {
    timezone: 'Asia/Kolkata',
  })

  // #region agent log
  fetch('http://127.0.0.1:7867/ingest/aac68605-cf2d-4bda-9cb1-86d2057b4562',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'afdf80'},body:JSON.stringify({sessionId:'afdf80',location:'aeps-settlement-check-cron.ts:init',message:'AEPS cron initialized',data:{cronExpression:CRON_EXPRESSION},timestamp:Date.now(),hypothesisId:'H-A'})}).catch(()=>{});
  // #endregion
  console.log('[AEPS-Cron] Settlement check cron started (every 2 minutes)')
}

export function stopAEPSSettlementCheckCron(): void {
  if (state.task) {
    state.task.stop()
    state.task = null
  }
}
