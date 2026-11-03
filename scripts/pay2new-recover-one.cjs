#!/usr/bin/env node
/**
 * Recover ONE Pay2New false refund — safe, idempotent, single transaction.
 *
 * Stage 1 (default, READ-ONLY, runs anywhere):
 *   Locate the DEBIT row + its REFUND_, show whether a CLAWBACK_ already exists,
 *   and show the partner's current wallet balance. Moves NO money.
 *
 * Stage 2 (--execute, moves money, MUST run on the server 15.207.31.125):
 *   1. Re-verify the vendor STILL shows SUCCESS (hard gate — aborts otherwise).
 *   2. Require a REFUND_ to reverse and NO existing CLAWBACK_ (idempotent).
 *   3. Idempotent CLAWBACK_<request_id> re-debit of the exact refunded amount.
 *   4. Annotate the debit row completed + ReconVerified(clawback).
 *
 * Identify the row by either:
 *   --request-id=SDS1762...            (preferred)
 *   --amount=50012.16 --date=2026-11-02 (fallback search; narrows candidates)
 *
 * Examples:
 *   node scripts/pay2new-recover-one.cjs --amount=50012.16 --date=2026-11-02
 *   node scripts/pay2new-recover-one.cjs --request-id=SDS1762... --execute
 */

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

;(() => {
  try {
    const content = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
    for (const line of content.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i === -1) continue
      const k = t.slice(0, i).trim()
      const v = t.slice(i + 1).trim()
      if (k && v && !process.env[k]) process.env[k] = v
    }
  } catch (e) {
    console.error('Could not read .env.local:', e.message)
    process.exit(1)
  }
})()

