import cron, { ScheduledTask } from 'node-cron'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

interface CronSettings {
  id: string
  schedule_hour: number
  schedule_minute: number
  timezone: string
  is_enabled: boolean
}

let currentTask: ScheduledTask | null = null
let settingsPollingInterval: ReturnType<typeof setInterval> | null = null
let lastCronExpression = ''
let isRunning = false

function toCronExpression(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`
}

async function getSettings(): Promise<CronSettings | null> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('t1_cron_settings')
      .select('*')
      .limit(1)
      .single()

    if (error || !data) {
      console.error('[T1-Cron] Failed to fetch settings:', error?.message)
      return null
    }
    return data as CronSettings
  } catch (err: any) {
    console.error('[T1-Cron] Error fetching settings:', err.message)
    return null
  }
}

async function updateRunStatus(
  status: 'success' | 'partial' | 'failed',
  message: string,
  processed: number,
  failed: number
) {
  try {
    const supabase = getSupabaseAdmin()
    await supabase
      .from('t1_cron_settings')
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: status,
        last_run_message: message,
        last_run_processed: processed,
        last_run_failed: failed,
      })
      .not('id', 'is', null)
  } catch (err: any) {
    console.error('[T1-Cron] Error updating run status:', err.message)
  }
}

async function getPausedRetailerIds(): Promise<Set<string>> {
  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('retailers')
      .select('partner_id')
      .eq('t1_settlement_paused', true)
    return new Set((data || []).map((r: any) => r.partner_id))
  } catch {
    return new Set()
  }
}

async function runT1Settlement() {
  if (isRunning) {
    console.log('[T1-Cron] Settlement already running, skipping...')
    return
  }

  isRunning = true
  console.log(`[T1-Cron] === T+1 Settlement started at ${new Date().toISOString()} ===`)

  let totalProcessed = 0
  let totalFailed = 0

  try {
    const supabase = getSupabaseAdmin()
    const pausedRetailers = await getPausedRetailerIds()

    if (pausedRetailers.size > 0) {
      console.log(`[T1-Cron] ${pausedRetailers.size} retailer(s) paused, will be skipped.`)
    }

    const cutoffDate = new Date(new Date().setHours(0, 0, 0, 0))

    // --- Part 1: POS Auto-Settle T+1 (same logic as /api/pos/auto-settle-t1) ---
    const { calculateMDR: calculateSchemeMDR } = await import('@/lib/mdr-scheme/settlement.service')

    const { data: unsettled, error: fetchError } = await supabase
      .from('razorpay_pos_transactions')
      .select('*')
      .or('display_status.ilike.SUCCESS,display_status.ilike.CAPTURED')
      .eq('wallet_credited', false)
      .is('settlement_mode', null)
      .not('retailer_id', 'is', null)
      .lt('transaction_time', cutoffDate.toISOString())
      .order('transaction_time', { ascending: true })
      .limit(500)

    if (fetchError) {
      console.error('[T1-Cron] Error fetching POS transactions:', fetchError)
    }

    if (unsettled && unsettled.length > 0) {
      console.log(`[T1-Cron] Found ${unsettled.length} unsettled POS transactions`)

      const retailerGroups: Record<string, typeof unsettled> = {}
      for (const txn of unsettled) {
        const rid = txn.retailer_id
        if (!rid) continue
        if (pausedRetailers.has(rid)) {
          console.log(`[T1-Cron] Skipping paused retailer: ${rid}`)
          continue
        }
        if (!retailerGroups[rid]) retailerGroups[rid] = []
        retailerGroups[rid].push(txn)
      }

      for (const [retailerId, transactions] of Object.entries(retailerGroups)) {
        const { data: retailerData } = await supabase
          .from('retailers')
          .select('distributor_id, master_distributor_id')
          .eq('partner_id', retailerId)
          .maybeSingle()

        const distributorId = retailerData?.distributor_id || null

        let retailerGross = 0
        let retailerMdr = 0
        let retailerNet = 0
        let retailerSuccessCount = 0
        const processedTxns: Array<{
          txn: any
          mdrRate: number
          mdrAmount: number
          netAmount: number
          schemeId: string | null
          schemeType: string | null
        }> = []

        for (const txn of transactions) {
          const grossAmount = parseFloat(txn.gross_amount || txn.amount || '0')
          if (grossAmount <= 0) {
            totalFailed++
            continue
          }

          const paymentMode = (txn.payment_mode || 'CARD').toUpperCase()
          const mdrResult = await calculateSchemeMDR({
            amount: grossAmount,
            settlement_type: 'T1' as any,
            mode: paymentMode.includes('UPI') ? ('UPI' as const) : ('CARD' as const),
            card_type: txn.card_type?.toUpperCase() || null,
            brand_type: txn.card_brand || null,
            card_classification: txn.card_classification || null,
            retailer_id: retailerId,
            distributor_id: distributorId,
          })

          if (mdrResult.success && mdrResult.result) {
            retailerGross += grossAmount
            retailerMdr += mdrResult.result.retailer_fee
            retailerNet += mdrResult.result.retailer_settlement_amount
            retailerSuccessCount++
            processedTxns.push({
              txn,
              mdrRate: mdrResult.result.retailer_mdr,
              mdrAmount: mdrResult.result.retailer_fee,
              netAmount: mdrResult.result.retailer_settlement_amount,
              schemeId: mdrResult.result.scheme_id || null,
              schemeType: mdrResult.result.scheme_type || null,
            })
          } else {
            totalFailed++
            console.warn(`[T1-Cron] MDR calc failed for txn ${txn.txn_id}: ${mdrResult.error}`)
          }
        }

        if (retailerNet > 0 && processedTxns.length > 0) {
          try {
            const { data: ledgerId, error: ledgerError } = await supabase.rpc('add_ledger_entry', {
              p_user_id: retailerId,
              p_user_role: 'retailer',
              p_wallet_type: 'primary',
              p_fund_category: 'online',
              p_service_type: 'pos',
              p_tx_type: 'POS_CREDIT',
              p_credit: retailerNet,
              p_debit: 0,
              p_reference_id: `AUTO-T1-${new Date().toISOString().split('T')[0]}`,
              p_transaction_id: null,
              p_status: 'completed',
              p_remarks: `T+1 Auto Settlement - ${retailerSuccessCount} txn(s), Gross: ₹${retailerGross.toFixed(2)}, MDR: ₹${retailerMdr.toFixed(2)}, Net: ₹${retailerNet.toFixed(2)}`,
            })

            if (ledgerError) {
              console.error(`[T1-Cron] Wallet credit error for retailer ${retailerId}:`, ledgerError)
              totalFailed += processedTxns.length
              continue
            }

            for (const item of processedTxns) {
              await supabase
                .from('razorpay_pos_transactions')
                .update({
                  wallet_credited: true,
                  wallet_credit_id: ledgerId,
                  settlement_mode: 'AUTO_T1',
                  mdr_rate: item.mdrRate,
                  mdr_amount: item.mdrAmount,
                  net_amount: item.netAmount,
                  mdr_scheme_id: item.schemeId,
                  mdr_scheme_type: item.schemeType,
                  auto_settled_at: new Date().toISOString(),
                })
                .eq('id', item.txn.id)
            }

            totalProcessed += retailerSuccessCount
            console.log(`[T1-Cron] POS: Retailer ${retailerId}: ${retailerSuccessCount} settled, net: ₹${retailerNet.toFixed(2)}`)
          } catch (err: any) {
            console.error(`[T1-Cron] Error processing retailer ${retailerId}:`, err)
            totalFailed += processedTxns.length
          }
        }
      }
    } else {
      console.log('[T1-Cron] No unsettled POS transactions found.')
    }

    // --- Part 2: MDR Scheme T+1 (same logic as /api/settlement/run-t1) ---
    const { getPendingT1Transactions, processSettlement } = await import(
      '@/lib/mdr-scheme/settlement.service'
    )

    const beforeDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const pendingTransactions = await getPendingT1Transactions(beforeDate)

    if (pendingTransactions.length > 0) {
      console.log(`[T1-Cron] Found ${pendingTransactions.length} pending MDR T+1 transactions`)

      for (const transaction of pendingTransactions) {
        if (pausedRetailers.has(transaction.retailer_id)) {
          console.log(`[T1-Cron] Skipping paused retailer: ${transaction.retailer_id}`)
          continue
        }

        try {
          const result = await processSettlement(transaction)
          if (result.success) {
            totalProcessed++
            console.log(`[T1-Cron] MDR: Processed ${transaction.razorpay_payment_id}`)
          } else {
            totalFailed++
            console.error(`[T1-Cron] MDR: Failed ${transaction.razorpay_payment_id}: ${result.error}`)
          }
        } catch (err: any) {
          totalFailed++
          console.error(`[T1-Cron] MDR: Error ${transaction.razorpay_payment_id}: ${err.message}`)
        }
      }
    } else {
      console.log('[T1-Cron] No pending MDR T+1 transactions found.')
    }

    const status = totalFailed === 0 ? 'success' : totalProcessed > 0 ? 'partial' : 'failed'
    const message = `Processed: ${totalProcessed}, Failed: ${totalFailed}`
    await updateRunStatus(status, message, totalProcessed, totalFailed)

    console.log(`[T1-Cron] === T+1 Settlement complete: ${message} ===`)
  } catch (err: any) {
    console.error('[T1-Cron] Fatal error during settlement:', err)
    await updateRunStatus('failed', err.message || 'Unknown error', totalProcessed, totalFailed)
  } finally {
    isRunning = false
  }
}

function scheduleTask(cronExpr: string, timezone: string) {
  if (currentTask) {
    currentTask.stop()
    currentTask = null
  }

  currentTask = cron.schedule(cronExpr, runT1Settlement, {
    timezone,
  })

  lastCronExpression = cronExpr
  console.log(`[T1-Cron] Scheduled at cron expression: ${cronExpr} (${timezone})`)
}

async function syncSchedule() {
  const settings = await getSettings()
  if (!settings) return

  if (!settings.is_enabled) {
    if (currentTask) {
      currentTask.stop()
      currentTask = null
      lastCronExpression = ''
      console.log('[T1-Cron] Disabled by admin — cron stopped.')
    }
    return
  }

  const newCron = toCronExpression(settings.schedule_hour, settings.schedule_minute)
  if (newCron !== lastCronExpression) {
    scheduleTask(newCron, settings.timezone)
  }
}

export async function initT1SettlementCron() {
  console.log('[T1-Cron] Initializing T+1 Settlement Cron...')

  await syncSchedule()

  // Poll for settings changes every 60 seconds
  settingsPollingInterval = setInterval(syncSchedule, 60_000)

  console.log('[T1-Cron] Initialization complete. Polling for settings changes every 60s.')
}

export async function triggerManualRun(): Promise<{
  success: boolean
  message: string
  processed: number
  failed: number
}> {
  if (isRunning) {
    return { success: false, message: 'Settlement is already running', processed: 0, failed: 0 }
  }

  await runT1Settlement()

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('t1_cron_settings')
    .select('last_run_processed, last_run_failed, last_run_message')
    .limit(1)
    .single()

  return {
    success: true,
    message: data?.last_run_message || 'Settlement completed',
    processed: data?.last_run_processed || 0,
    failed: data?.last_run_failed || 0,
  }
}

export function getIsRunning(): boolean {
  return isRunning
}

export function stopCron() {
  if (currentTask) {
    currentTask.stop()
    currentTask = null
  }
  if (settingsPollingInterval) {
    clearInterval(settingsPollingInterval)
    settingsPollingInterval = null
  }
  lastCronExpression = ''
  console.log('[T1-Cron] Stopped.')
}
