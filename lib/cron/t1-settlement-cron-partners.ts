import cron, { ScheduledTask } from 'node-cron'
import { createHash } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

interface PartnerCronSettings {
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

async function getSettings(): Promise<PartnerCronSettings | null> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('partner_t1_cron_settings')
      .select('*')
      .limit(1)
      .single()

    if (error || !data) {
      console.error('[Partner T1-Cron] Failed to fetch settings:', error?.message)
      return null
    }
    return data as PartnerCronSettings
  } catch (err: any) {
    console.error('[Partner T1-Cron] Error fetching settings:', err.message)
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
      .from('partner_t1_cron_settings')
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: status,
        last_run_message: message,
        last_run_processed: processed,
        last_run_failed: failed,
      })
      .not('id', 'is', null)
  } catch (err: any) {
    console.error('[Partner T1-Cron] Error updating run status:', err.message)
  }
}

async function runPartnerT1Settlement() {
  if (isRunning) {
    console.log('[Partner T1-Cron] Settlement already running, skipping...')
    return
  }

  isRunning = true
  console.log(`[Partner T1-Cron] === Partner T+1 Settlement started at ${new Date().toISOString()} ===`)

  let totalProcessed = 0
  let totalFailed = 0

  try {
    const supabase = getSupabaseAdmin()

    // Get pending partner T+1 transactions
    const { getPendingPartnerT1Transactions, calculatePartnerMDR, creditPartnerWallet } = await import(
      '@/lib/mdr-scheme/settlement.service'
    )

    const beforeDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const pendingTransactions = await getPendingPartnerT1Transactions(beforeDate)

    if (pendingTransactions.length > 0) {
      console.log(`[Partner T1-Cron] Found ${pendingTransactions.length} pending partner T+1 transactions`)

      // Group transactions by partner for batch processing
      const transactionsByPartner = new Map<string, any[]>()
      
      for (const txn of pendingTransactions) {
        const partnerId = txn.partner_id
        if (!transactionsByPartner.has(partnerId)) {
          transactionsByPartner.set(partnerId, [])
        }
        transactionsByPartner.get(partnerId)!.push(txn)
      }

      console.log(`[Partner T1-Cron] Processing ${transactionsByPartner.size} partner(s)`)

      // Process each partner
      for (const [partnerId, transactions] of transactionsByPartner) {
        console.log(`[Partner T1-Cron] Partner ${partnerId}: Processing ${transactions.length} transaction(s)`)

        let partnerGross = 0
        let partnerMdr = 0
        let partnerNet = 0
        let partnerSuccessCount = 0
        const processedTxns: any[] = []

        // Calculate MDR for each transaction
        for (const txn of transactions) {
          try {
            const mdrResult = await calculatePartnerMDR(
              partnerId,
              txn.amount,
              'T1',
              txn.payment_mode || 'CARD',
              txn.card_type,
              txn.card_brand
            )

            if (!mdrResult.success) {
              console.warn(
                `[Partner T1-Cron] MDR calculation failed for partner ${partnerId}, txn ${txn.txn_id}: ${mdrResult.error}`
              )
              totalFailed++
              continue
            }

            partnerGross += txn.amount
            partnerMdr += mdrResult.partner_fee || 0
            partnerNet += mdrResult.partner_settlement_amount || 0
            partnerSuccessCount++

            processedTxns.push({
              id: txn.id,
              txn_id: txn.txn_id,
              mdrRate: mdrResult.partner_mdr,
              mdrAmount: mdrResult.partner_fee,
              netAmount: mdrResult.partner_settlement_amount,
              schemeId: mdrResult.scheme_id,
            })
          } catch (err: any) {
            console.error(`[Partner T1-Cron] Error calculating MDR for txn ${txn.txn_id}:`, err)
            totalFailed++
          }
        }

        // Credit partner wallet with batch amount
        if (partnerSuccessCount > 0) {
          try {
            // STEP 1 — Atomically CLAIM the transactions. Only rows still
            // partner_wallet_credited=false are claimed; a concurrent process
            // claims 0 rows and stops.
            const txnIds = processedTxns.map(item => item.id)
            const { data: claimedRows, error: claimError } = await supabase
              .from('razorpay_pos_transactions')
              .update({ partner_wallet_credited: true })
              .in('id', txnIds)
              .eq('partner_wallet_credited', false)
              .select('id')

            if (claimError) {
              console.error(`[Partner T1-Cron] Failed to claim txns for partner ${partnerId}:`, claimError)
              totalFailed += partnerSuccessCount
              continue
            }

            const claimedIds = new Set((claimedRows || []).map((r: any) => r.id))
            if (claimedIds.size === 0) {
              console.warn(`[Partner T1-Cron] Partner ${partnerId}: all txns already claimed by another process, skipping.`)
              continue
            }

            // Credit ONLY what we actually claimed
            const claimedTxns = processedTxns.filter(item => claimedIds.has(item.id))
            const claimedGross = claimedTxns.reduce((s, i: any) => {
              const src = transactions.find(t => t.id === i.id)
              return s + (src?.amount || 0)
            }, 0)
            const claimedMdr = claimedTxns.reduce((s, i) => s + (i.mdrAmount || 0), 0)
            const claimedNet = claimedTxns.reduce((s, i) => s + (i.netAmount || 0), 0)

            // STEP 2 — Deterministic reference over the claimed txn IDs; the DB
            // unique index on partner_wallet_ledger blocks any second credit.
            const settleDate = new Date().toISOString().split('T')[0]
            const batchHash = createHash('sha256')
              .update([...claimedIds].sort().join(','))
              .digest('hex')
              .slice(0, 12)
            const referenceId = `PARTNER-T1-${settleDate}-${partnerId}-${batchHash}`

            const walletResult = await creditPartnerWallet(
              partnerId,
              claimedNet,
              referenceId,
              `T+1 Auto Settlement - ${claimedTxns.length} txn(s), Gross: ₹${claimedGross.toFixed(2)}, MDR: ₹${claimedMdr.toFixed(2)}, Net: ₹${claimedNet.toFixed(2)}`
            )

            if (!walletResult.success) {
              const isDuplicate = /duplicate/i.test(walletResult.error || '')
              if (isDuplicate) {
                console.warn(`[Partner T1-Cron] Partner ${partnerId}: batch ${referenceId} already credited, keeping marks.`)
                continue
              }
              console.error(
                `[Partner T1-Cron] Wallet credit failed for partner ${partnerId}:`,
                walletResult.error
              )
              // Release the claim so these txns can be retried next run
              await supabase
                .from('razorpay_pos_transactions')
                .update({ partner_wallet_credited: false })
                .in('id', [...claimedIds])
                .is('partner_wallet_credit_id', null)
              totalFailed += claimedTxns.length
              continue
            }

            // Update all transactions with settlement metadata
            for (const item of claimedTxns) {
              await supabase
                .from('razorpay_pos_transactions')
                .update({
                  partner_wallet_credit_id: walletResult.wallet_credit_id,
                  partner_mdr_amount: item.mdrAmount,
                  partner_net_amount: item.netAmount,
                  partner_auto_settled_at: new Date().toISOString(),
                })
                .eq('id', item.id)
            }

            totalProcessed += claimedTxns.length
            console.log(
              `[Partner T1-Cron] Partner ${partnerId}: ${claimedTxns.length} settled, net: ₹${claimedNet.toFixed(2)} (ref: ${referenceId})`
            )
          } catch (err: any) {
            console.error(`[Partner T1-Cron] Error processing partner ${partnerId}:`, err)
            totalFailed += partnerSuccessCount
          }
        }
      }
    } else {
      console.log('[Partner T1-Cron] No pending partner T+1 transactions found.')
    }

    const status = totalFailed === 0 ? 'success' : totalProcessed > 0 ? 'partial' : 'failed'
    const message = `Processed: ${totalProcessed}, Failed: ${totalFailed}`
    await updateRunStatus(status, message, totalProcessed, totalFailed)

    console.log(`[Partner T1-Cron] === Partner T+1 Settlement complete: ${message} ===`)
  } catch (err: any) {
    console.error('[Partner T1-Cron] Fatal error during settlement:', err)
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

  currentTask = cron.schedule(cronExpr, runPartnerT1Settlement, {
    timezone,
  })

  lastCronExpression = cronExpr
  console.log(`[Partner T1-Cron] Scheduled at cron expression: ${cronExpr} (${timezone})`)
}

async function syncSchedule() {
  const settings = await getSettings()
  if (!settings) return

  if (!settings.is_enabled) {
    if (currentTask) {
      currentTask.stop()
      currentTask = null
      lastCronExpression = ''
      console.log('[Partner T1-Cron] Disabled by admin — cron stopped.')
    }
    return
  }

  const newCron = toCronExpression(settings.schedule_hour, settings.schedule_minute)
  if (newCron !== lastCronExpression) {
    scheduleTask(newCron, settings.timezone)
  }
}

export async function initPartnerT1SettlementCron() {
  console.log('[Partner T1-Cron] Initializing Partner T+1 Settlement Cron...')

  await syncSchedule()

  // Poll for settings changes every 60 seconds
  settingsPollingInterval = setInterval(syncSchedule, 60_000)

  console.log('[Partner T1-Cron] Initialization complete. Polling for settings changes every 60s.')
}

export async function triggerPartnerManualRun(): Promise<{
  success: boolean
  message: string
  processed: number
  failed: number
}> {
  if (isRunning) {
    return { success: false, message: 'Settlement is already running', processed: 0, failed: 0 }
  }

  await runPartnerT1Settlement()

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('partner_t1_cron_settings')
    .select('last_run_processed, last_run_failed, last_run_message')
    .limit(1)
    .single()

  return {
    success: true,
    message: data?.last_run_message || 'Manual run completed',
    processed: data?.last_run_processed || 0,
    failed: data?.last_run_failed || 0,
  }
}

export function stopPartnerT1SettlementCron() {
  if (currentTask) {
    currentTask.stop()
    currentTask = null
  }
  if (settingsPollingInterval) {
    clearInterval(settingsPollingInterval)
    settingsPollingInterval = null
  }
  console.log('[Partner T1-Cron] Cron stopped.')
}