const args = process.argv.slice(2)
const getArg = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split('=').slice(1).join('=') : undefined
}
const EXECUTE = args.includes('--execute')
const QUEUE = args.includes('--queue')
const REQUEST_ID = getArg('request-id')
const AMOUNT = getArg('amount') ? Number(getArg('amount')) : undefined
const DATE = getArg('date') // YYYY-MM-DD (IST day)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const inr = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function vendorStatus(ref) {
  const base = (process.env.PAY2NEW_BASE_URL || '').replace(/\/$/, '')
  const secret = process.env.PAY2NEW_SECRET
  const res = await fetch(`${base}/apis/v1/transactionStatus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', secret },
    body: JSON.stringify({ client_txn_id: ref }),
  })
  const text = await res.text()
  let j
  try { j = JSON.parse(text) } catch { return { status: 'NONJSON', raw: text.slice(0, 200) } }
  const order = j.order
  if (!order) return { status: Number(j.status) === 2 ? 'NOT_FOUND' : 'PENDING', msg: j.message }
  const os = String(order.status ?? '').trim()
  const om = String(order.message ?? '').toLowerCase()
  let s = 'PENDING'
  if (os === '1' || /success|successful/.test(om)) s = 'SUCCESS'
  else if (/refund|revers/.test(om)) s = 'REFUNDED'
  else if (/fail|failure|reject|declin|cancel/.test(om)) s = 'FAILED'
  return { status: s, order_id: order.order_id, operator_reference: order.operator_reference, amount: order.amount }
}

;(async () => {
  // ── locate the DEBIT row ─────────────────────────────────────────────────
  let debit
  if (REQUEST_ID) {
    const { data, error } = await supabase
      .from('partner_wallet_ledger')
      .select('id, partner_id, reference_id, debit, credit, status, description, created_at')
      .eq('service_type', 'pay2new')
      .eq('transaction_type', 'DEBIT')
      .eq('reference_id', REQUEST_ID)
      .maybeSingle()
    if (error) throw new Error(error.message)
    debit = data
  } else {
    if (!AMOUNT) {
      console.error('Provide --request-id=SDS... OR --amount=<n> [--date=YYYY-MM-DD]')
      process.exit(1)
    }
    let q = supabase
      .from('partner_wallet_ledger')
      .select('id, partner_id, reference_id, debit, credit, status, description, created_at')
      .eq('service_type', 'pay2new')
      .eq('transaction_type', 'DEBIT')
      .ilike('reference_id', 'SDS%')
      .eq('debit', AMOUNT)
    if (DATE) {
      // IST day → UTC window
      const start = new Date(`${DATE}T00:00:00+05:30`).toISOString()
      const end = new Date(`${DATE}T23:59:59+05:30`).toISOString()
      q = q.gte('created_at', start).lte('created_at', end)
    }
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) { console.error('No matching DEBIT row found.'); process.exit(1) }
    if (data.length > 1) {
      console.log(`Found ${data.length} candidate rows — re-run with --request-id to disambiguate:`)
      for (const r of data) console.log(`  ${r.reference_id}  ${inr(r.debit)}  ${r.status}  ${r.created_at}  ${r.description?.slice(0, 80)}`)
      process.exit(1)
    }
    debit = data[0]
  }

  if (!debit) { console.error('DEBIT row not found.'); process.exit(1) }
  const ref = debit.reference_id
  const amount = Number(debit.debit)

  console.log('─── Target DEBIT row ───')
  console.log(`request_id : ${ref}`)
  console.log(`partner_id : ${debit.partner_id}`)
  console.log(`amount     : ${inr(amount)}`)
  console.log(`status     : ${debit.status}`)
  console.log(`created_at : ${debit.created_at}`)
  console.log(`desc       : ${debit.description}`)

  // refund + existing clawback
  const [{ data: refundRow }, { data: clawRow }, { data: wallet }] = await Promise.all([
    supabase.from('partner_wallet_ledger').select('id, credit, created_at').eq('partner_id', debit.partner_id).eq('reference_id', `REFUND_${ref}`).maybeSingle(),
    supabase.from('partner_wallet_ledger').select('id, debit, created_at').eq('partner_id', debit.partner_id).eq('reference_id', `CLAWBACK_${ref}`).maybeSingle(),
    supabase.from('partner_wallets').select('balance, is_frozen').eq('partner_id', debit.partner_id).maybeSingle(),
  ])

  console.log('\n─── Recovery preconditions ───')
  console.log(`REFUND_ exists   : ${refundRow ? `YES (${inr(refundRow.credit)})` : 'NO'}`)
  console.log(`CLAWBACK_ exists : ${clawRow ? `YES (${inr(clawRow.debit)}) — already recovered` : 'NO'}`)
  console.log(`partner balance  : ${inr(wallet?.balance)}${wallet?.is_frozen ? '  [FROZEN]' : ''}`)

  if (clawRow) { console.log('\n✓ Already recovered (CLAWBACK_ present). Nothing to do.'); return }
  if (!refundRow) { console.log('\n✗ No REFUND_ to reverse — this was not refunded; nothing to claw back.'); return }

  const clawAmount = Number(refundRow.credit) || amount

  // ── QUEUE for the standing clawback-recovery cron (moves NO money) ───────
  // Tags the debit row so pay2new-clawback-recovery-cron picks it up and, after
  // a FRESH vendor SUCCESS re-verify, re-debits the EXACT amount the moment the
  // partner balance covers it. Idempotent (guarded by NOT ILIKE FalseRefundConfirmed).
  if (QUEUE && !EXECUTE) {
    const order = getArg('order') || 'N/A'
    const opref = getArg('ref') || 'N/A'
    const { error } = await supabase
      .from('partner_wallet_ledger')
      .update({ description: `${debit.description || ''} | FalseRefundConfirmed(order:${order} ref:${opref}) RecoveryPending` })
      .eq('id', debit.id)
      .not('description', 'ilike', '%FalseRefundConfirmed%')
    if (error) { console.error('✗ Queue tag failed:', error.message); process.exit(1) }
    console.log(`\n✓ QUEUED for recovery. Tagged FalseRefundConfirmed(order:${order} ref:${opref}) RecoveryPending.`)
    console.log(`  The clawback-recovery cron (once live) will re-verify vendor=SUCCESS and re-debit ${inr(clawAmount)} the moment partner balance ≥ ${inr(clawAmount)}.`)
    return
  }

  if (!EXECUTE) {
    console.log('\n[DRY-RUN] Would, after confirming vendor=SUCCESS on the server:')
    console.log(`  re-debit ${inr(clawAmount)} from partner ${debit.partner_id} as CLAWBACK_${ref}`)
    console.log('\nTo execute (ON THE SERVER 15.207.31.125):')
    console.log(`  node scripts/pay2new-recover-one.cjs --request-id=${ref} --execute`)
    return
  }

  // ── EXECUTE (server only) ────────────────────────────────────────────────
  console.log('\n─── EXECUTE: re-verifying vendor before moving money ───')
  let st
  try { st = await vendorStatus(ref) } catch (e) { console.error('Vendor status call failed (are you on the server?):', e.message); process.exit(1) }
  console.log('vendor status:', st)
  if (st.status !== 'SUCCESS') {
    console.error(`\n✗ ABORT: vendor is ${st.status}, not SUCCESS. Refusing to claw back (no proof the card was charged).`)
    process.exit(1)
  }
  if (wallet?.is_frozen) { console.error('\n✗ ABORT: partner wallet is frozen.'); process.exit(1) }
  if (Number(wallet?.balance || 0) < clawAmount) {
    console.error(`\n✗ ABORT: partner balance ${inr(wallet?.balance)} < clawback ${inr(clawAmount)}. Queue for recovery cron instead.`)
    process.exit(1)
  }

  const { error: rpcErr } = await supabase.rpc('debit_partner_wallet', {
    p_partner_id: debit.partner_id,
    p_amount: clawAmount,
    p_payout_transaction_id: null,
    p_description: `BBPS-2 clawback of false refund — vendor SUCCESS | orig ${ref}`,
    p_reference_id: `CLAWBACK_${ref}`,
    p_service_type: 'pay2new',
  })
  if (rpcErr) {
    if (/duplicate/i.test(rpcErr.message || '')) { console.log('Already clawed back (duplicate CLAWBACK_). Done.'); return }
    console.error('✗ Clawback re-debit failed:', rpcErr.message)
    process.exit(1)
  }

  await supabase
    .from('partner_wallet_ledger')
    .update({
      status: 'completed',
      description: `${debit.description || ''} | OrderID:${st.order_id || 'N/A'} | Ref:${st.operator_reference || 'N/A'} | ReconVerified(clawback)`,
    })
    .eq('id', debit.id)

  console.log(`\n✓ RECOVERED ${inr(clawAmount)} from partner ${debit.partner_id} via CLAWBACK_${ref} (vendor order ${st.order_id || '-'}).`)
})().catch((e) => { console.error('RECOVERY ERROR:', e.message); process.exit(1) })
