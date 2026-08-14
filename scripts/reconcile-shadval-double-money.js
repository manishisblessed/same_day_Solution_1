/**
 * Reconcile a CONFIRMED Settlement-2 (Shadval) double-money transaction:
 * the bank payout genuinely SUCCEEDED (provider SUCCESS + UTR) but the wallet
 * was wrongly refunded. This restores the correct "successful transfer" state.
 *
 * MUST run from a Shadval-whitelisted host (production EC2) — it re-verifies with
 * the provider and REFUSES to act unless the provider confirms genuine SUCCESS.
 *
 * DRY-RUN BY DEFAULT. Pass --apply to actually write. Idempotent: the clawback
 * uses a deterministic ADJ_DOUBLEPAY_<ref> reference and pre-checks, so re-runs
 * never double-debit.
 *
 * For each reference it will:
 *   1. Claw back the wrong refund   → ADJUSTMENT debit of the refunded amount.
 *   2. Correct the settlement row   → status SUCCESS + UTR.
 *   3. Re-apply commission/revenue  → re-credit each COMMISSION_REVERSAL that was
 *                                      posted when it was wrongly failed.
 *
 * Usage:
 *   node scripts/reconcile-shadval-double-money.js SV2_xxx [SV2_yyy ...]           # dry-run
 *   node scripts/reconcile-shadval-double-money.js --apply SV2_xxx
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

;(function loadEnv() {
  const p = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
})()

const DB_URL = process.env.DATABASE_URL
const KEY = process.env.SHADVAL_PAY_KEY || process.env.SHADVAL_PAY_AUTHORIZATION_KEY
const BASE = process.env.SHADVAL_PAY_BASE_URL || 'https://partners.shadvalpay.co.in/api'
const IS_UAT = process.env.SHADVAL_PAY_ENV !== 'production'
const STATUS_URL = `${BASE}/${IS_UAT ? 'uat_payout_i/check_status' : 'payout_i/check_status'}`

if (!DB_URL) { console.error('DATABASE_URL required'); process.exit(1) }
if (!KEY) { console.error('SHADVAL_PAY_KEY required'); process.exit(1) }

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const refs = argv.filter((a) => !a.startsWith('--'))
if (refs.length === 0) { console.error('Provide at least one reference_id'); process.exit(1) }

function isGenuineProviderSuccess(d) {
  if (!d || d.status !== 'SUCCESS' || !d.data) return false
  const s = (d.data.txn_status || '').toLowerCase()
  const hasUtr = !!(d.data.utr && String(d.data.utr).trim())
  return hasUtr && s.includes('success') && !s.includes('refund') && !s.includes('revers') &&
    !s.includes('fail') && !s.includes('initiat') && !s.includes('pending') && !s.includes('process')
}

async function providerStatus(reference_id) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(STATUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': KEY },
      body: JSON.stringify({ reference_id }),
      signal: ctrl.signal,
    })
    return await res.json()
  } catch (e) {
    return { status: 'FAILED', code: 'LOCAL_ERROR', message: e.message }
  } finally { clearTimeout(t) }
}

const money = (v) => parseFloat(v || 0)

async function reconcileOne(c, reference_id) {
  console.log(`\n══════════ ${reference_id} ══════════`)

  const { rows: sRows } = await c.query(
    `SELECT id, retailer_id, user_role, reference_id, amount, charges, total_debit,
            actual_wallet_debit, status, utr, order_id, status_message
     FROM shadval_settlement WHERE reference_id = $1`, [reference_id])
  if (!sRows.length) { console.log('  ✗ settlement not found — skipping'); return }
  const tx = sRows[0]

  // Authoritative account type.
  const { rows: pRows } = await c.query('SELECT id FROM partners WHERE id::text = $1', [tx.retailer_id])
  const isPartner = pRows.length > 0
  const ledgerTable = isPartner ? 'partner_wallet_ledger' : 'wallet_ledger'
  const idCol = isPartner ? 'partner_id' : 'retailer_id'

  // SAFETY: re-verify with the provider. Never claw back unless it truly succeeded.
  const prov = await providerStatus(reference_id)
  if (!isGenuineProviderSuccess(prov)) {
    console.log(`  ✗ provider does NOT confirm genuine success (status=${prov?.status} txn_status="${prov?.data?.txn_status || prov?.message}") — REFUSING to claw back`)
    return
  }
  const providerUtr = prov.data.utr
  console.log(`  ✓ provider confirms SUCCESS | UTR=${providerUtr} | amount=${prov.data.trans_amount}`)

  // Find the wrong refund credit.
  const { rows: refundRows } = await c.query(
    `SELECT credit, reference_id FROM ${ledgerTable}
     WHERE ${idCol}::text = $1 AND reference_id IN ($2, $3) AND credit > 0 LIMIT 1`,
    [tx.retailer_id, `REFUND_${reference_id}`, `REFUND_TIMEOUT_${reference_id}`])
  if (!refundRows.length) { console.log('  ✗ no refund credit found — nothing to claw back'); return }
  const refundAmount = money(refundRows[0].credit)

  const clawbackRef = `ADJ_DOUBLEPAY_${reference_id}`
  const { rows: existingClaw } = await c.query(
    `SELECT id FROM ${ledgerTable} WHERE ${idCol}::text = $1 AND reference_id = $2 LIMIT 1`,
    [tx.retailer_id, clawbackRef])
  const alreadyClawed = existingClaw.length > 0

  // Current balance + projected.
  let balance = null
  try {
    if (isPartner) {
      const { rows } = await c.query('SELECT get_partner_wallet_balance($1) AS b', [tx.retailer_id])
      balance = money(rows[0].b)
    } else {
      const { rows } = await c.query("SELECT get_wallet_balance_v2($1,'primary') AS b", [tx.retailer_id])
      balance = money(rows[0].b)
    }
  } catch (e) { console.log('  ! could not read balance:', e.message) }

  // Commission reversals to restore.
  const { rows: reversals } = await c.query(
    `SELECT retailer_id, user_role, wallet_type, fund_category, service_type, debit, reference_id
     FROM wallet_ledger
     WHERE transaction_id = $1 AND transaction_type = 'COMMISSION_REVERSAL' AND debit > 0`, [tx.id])

  console.log(`  wallet: ${isPartner ? 'partner' : 'retailer'} ${tx.retailer_id} | current balance: ${balance === null ? '?' : '₹' + balance.toFixed(2)}`)
  console.log(`  refund to claw back: ₹${refundAmount.toFixed(2)}  ${alreadyClawed ? '(ALREADY CLAWED BACK — will skip step 1)' : ''}`)
  if (balance !== null && !alreadyClawed && balance < refundAmount) {
    console.log(`  ⚠️  balance (₹${balance.toFixed(2)}) < clawback (₹${refundAmount.toFixed(2)}) → wallet would go NEGATIVE by ₹${(refundAmount - balance).toFixed(2)}`)
  }
  console.log(`  commission reversals to restore: ${reversals.length} (₹${reversals.reduce((s, r) => s + money(r.debit), 0).toFixed(2)})`)

  const plan = []
  if (!alreadyClawed) plan.push(`1. ADJUSTMENT debit ₹${refundAmount.toFixed(2)} (ref ${clawbackRef})`)
  if (tx.status !== 'SUCCESS') plan.push(`2. settlement ${tx.status} → SUCCESS, utr=${providerUtr}`)
  for (const r of reversals) plan.push(`3. re-credit ₹${money(r.debit).toFixed(2)} to ${r.retailer_id} (${r.user_role}) ref RECON_${r.reference_id}`)
  console.log(`  PLAN:${plan.length ? '\n    - ' + plan.join('\n    - ') : ' nothing to do'}`)

  if (!APPLY) { console.log('  [DRY-RUN] no changes made'); return }

  // ---- APPLY ----
  if (!alreadyClawed) {
    const remarks = `Double-pay clawback: wrong refund of ₹${refundAmount.toFixed(2)} reversed — provider confirmed SUCCESS (UTR ${providerUtr})`
    try {
      if (isPartner) {
        await c.query(
          `SELECT debit_partner_wallet($1,$2,$3,$4,$5) AS r`,
          [tx.retailer_id, refundAmount, remarks, clawbackRef, 'shadval_settlement'])
      } else {
        await c.query(
          `SELECT add_ledger_entry($1,'retailer','primary','service','shadval_settlement','ADJUSTMENT',0::decimal,$2::decimal,$3,$4::uuid,'completed',$5)`,
          [tx.retailer_id, refundAmount, clawbackRef, tx.id, remarks])
      }
    } catch (e) { console.log('  ✗ clawback failed:', e.message); return }
    console.log(`  ✓ clawed back ₹${refundAmount.toFixed(2)}`)
  }

  await c.query(
    `UPDATE shadval_settlement SET status='SUCCESS', utr=$2,
       status_message=$3, updated_at=NOW() WHERE id=$1`,
    [tx.id, providerUtr, `${(tx.status_message || '').replace(/\s*\[Wallet refunded[^\]]*\]\s*$/i, '')} [Reconciled SUCCESS — payout confirmed, wrong refund clawed back]`.trim()])
  console.log('  ✓ settlement marked SUCCESS')

  for (const r of reversals) {
    const reRef = `RECON_${r.reference_id}`
    try {
      await c.query(
        `SELECT add_ledger_entry($1,$2,$3,$4,$5,'COMMISSION_CREDIT',$6::decimal,0::decimal,$7,$8::uuid,'completed',$9)`,
        [r.retailer_id, r.user_role, r.wallet_type || 'primary', r.fund_category || 'commission',
         r.service_type || 'shadval_settlement', money(r.debit), reRef, tx.id,
         `Re-apply ${r.reference_id} after double-pay reconciliation`])
      console.log(`  ✓ re-credited ₹${money(r.debit).toFixed(2)} to ${r.retailer_id}`)
    } catch (e) {
      const dup = /duplicate/i.test(e.message) || e.code === '23505'
      console.log(`  ${dup ? '· already re-credited' : '✗ re-credit failed'} (${reRef})${dup ? '' : ': ' + e.message}`)
    }
  }
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE — writing changes ***' : '=== DRY-RUN (no changes). Pass --apply to execute. ===')
  const c = new Client({ connectionString: DB_URL })
  await c.connect()
  for (const ref of refs) await reconcileOne(c, ref)
  await c.end()
  console.log('\nDone.')
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1) })
