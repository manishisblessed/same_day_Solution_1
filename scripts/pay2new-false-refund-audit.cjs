#!/usr/bin/env node
/**
 * READ-ONLY audit of Pay2New (BBPS-2 CC) refunds that have NOT been clawed back.
 *
 * It moves NO money. It answers: "how much have we refunded to partners on
 * pay2new that we have NOT reversed, and (optionally) how much of that is a
 * FALSE refund (the vendor actually SUCCEEDED)?"
 *
 * Stage 1 (always, DB-only):   un-recovered refunds = REFUND_<id> with no CLAWBACK_<id>.
 * Stage 2 (optional --verify): re-check each against the Pay2New vendor status
 *                              API. Only SUCCESS ones are the real loss.
 *                              NOTE: vendor API is IP-allowlisted — run --verify
 *                              ON THE SERVER (15.207.31.125), not from a laptop.
 *
 * Usage:
 *   node scripts/pay2new-false-refund-audit.cjs            # stage 1 only
 *   node scripts/pay2new-false-refund-audit.cjs --verify   # stage 1 + vendor re-check
 *   node scripts/pay2new-false-refund-audit.cjs --verify --limit=200
 */

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

// ── load .env.local (same loader shape as instrumentation.ts) ──────────────
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
const VERIFY = args.includes('--verify')
const limitArg = args.find((a) => a.startsWith('--limit='))
const VERIFY_LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const PAGE = 1000

/** Page through a pay2new ledger query matching a reference_id prefix. */
async function fetchAll(prefix) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('partner_wallet_ledger')
      .select('id, partner_id, reference_id, debit, credit, status, description, created_at')
      .eq('service_type', 'pay2new')
      .ilike('reference_id', `${prefix}%`)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`${prefix} query: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

function inr(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

;(async () => {
  console.log('Pay2New false-refund audit (READ-ONLY) — connecting to',
    process.env.NEXT_PUBLIC_SUPABASE_URL)

  // REFUND_ credits (money returned to partner) and CLAWBACK_ debits (already recovered).
  const [refunds, clawbacks] = await Promise.all([
    fetchAll('REFUND_SDS'),
    fetchAll('CLAWBACK_SDS'),
  ])

  const clawedRefs = new Set(
    clawbacks.map((r) => String(r.reference_id).replace(/^CLAWBACK_/, ''))
  )

  // Un-recovered refund = REFUND_<ref> whose <ref> has no CLAWBACK_<ref>.
  const unrecovered = refunds.filter(
    (r) => !clawedRefs.has(String(r.reference_id).replace(/^REFUND_/, ''))
  )

  const totalRefunded = refunds.reduce((s, r) => s + Number(r.credit || r.debit || 0), 0)
  const totalClawed = clawbacks.reduce((s, r) => s + Number(r.debit || 0), 0)
  const totalUnrecovered = unrecovered.reduce((s, r) => s + Number(r.credit || r.debit || 0), 0)

  console.log('\n─── Stage 1: ledger totals (DB-only, no vendor calls) ───')
  console.log(`REFUND_  rows:            ${refunds.length}  (${inr(totalRefunded)})`)
  console.log(`CLAWBACK_ rows:           ${clawbacks.length}  (${inr(totalClawed)})`)
  console.log(`UN-RECOVERED refunds:     ${unrecovered.length}  (${inr(totalUnrecovered)})  <- max at-risk`)

  if (!VERIFY) {
    console.log('\nStage 1 only. The UN-RECOVERED figure is the MAXIMUM exposure;')
    console.log('the true loss is the subset the vendor shows as SUCCESS.')
    console.log('Run with --verify ON THE SERVER to confirm the real loss:')
    console.log('  node scripts/pay2new-false-refund-audit.cjs --verify')
    return
  }

  // ── Stage 2: vendor re-verify (IP-allowlisted; run on server) ────────────
  const base = (process.env.PAY2NEW_BASE_URL || '').replace(/\/$/, '')
  const secret = process.env.PAY2NEW_SECRET
  if (!base || !secret) {
    console.error('\n--verify needs PAY2NEW_BASE_URL + PAY2NEW_SECRET in env.')
    process.exit(1)
  }

  async function vendorStatus(ref) {
    try {
      const res = await fetch(`${base}/apis/v1/transactionStatus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', secret },
        body: JSON.stringify({ client_txn_id: ref }),
      })
      const text = await res.text()
      let j
      try { j = JSON.parse(text) } catch { return { status: 'NONJSON', raw: text.slice(0, 120) } }
      const order = j.order
      if (!order) return { status: Number(j.status) === 2 ? 'NOT_FOUND' : 'PENDING', msg: j.message }
      const os = String(order.status ?? '').trim()
      const om = String(order.message ?? '').toLowerCase()
      let s = 'PENDING'
      if (os === '1' || /success|successful/.test(om)) s = 'SUCCESS'
      else if (/refund|revers/.test(om)) s = 'REFUNDED'
      else if (/fail|failure|reject|declin|cancel/.test(om)) s = 'FAILED'
      return { status: s, order_id: order.order_id, operator_reference: order.operator_reference }
    } catch (e) {
      return { status: 'UNREACHABLE', msg: e.message }
    }
  }

  const toCheck = unrecovered.slice(0, Number.isFinite(VERIFY_LIMIT) ? VERIFY_LIMIT : undefined)
  console.log(`\n─── Stage 2: vendor re-verify ${toCheck.length} un-recovered refund(s) ───`)

  const falseRefunds = []
  const buckets = {}
  for (let i = 0; i < toCheck.length; i++) {
    const r = toCheck[i]
    const ref = String(r.reference_id).replace(/^REFUND_/, '')
    const amt = Number(r.credit || r.debit || 0)
    const st = await vendorStatus(ref)
    buckets[st.status] = (buckets[st.status] || 0) + 1
    if (st.status === 'SUCCESS') {
      falseRefunds.push({ ref, partner_id: r.partner_id, amount: amt, order_id: st.order_id, operator_reference: st.operator_reference })
      console.log(`  FALSE REFUND  ${ref}  ${inr(amt)}  partner=${r.partner_id}  order=${st.order_id || '-'}`)
    }
    await new Promise((res) => setTimeout(res, 350))
    if ((i + 1) % 50 === 0) console.log(`  …${i + 1}/${toCheck.length} checked`)
  }

  const trueLoss = falseRefunds.reduce((s, f) => s + f.amount, 0)
  console.log('\n─── RESULT ───')
  console.log('vendor status breakdown:', buckets)
  console.log(`CONFIRMED FALSE REFUNDS (vendor=SUCCESS): ${falseRefunds.length}`)
  console.log(`CONFIRMED REAL LOSS (recoverable):        ${inr(trueLoss)}`)
  fs.writeFileSync('/tmp/p2n_false_refunds.json', JSON.stringify(falseRefunds, null, 2))
  console.log('Full list written to /tmp/p2n_false_refunds.json')
})().catch((e) => {
  console.error('AUDIT ERROR:', e.message)
  process.exit(1)
})
