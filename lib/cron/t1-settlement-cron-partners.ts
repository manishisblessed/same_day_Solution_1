import { createHash } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

// Partner T+1 settlement runs as part of the main T+1 settlement cron
// (lib/cron/t1-settlement-cron.ts). Partners are opt-in: every partner starts
// with t1_settlement_paused = true and must be resumed from the admin
// Settlement > Partners tab before any auto settlement happens.

let isRunning = false

/**
 * Credit the Master Channel Partner (MCP) override for a batch of just-settled
 * POS transactions belonging to one child partner.
 *
 * POS-only: this runs solely inside the partner POS T+1 settlement. The override
 * is a % of each transaction, read from the child partner's Partner Plan MDR rate
 * (scheme_mdr_rates.master_commission_percent) that matches the txn, and is capped
 * at the company's own margin (the partner MDR fee) on each transaction so company
 * earnings never go negative. The per-rate TDS % is then withheld and the NET is
 * credited into the master partner's SAME partner_wallets balance.
 *
 * Idempotent: deterministic batch reference + per-transaction commit flags.
 * Never throws — logs and returns on any error so partner settlement is unaffected.
 */
async function creditMasterPartnerOverride(
  supabase: any,
  partnerId: string,
  settleDate: string,
  batchHash: string,
  claimedTxns: any[],
  sourceTxns: any[],
  creditPartnerWallet: (
    partnerId: string,
    amount: number,
    referenceId: string,
    description: string,
    serviceType?: string
  ) => Promise<{ success: boolean; wallet_credit_id?: string; error?: string }>
): Promise<void> {
  try {
    // Active link to a master partner (commission now lives on the MDR rate,
    // so no scheme is needed on the assignment).
    const { data: assignment } = await supabase
      .from('master_partner_partner_assignments')
      .select('master_partner_id, status')
      .eq('partner_id', partnerId)
      .eq('status', 'active')
      .maybeSingle()

    const masterPartnerId = assignment?.master_partner_id
    if (!assignment || !masterPartnerId) return

    // Resolve the child partner's Partner Plan scheme and load its MDR rates that
    // carry a master commission. The override % + TDS come from the rate that
    // matches each transaction (by mode + merchant), mirroring MDR resolution.
    const { data: schemeResult } = await supabase.rpc('resolve_scheme_for_user', {
      p_user_id: partnerId,
      p_user_role: 'partner',
      p_service_type: 'mdr',
      p_distributor_id: null,
      p_md_id: null,
    })
    const resolvedSchemeId = schemeResult && schemeResult.length > 0 ? schemeResult[0].scheme_id : null
    if (!resolvedSchemeId) return

    const { data: rateRows } = await supabase
      .from('scheme_mdr_rates')
      .select('mode, merchant_slug, master_commission_percent, master_commission_tds_percent')
      .eq('scheme_id', resolvedSchemeId)
      .eq('status', 'active')
      .not('master_commission_percent', 'is', null)

    type McpRate = { mode: string; merchant: string | null; percent: number; tds: number }
    const rates: McpRate[] = (rateRows || []).map((r: any) => ({
      mode: String(r.mode || 'CARD').toUpperCase(),
      merchant: r.merchant_slug || null,
      percent: Number(r.master_commission_percent) || 0,
      tds: Math.min(100, Math.max(0, Number(r.master_commission_tds_percent ?? 2))),
    }))
    if (rates.length === 0) return

    // Pick the master-commission rate for a txn: match mode, prefer a
    // merchant-specific rate over the ALL-merchant (null) rate.
    const pickRate = (mode: string, merchant: string | null): McpRate | null => {
      const m = rates.filter((r) => r.mode === mode)
      if (m.length === 0) return null
      return m.find((r) => r.merchant && r.merchant === merchant) || m.find((r) => !r.merchant) || m[0]
    }

    let overrideTotal = 0
    let tdsTotal = 0
    const perTxn: { id: string; commission: number; tds: number }[] = []
    for (const item of claimedTxns) {
      const src = sourceTxns.find((t: any) => t.id === item.id)
      const amt = Number(src?.amount || 0)
      const mode = String(src?.payment_mode || 'CARD').toUpperCase().includes('UPI') ? 'UPI' : 'CARD'
      const rate = pickRate(mode, src?.merchant_slug || null)
      if (!rate || rate.percent <= 0 || amt <= 0) continue

      let gross = (amt * rate.percent) / 100
      // Safety cap: never exceed the company's margin (partner MDR fee) on this txn.
      const companyMargin = Number(item.mdrAmount || 0)
      if (gross > companyMargin) gross = companyMargin
      gross = Math.round(gross * 100) / 100
      // Withhold TDS on the gross commission; credit the net to the master wallet.
      const tds = Math.round(((gross * rate.tds) / 100) * 100) / 100
      const commission = Math.round((gross - tds) * 100) / 100
      if (commission > 0) {
        overrideTotal += commission
        tdsTotal += tds
        perTxn.push({ id: item.id, commission, tds })
      }
    }
    overrideTotal = Math.round(overrideTotal * 100) / 100
    tdsTotal = Math.round(tdsTotal * 100) / 100
    if (overrideTotal <= 0 || perTxn.length === 0) return

    const overrideRef = `MCP-T1-${settleDate}-${masterPartnerId}-${batchHash}`
    const mcpResult = await creditPartnerWallet(
      masterPartnerId,
      overrideTotal,
      overrideRef,
      `Master Channel Partner POS override - ${perTxn.length} txn(s) from partner ${partnerId}, Net: ₹${overrideTotal.toFixed(2)} (TDS: ₹${tdsTotal.toFixed(2)})`,
      'pos_master_override'
    )

    const isDuplicate = /duplicate/i.test(mcpResult.error || '')
    if (mcpResult.success || isDuplicate) {
      for (const p of perTxn) {
        await supabase
          .from('razorpay_pos_transactions')
          .update({
            master_partner_commission_credited: true,
            master_partner_commission_id: mcpResult.wallet_credit_id || null,
            master_partner_commission_amount: p.commission,
            master_partner_commission_tds: p.tds,
          })
          .eq('id', p.id)
          .eq('master_partner_commission_credited', false)
      }
      console.log(
        `[Partner T1-Cron] MCP override for master ${masterPartnerId}: net ₹${overrideTotal.toFixed(2)} (TDS ₹${tdsTotal.toFixed(2)}) over ${perTxn.length} txn(s) (ref: ${overrideRef})`
      )
    } else {
      console.error(
        `[Partner T1-Cron] MCP override credit failed for partner ${partnerId} → master ${masterPartnerId}:`,
        mcpResult.error
      )
    }
  } catch (err: any) {
    console.error(`[Partner T1-Cron] MCP override error for partner ${partnerId}:`, err?.message)
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

export async function runPartnerT1Settlement(): Promise<{ processed: number; failed: number }> {
  if (isRunning) {
    console.log('[Partner T1-Cron] Settlement already running, skipping...')
    return { processed: 0, failed: 0 }
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
    const { validatePartnerTxnForSettlement } = await import('@/lib/partner-settlement')
    const { raiseSettlementAlert, resolveSettlementAlerts } = await import('@/lib/settlement-alerts')

    const beforeDate = new Date(new Date().setHours(0, 0, 0, 0))
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
          // Status / refund / amount gate before any payout.
          const gate = validatePartnerTxnForSettlement(txn)
          if (!gate.ok) {
            console.warn(`[Partner T1-Cron] Skipping txn ${txn.txn_id} for partner ${partnerId}: ${gate.reason}`)
            totalFailed++
            await raiseSettlementAlert(supabase, {
              partnerId, txnId: txn.txn_id, amount: parseFloat(String(txn.gross_amount ?? txn.amount ?? '0')),
              reason: gate.reason!, alertType: 'PARTNER_TXN_NOT_SETTLEABLE',
            })
            continue
          }

          try {
            const mdrResult = await calculatePartnerMDR(
              partnerId,
              txn.amount,
              'T1',
              txn.payment_mode || 'CARD',
              txn.card_type,
              txn.card_brand,
              txn.merchant_slug || null
            )

            if (!mdrResult.success) {
              console.warn(
                `[Partner T1-Cron] MDR calculation failed for partner ${partnerId}, txn ${txn.txn_id}: ${mdrResult.error}`
              )
              totalFailed++
              await raiseSettlementAlert(supabase, {
                partnerId, txnId: txn.txn_id, amount: parseFloat(String(txn.amount ?? '0')),
                reason: mdrResult.error || 'MDR calculation failed', alertType: 'PARTNER_MDR_RATE_MISSING',
              })
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

        // Settle EACH transaction as its own wallet credit (one ledger entry per
        // transaction), rather than a single batched credit. Every txn is claimed
        // and credited independently and idempotently via a deterministic per-txn
        // reference (the unique index on partner_wallet_ledger blocks any dupe).
        if (partnerSuccessCount > 0) {
          const settleDate = new Date().toISOString().split('T')[0]

          for (const item of processedTxns) {
            try {
              // STEP 1 — Atomically CLAIM just this txn. A concurrent process
              // claims 0 rows and this iteration stops.
              const { data: claimedRows, error: claimError } = await supabase
                .from('razorpay_pos_transactions')
                .update({ partner_wallet_credited: true })
                .eq('id', item.id)
                .eq('partner_wallet_credited', false)
                .select('id')

              if (claimError) {
                console.error(`[Partner T1-Cron] Failed to claim txn ${item.txn_id} for partner ${partnerId}:`, claimError)
                totalFailed++
                continue
              }
              if (!claimedRows || claimedRows.length === 0) {
                console.warn(`[Partner T1-Cron] Txn ${item.txn_id}: already claimed by another process, skipping.`)
                continue
              }

              const src = transactions.find(t => t.id === item.id)
              const gross = Number(src?.amount || 0)
              const net = Number(item.netAmount || 0)
              const mdr = Number(item.mdrAmount || 0)

              // STEP 2 — Deterministic PER-TXN reference (idempotent per txn).
              const txnHash = createHash('sha256').update(String(item.id)).digest('hex').slice(0, 12)
              const referenceId = `PARTNER-T1-${settleDate}-${partnerId}-${txnHash}`

              const walletResult = await creditPartnerWallet(
                partnerId,
                net,
                referenceId,
                `T+1 Auto Settlement - txn ${item.txn_id}, Gross: ₹${gross.toFixed(2)}, MDR: ₹${mdr.toFixed(2)}, Net: ₹${net.toFixed(2)}`
              )

              if (!walletResult.success) {
                const isDuplicate = /duplicate/i.test(walletResult.error || '')
                if (isDuplicate) {
                  console.warn(`[Partner T1-Cron] Txn ${item.txn_id}: ${referenceId} already credited, keeping mark.`)
                  continue
                }
                console.error(`[Partner T1-Cron] Wallet credit failed for txn ${item.txn_id}:`, walletResult.error)
                // Release the claim so this txn can be retried next run.
                await supabase
                  .from('razorpay_pos_transactions')
                  .update({ partner_wallet_credited: false })
                  .eq('id', item.id)
                  .is('partner_wallet_credit_id', null)
                totalFailed++
                continue
              }

              await supabase
                .from('razorpay_pos_transactions')
                .update({
                  partner_wallet_credit_id: walletResult.wallet_credit_id,
                  partner_mdr_amount: item.mdrAmount,
                  partner_net_amount: item.netAmount,
                  partner_auto_settled_at: new Date().toISOString(),
                })
                .eq('id', item.id)

              await resolveSettlementAlerts(supabase, [item.txn_id], 'partner-t1-settled')

              // --- Master Channel Partner override (POS ONLY) --- per txn,
              // idempotent via the per-txn hash in its reference.
              await creditMasterPartnerOverride(
                supabase,
                partnerId,
                settleDate,
                txnHash,
                [item],
                transactions,
                creditPartnerWallet
              )

              totalProcessed++
              console.log(
                `[Partner T1-Cron] Partner ${partnerId}: txn ${item.txn_id} settled, net ₹${net.toFixed(2)} (ref: ${referenceId})`
              )
            } catch (err: any) {
              console.error(`[Partner T1-Cron] Error settling txn ${item.txn_id} for partner ${partnerId}:`, err)
              totalFailed++
            }
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

  return { processed: totalProcessed, failed: totalFailed }
}
