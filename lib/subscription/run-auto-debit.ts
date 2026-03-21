/**
 * Subscription auto-debit — ONLY debits RETAILERS.
 *
 * Flow per retailer subscription due today:
 *   1. Debit retailer wallet: retailer_rate + GST for all active items.
 *   2. Credit subscription revenue wallet (ADMIN_SUB_REVENUE) with full amount.
 *   3. Credit distributor commission (retailer_rate − distributor_rate per item),
 *      and record corresponding debit in revenue wallet.
 *   4. Credit MD commission (distributor_rate − md_rate per item),
 *      and record corresponding debit in revenue wallet.
 *   5. Advance retailer's next_billing_date by 1 month.
 *
 * Revenue wallet statement shows:
 *   - Credit: full amount received from retailer.
 *   - Debit: commission paid to distributor.
 *   - Debit: commission paid to MD.
 *   - Net balance = admin's platform revenue.
 *
 * MD/Distributor subscriptions only advance their billing date (no wallet debit).
 */

import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export interface RunAutoDebitResult {
  processed: number
  completed: number
  failed: number
  commissionsCreated: number
  results: { id: string; user_id: string; status: 'completed' | 'failed'; reason?: string }[]
}

export async function runSubscriptionAutoDebit(): Promise<RunAutoDebitResult> {
  const supabase = getSupabaseAdmin()
  const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const today = `${istNow.getFullYear()}-${String(istNow.getMonth() + 1).padStart(2, '0')}-${String(istNow.getDate()).padStart(2, '0')}`

  console.log(`[AutoDebit] Today (IST): ${today}`)

  // ONLY fetch RETAILER subscriptions that are due
  const { data: dueSubs, error: fetchErr } = await supabase
    .from('subscriptions')
    .select('id, user_id, user_role, monthly_amount, pos_machine_count, billing_day')
    .eq('status', 'active')
    .eq('auto_debit_enabled', true)
    .eq('user_role', 'retailer')
    .lte('next_billing_date', today)
    .gt('monthly_amount', 0)

  if (fetchErr) throw new Error(fetchErr.message)

  console.log(`[AutoDebit] Due retailer subscriptions: ${dueSubs?.length || 0}`)
  for (const s of dueSubs || []) {
    console.log(`  - ${s.user_id} | billing_day: ${s.billing_day} | amount: ₹${s.monthly_amount}`)
  }

  const results: RunAutoDebitResult['results'] = []
  let commissionsCreated = 0

  for (const sub of dueSubs || []) {
    try {
      console.log(`[AutoDebit] Processing retailer: ${sub.user_id}`)
      const outcome = await processRetailerSubscription(supabase, sub)
      results.push({ id: sub.id, user_id: sub.user_id, status: outcome.status, reason: outcome.reason })
      commissionsCreated += outcome.commissionsCreated
      console.log(`[AutoDebit] Result for ${sub.user_id}: ${outcome.status}${outcome.reason ? ' — ' + outcome.reason : ''}, commissions: ${outcome.commissionsCreated}`)
    } catch (err: any) {
      results.push({ id: sub.id, user_id: sub.user_id, status: 'failed', reason: err.message })
      console.error(`[AutoDebit] Error for ${sub.user_id}: ${err.message}`)
    }
  }

  // Also advance billing dates for MD/Distributor subs that are past due (no debit, just advance)
  await advanceNonRetailerBillingDates(supabase, today)

  return {
    processed: results.length,
    completed: results.filter((r) => r.status === 'completed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    commissionsCreated,
    results,
  }
}

/**
 * Advance next_billing_date for MD/Distributor subs that are past due,
 * without debiting or creating any ledger entries.
 */
async function advanceNonRetailerBillingDates(supabase: ReturnType<typeof getSupabaseAdmin>, today: string) {
  const { data: pastDue } = await supabase
    .from('subscriptions')
    .select('id, user_id, user_role, billing_day, next_billing_date')
    .eq('status', 'active')
    .in('user_role', ['master_distributor', 'distributor', 'partner'])
    .lte('next_billing_date', today)

  for (const sub of pastDue || []) {
    const billingDay = sub.billing_day || 1
    const billingDate = new Date(sub.next_billing_date)
    const nextMonth = new Date(billingDate)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const nextStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-${String(billingDay).padStart(2, '0')}`
    await supabase
      .from('subscriptions')
      .update({ next_billing_date: nextStr, updated_at: new Date().toISOString() })
      .eq('id', sub.id)
    console.log(`[AutoDebit] Advanced ${sub.user_role} ${sub.user_id} billing date to ${nextStr} (no debit)`)
  }
}

async function processRetailerSubscription(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  sub: { id: string; user_id: string; user_role: string; monthly_amount: number; pos_machine_count: number; billing_day?: number }
): Promise<{ status: 'completed' | 'failed'; reason?: string; commissionsCreated: number }> {
  const { data: subRow } = await supabase
    .from('subscriptions')
    .select('next_billing_date, billing_day')
    .eq('id', sub.id)
    .single()
  const billingDay = subRow?.billing_day || sub.billing_day || 1
  const billingDate = subRow?.next_billing_date ? new Date(subRow.next_billing_date) : new Date()
  const periodEnd = new Date(billingDate)
  periodEnd.setMonth(periodEnd.getMonth() + 1)
  periodEnd.setDate(periodEnd.getDate() - 1)
  const periodStartStr = billingDate.toISOString().slice(0, 10)
  const periodEndStr = periodEnd.toISOString().slice(0, 10)

  // Load active items for this retailer subscription
  const { data: items } = await supabase
    .from('subscription_items')
    .select('*')
    .eq('subscription_id', sub.id)
    .eq('is_active', true)

  if (!items || items.length === 0) {
    return { status: 'failed', reason: 'No active subscription items', commissionsCreated: 0 }
  }

  // Always use retailer_rate since we only debit retailers
  let baseAmount = 0
  let gstAmount = 0
  for (const it of items) {
    const rate = Number(it.retailer_rate) || 0
    const gstPct = Number(it.gst_percent) || 18
    baseAmount += rate
    gstAmount += rate * gstPct / 100
  }
  const totalAmount = Math.round((baseAmount + gstAmount) * 100) / 100

  if (totalAmount <= 0) {
    return { status: 'failed', reason: 'Calculated amount is zero', commissionsCreated: 0 }
  }

  console.log(`[AutoDebit] ${sub.user_id}: base=₹${baseAmount.toFixed(2)}, GST=₹${gstAmount.toFixed(2)}, total=₹${totalAmount.toFixed(2)}`)

  // Create debit record
  const { data: debitRow, error: insertErr } = await supabase
    .from('subscription_debits')
    .insert({
      subscription_id: sub.id,
      amount: totalAmount,
      base_amount: Math.round(baseAmount * 100) / 100,
      gst_amount: Math.round(gstAmount * 100) / 100,
      item_count: items.length,
      billing_period_start: periodStartStr,
      billing_period_end: periodEndStr,
      pos_machine_count: items.length,
      status: 'pending',
    })
    .select('id')
    .single()
  if (insertErr || !debitRow) {
    return { status: 'failed', reason: insertErr?.message || 'Debit record creation failed', commissionsCreated: 0 }
  }

  // Check retailer balance
  const { data: balanceData } = await supabase.rpc('get_wallet_balance_v2', {
    p_user_id: sub.user_id,
    p_wallet_type: 'primary',
  })
  const balance = Number(balanceData) || 0
  if (balance < totalAmount) {
    await supabase
      .from('subscription_debits')
      .update({
        status: 'insufficient_balance',
        failure_reason: `Balance ₹${balance.toFixed(2)} < required ₹${totalAmount.toFixed(2)}`,
      })
      .eq('id', debitRow.id)
    return { status: 'failed', reason: `Insufficient balance (₹${balance.toFixed(2)} < ₹${totalAmount.toFixed(2)})`, commissionsCreated: 0 }
  }

  // 1. DEBIT retailer wallet
  const { data: ledgerId, error: ledgerErr } = await supabase.rpc('add_ledger_entry', {
    p_user_id: sub.user_id,
    p_user_role: 'retailer',
    p_wallet_type: 'primary',
    p_fund_category: 'other',
    p_service_type: 'subscription',
    p_tx_type: 'SUBSCRIPTION_DEBIT',
    p_credit: 0,
    p_debit: totalAmount,
    p_reference_id: `SUB_${debitRow.id}`,
    p_transaction_id: debitRow.id,
    p_status: 'completed',
    p_remarks: `POS rental debit - ${items.length} machine(s) - ₹${baseAmount.toFixed(2)} + GST ₹${gstAmount.toFixed(2)} (${periodStartStr} to ${periodEndStr})`,
  })

  if (ledgerErr) {
    await supabase
      .from('subscription_debits')
      .update({ status: 'failed', failure_reason: ledgerErr.message })
      .eq('id', debitRow.id)
    return { status: 'failed', reason: ledgerErr.message, commissionsCreated: 0 }
  }

  // Mark debit completed
  await supabase
    .from('subscription_debits')
    .update({ status: 'completed', ledger_id: ledgerId, completed_at: new Date().toISOString() })
    .eq('id', debitRow.id)

  // 2. CREDIT subscription revenue wallet (platform revenue)
  const revenueUserId = process.env.SUBSCRIPTION_REVENUE_USER_ID
  const revenueUserRole = process.env.SUBSCRIPTION_REVENUE_USER_ROLE || 'master_distributor'
  const revenueConfigured = revenueUserId && ['retailer', 'distributor', 'master_distributor'].includes(revenueUserRole)
  if (revenueConfigured) {
    try {
      await supabase.rpc('add_ledger_entry', {
        p_user_id: revenueUserId,
        p_user_role: revenueUserRole,
        p_wallet_type: 'primary',
        p_fund_category: 'other',
        p_service_type: 'subscription',
        p_tx_type: 'SUBSCRIPTION_REVENUE',
        p_credit: totalAmount,
        p_debit: 0,
        p_reference_id: `SUB_REV_${debitRow.id}`,
        p_transaction_id: debitRow.id,
        p_status: 'completed',
        p_remarks: `Received from retailer ${sub.user_id} - ${items.length} machine(s) - ₹${baseAmount.toFixed(2)} + GST ₹${gstAmount.toFixed(2)} (${periodStartStr} to ${periodEndStr})`,
      })
      console.log(`[AutoDebit] Revenue credited: ₹${totalAmount.toFixed(2)} from ${sub.user_id}`)
    } catch (e: any) {
      console.error('[AutoDebit] Revenue credit failed:', e.message)
    }
  }

  // 3. Advance retailer next_billing_date
  const nextMonth = new Date(billingDate)
  nextMonth.setMonth(nextMonth.getMonth() + 1)
  const advancedBillingStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-${String(billingDay).padStart(2, '0')}`
  await supabase
    .from('subscriptions')
    .update({ next_billing_date: advancedBillingStr, updated_at: new Date().toISOString() })
    .eq('id', sub.id)

  // 4. COMMISSION distribution from the retailer's subscription items
  let commissionsCreated = 0

  const distCommission = new Map<string, number>()
  const mdCommission = new Map<string, number>()
  const distItemCount = new Map<string, number>()
  const mdItemCount = new Map<string, number>()

  for (const it of items) {
    const retRate = Number(it.retailer_rate) || 0
    const distRate = Number(it.distributor_rate) || 0
    const mdRateVal = Number(it.md_rate) || 0
    const did = it.distributor_id
    const mid = it.master_distributor_id

    // Distributor commission = retailer_rate − distributor_rate
    if (did && retRate > distRate) {
      const comm = retRate - distRate
      distCommission.set(did, (distCommission.get(did) || 0) + comm)
      distItemCount.set(did, (distItemCount.get(did) || 0) + 1)
    }
    // MD commission = distributor_rate − md_rate
    if (mid && distRate > mdRateVal) {
      const comm = distRate - mdRateVal
      mdCommission.set(mid, (mdCommission.get(mid) || 0) + comm)
      mdItemCount.set(mid, (mdItemCount.get(mid) || 0) + 1)
    }
  }

  // Credit distributor(s) and record debit in revenue wallet
  for (const [distId, commAmount] of Array.from(distCommission.entries())) {
    if (commAmount <= 0) continue
    const roundedComm = Math.round(commAmount * 100) / 100
    try {
      const { data: commLedgerId, error: commErr } = await supabase.rpc('add_ledger_entry', {
        p_user_id: distId,
        p_user_role: 'distributor',
        p_wallet_type: 'primary',
        p_fund_category: 'commission',
        p_service_type: 'subscription',
        p_tx_type: 'POS_RENTAL_COMMISSION',
        p_credit: roundedComm,
        p_debit: 0,
        p_reference_id: `SUB_COMM_${debitRow.id}`,
        p_transaction_id: debitRow.id,
        p_status: 'completed',
        p_remarks: `POS commission ₹${roundedComm.toFixed(2)} - ${distItemCount.get(distId) || 0} machine(s) from retailer ${sub.user_id}`,
      })
      // Record commission payout as debit in revenue wallet
      if (revenueConfigured) {
        try {
          await supabase.rpc('add_ledger_entry', {
            p_user_id: revenueUserId,
            p_user_role: revenueUserRole,
            p_wallet_type: 'primary',
            p_fund_category: 'commission',
            p_service_type: 'subscription',
            p_tx_type: 'POS_RENTAL_COMMISSION',
            p_credit: 0,
            p_debit: roundedComm,
            p_reference_id: `SUB_COMM_OUT_${debitRow.id}_${distId}`,
            p_transaction_id: debitRow.id,
            p_status: 'completed',
            p_remarks: `Commission paid to distributor ${distId} - ₹${roundedComm.toFixed(2)} from retailer ${sub.user_id}`,
          })
        } catch {}
      }
      await supabase.from('subscription_commissions').insert({
        debit_id: debitRow.id,
        beneficiary_id: distId,
        beneficiary_role: 'distributor',
        amount: roundedComm,
        gst_amount: 0,
        item_count: distItemCount.get(distId) || 0,
        ledger_id: commErr ? null : commLedgerId,
        status: commErr ? 'failed' : 'completed',
        failure_reason: commErr?.message || null,
      })
      commissionsCreated++
      console.log(`[AutoDebit] Distributor ${distId} commission: ₹${roundedComm}`)
    } catch (e: any) {
      console.error(`[AutoDebit] Distributor commission error ${distId}:`, e.message)
    }
  }

  // Credit MD(s) and record debit in revenue wallet
  for (const [mdId, commAmount] of Array.from(mdCommission.entries())) {
    if (commAmount <= 0) continue
    const roundedComm = Math.round(commAmount * 100) / 100
    try {
      const { data: commLedgerId, error: commErr } = await supabase.rpc('add_ledger_entry', {
        p_user_id: mdId,
        p_user_role: 'master_distributor',
        p_wallet_type: 'primary',
        p_fund_category: 'commission',
        p_service_type: 'subscription',
        p_tx_type: 'POS_RENTAL_COMMISSION',
        p_credit: roundedComm,
        p_debit: 0,
        p_reference_id: `SUB_COMM_MD_${debitRow.id}`,
        p_transaction_id: debitRow.id,
        p_status: 'completed',
        p_remarks: `POS commission (MD) ₹${roundedComm.toFixed(2)} - ${mdItemCount.get(mdId) || 0} machine(s) from retailer ${sub.user_id}`,
      })
      // Record commission payout as debit in revenue wallet
      if (revenueConfigured) {
        try {
          await supabase.rpc('add_ledger_entry', {
            p_user_id: revenueUserId,
            p_user_role: revenueUserRole,
            p_wallet_type: 'primary',
            p_fund_category: 'commission',
            p_service_type: 'subscription',
            p_tx_type: 'POS_RENTAL_COMMISSION',
            p_credit: 0,
            p_debit: roundedComm,
            p_reference_id: `SUB_COMM_OUT_${debitRow.id}_${mdId}`,
            p_transaction_id: debitRow.id,
            p_status: 'completed',
            p_remarks: `Commission paid to MD ${mdId} - ₹${roundedComm.toFixed(2)} from retailer ${sub.user_id}`,
          })
        } catch {}
      }
      await supabase.from('subscription_commissions').insert({
        debit_id: debitRow.id,
        beneficiary_id: mdId,
        beneficiary_role: 'master_distributor',
        amount: roundedComm,
        gst_amount: 0,
        item_count: mdItemCount.get(mdId) || 0,
        ledger_id: commErr ? null : commLedgerId,
        status: commErr ? 'failed' : 'completed',
        failure_reason: commErr?.message || null,
      })
      commissionsCreated++
      console.log(`[AutoDebit] MD ${mdId} commission: ₹${roundedComm}`)
    } catch (e: any) {
      console.error(`[AutoDebit] MD commission error ${mdId}:`, e.message)
    }
  }

  return { status: 'completed', commissionsCreated }
}
