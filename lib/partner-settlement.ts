import { createHash } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export interface PartnerPOSTxnInput {
  id: string
  txn_id: string
  amount: number
  gross_amount?: number | null
  payment_mode?: string | null
  card_type?: string | null
  card_brand?: string | null
  merchant_slug?: string | null
  partner_id?: string | null
}

/**
 * Resolve which partner owns a POS device.
 * Checks pos_machines (device_serial / serial_number / tid), then
 * partner_pos_machines (terminal_id) — the mapping used by the partner API.
 */
export async function resolvePartnerIdForDevice(
  deviceSerial: string | null,
  tid: string | null
): Promise<string | null> {
  const supabase = getSupabaseAdmin()

  if (deviceSerial) {
    const { data } = await supabase
      .from('pos_machines')
      .select('partner_id')
      .or(`device_serial.eq.${deviceSerial},serial_number.eq.${deviceSerial}`)
      .not('partner_id', 'is', null)
      .limit(1)
      .maybeSingle()
    if (data?.partner_id) return data.partner_id
  }

  if (tid) {
    const { data } = await supabase
      .from('pos_machines')
      .select('partner_id')
      .eq('tid', tid)
      .not('partner_id', 'is', null)
      .limit(1)
      .maybeSingle()
    if (data?.partner_id) return data.partner_id

    const { data: partnerMachine } = await supabase
      .from('partner_pos_machines')
      .select('partner_id')
      .eq('terminal_id', tid)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()
    if (partnerMachine?.partner_id) return partnerMachine.partner_id
  }

  return null
}

/**
 * Attach the owning partner to a captured POS transaction and, if the
 * partner's settlement mode is INSTANT, credit their wallet immediately at
 * T+0 MDR. Provider-agnostic: called from the Razorpay, Pine Labs and Paytm
 * webhooks and the Pine Labs sync cron.
 *
 * Safe to call repeatedly for the same transaction (webhook retries, sync
 * re-runs): partner_id is only written when missing, and instant settlement
 * claims transactions atomically.
 */
export async function attachPartnerAndMaybeInstantSettle(
  txn: PartnerPOSTxnInput,
  deviceSerial: string | null,
  tid: string | null,
  resolveCache?: Map<string, string | null>
): Promise<{ partnerId: string | null; instantSettled: boolean }> {
  const supabase = getSupabaseAdmin()

  let partnerId = txn.partner_id || null
  if (!partnerId) {
    const cacheKey = `${deviceSerial || ''}|${tid || ''}`
    if (resolveCache && resolveCache.has(cacheKey)) {
      partnerId = resolveCache.get(cacheKey) || null
    } else {
      partnerId = await resolvePartnerIdForDevice(deviceSerial, tid)
      resolveCache?.set(cacheKey, partnerId)
    }
    if (!partnerId) return { partnerId: null, instantSettled: false }

    const attachUpdate: Record<string, any> = { partner_id: partnerId }
    if (!txn.gross_amount && txn.amount > 0) attachUpdate.gross_amount = txn.amount

    const { error: attachError } = await supabase
      .from('razorpay_pos_transactions')
      .update(attachUpdate)
      .eq('id', txn.id)
      .is('partner_id', null)

    if (attachError) {
      console.error(`[Partner Attach] Failed to attach partner ${partnerId} to txn ${txn.txn_id}:`, attachError)
      return { partnerId: null, instantSettled: false }
    }
  }

  try {
    const { data: partnerRow } = await supabase
      .from('partners')
      .select('settlement_mode_allowed, t1_settlement_paused, status')
      .eq('id', partnerId)
      .maybeSingle()

    if (
      partnerRow?.settlement_mode_allowed === 'INSTANT' &&
      !partnerRow.t1_settlement_paused &&
      partnerRow.status === 'active'
    ) {
      const result = await settlePartnerTransactionsT0(partnerId, [txn], 'PARTNER-INSTANT')
      if (result.success) {
        console.log(`[Partner Instant] txn ${txn.txn_id} → partner ${partnerId}, net ₹${result.net.toFixed(2)}`)
        return { partnerId, instantSettled: true }
      }
      // Not fatal: transaction stays pending and settles via T+1 cron
      console.warn(`[Partner Instant] Instant settlement skipped/failed for txn ${txn.txn_id}: ${result.error}`)
    }
  } catch (err: any) {
    console.error(`[Partner Instant] Error for txn ${txn.txn_id}:`, err)
  }

  return { partnerId, instantSettled: false }
}

export interface PartnerT0SettleResult {
  success: boolean
  settled: number
  failed: number
  gross: number
  mdr: number
  net: number
  wallet_credit_id: string | null
  error?: string
  failure_reasons?: string[]
}

/**
 * Settle POS transactions to a partner wallet at T+0 MDR rates.
 *
 * Used by:
 * - Razorpay webhook (INSTANT mode: auto credit per captured transaction)
 * - Pulse Pay API (T0_T1 mode: partner manually settles selected transactions)
 *
 * Idempotent: transactions are atomically claimed via partner_wallet_credited,
 * and the deterministic wallet reference is blocked by the unique index on
 * partner_wallet_ledger if a duplicate credit is ever attempted.
 */
export async function settlePartnerTransactionsT0(
  partnerId: string,
  transactions: any[],
  referencePrefix: 'PARTNER-INSTANT' | 'PARTNER-PULSEPAY'
): Promise<PartnerT0SettleResult> {
  const result: PartnerT0SettleResult = {
    success: false,
    settled: 0,
    failed: 0,
    gross: 0,
    mdr: 0,
    net: 0,
    wallet_credit_id: null,
  }

  if (!partnerId || transactions.length === 0) {
    result.error = 'No transactions to settle'
    return result
  }

  const supabase = getSupabaseAdmin()
  const { calculatePartnerMDR, creditPartnerWallet } = await import('@/lib/mdr-scheme/settlement.service')

  const failureReasons: string[] = []
  const processedTxns: Array<{ id: string; txn_id: string; amount: number; mdrAmount: number; netAmount: number }> = []

  for (const txn of transactions) {
    const grossAmount = parseFloat(txn.gross_amount || txn.amount || '0')
    if (grossAmount <= 0) {
      result.failed++
      failureReasons.push(`${txn.txn_id}: zero or negative amount`)
      continue
    }

    try {
      const mdrResult = await calculatePartnerMDR(
        partnerId,
        grossAmount,
        'T0',
        txn.payment_mode || 'CARD',
        txn.card_type,
        txn.card_brand,
        txn.merchant_slug || null
      )

      if (!mdrResult.success) {
        result.failed++
        failureReasons.push(`${txn.txn_id}: ${mdrResult.error || 'MDR calculation failed'}`)
        console.warn(`[Partner T0] MDR calc failed for partner ${partnerId}, txn ${txn.txn_id}: ${mdrResult.error}`)
        continue
      }

      processedTxns.push({
        id: txn.id,
        txn_id: txn.txn_id,
        amount: grossAmount,
        mdrAmount: mdrResult.partner_fee || 0,
        netAmount: mdrResult.partner_settlement_amount || 0,
      })
    } catch (err: any) {
      result.failed++
      failureReasons.push(`${txn.txn_id}: ${err.message}`)
      console.error(`[Partner T0] Error calculating MDR for txn ${txn.txn_id}:`, err)
    }
  }

  if (processedTxns.length === 0) {
    result.error = failureReasons.join('; ') || 'No settleable transactions'
    result.failure_reasons = failureReasons
    return result
  }

  // STEP 1 — Atomically claim: only rows still partner_wallet_credited=false
  // are claimed; a concurrent process (webhook retry, cron) claims 0 and stops.
  const txnIds = processedTxns.map(t => t.id)
  const { data: claimedRows, error: claimError } = await supabase
    .from('razorpay_pos_transactions')
    .update({ partner_wallet_credited: true })
    .in('id', txnIds)
    .eq('partner_wallet_credited', false)
    .select('id')

  if (claimError) {
    console.error(`[Partner T0] Failed to claim txns for partner ${partnerId}:`, claimError)
    result.failed += processedTxns.length
    result.error = 'Failed to claim transactions'
    result.failure_reasons = failureReasons
    return result
  }

  const claimedIds = new Set((claimedRows || []).map((r: any) => r.id))
  if (claimedIds.size === 0) {
    result.error = 'Transactions already settled or being settled by another process'
    result.failure_reasons = failureReasons
    return result
  }

  const claimedTxns = processedTxns.filter(t => claimedIds.has(t.id))
  const claimedGross = claimedTxns.reduce((s, t) => s + t.amount, 0)
  const claimedMdr = claimedTxns.reduce((s, t) => s + t.mdrAmount, 0)
  const claimedNet = claimedTxns.reduce((s, t) => s + t.netAmount, 0)

  // STEP 2 — Deterministic reference over the claimed txn IDs; the unique
  // index on partner_wallet_ledger blocks any second credit for this batch.
  const settleDate = new Date().toISOString().split('T')[0]
  const batchHash = createHash('sha256')
    .update([...claimedIds].sort().join(','))
    .digest('hex')
    .slice(0, 12)
  const referenceId = `${referencePrefix}-${settleDate}-${partnerId}-${batchHash}`

  const label = referencePrefix === 'PARTNER-INSTANT' ? 'Instant Settlement' : 'Pulse Pay T+0 Settlement'
  const walletResult = await creditPartnerWallet(
    partnerId,
    claimedNet,
    referenceId,
    `${label} - ${claimedTxns.length} txn(s), Gross: ₹${claimedGross.toFixed(2)}, MDR: ₹${claimedMdr.toFixed(2)}, Net: ₹${claimedNet.toFixed(2)}`
  )

  if (!walletResult.success) {
    const isDuplicate = /duplicate/i.test(walletResult.error || '')
    if (isDuplicate) {
      console.warn(`[Partner T0] Partner ${partnerId}: batch ${referenceId} already credited, keeping marks.`)
      result.success = true
      result.settled = claimedTxns.length
      result.gross = claimedGross
      result.mdr = claimedMdr
      result.net = claimedNet
      return result
    }

    console.error(`[Partner T0] Wallet credit failed for partner ${partnerId}:`, walletResult.error)
    // Release the claim so these txns can be retried (Pulse Pay or T+1 cron)
    await supabase
      .from('razorpay_pos_transactions')
      .update({ partner_wallet_credited: false })
      .in('id', [...claimedIds])
      .is('partner_wallet_credit_id', null)

    result.failed += claimedTxns.length
    result.error = walletResult.error || 'Wallet credit failed'
    result.failure_reasons = failureReasons
    return result
  }

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

  console.log(
    `[Partner T0] Partner ${partnerId}: ${claimedTxns.length} settled via ${referencePrefix}, net: ₹${claimedNet.toFixed(2)} (ref: ${referenceId})`
  )

  result.success = true
  result.settled = claimedTxns.length
  result.gross = claimedGross
  result.mdr = claimedMdr
  result.net = claimedNet
  result.wallet_credit_id = walletResult.wallet_credit_id || null
  if (failureReasons.length > 0) result.failure_reasons = failureReasons
  return result
}
