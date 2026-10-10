/**
 * Pay2New FALSE-REFUND sweep & recovery.
 *
 * Finds Pay2New (BBPS-2 CC) payments that were REFUNDED on our side but actually
 * SUCCEEDED at the vendor (the silent-loss incident), across both ledgers:
 *   - partner_wallet_ledger   (partner-API integrators)
 *   - wallet_ledger           (in-app retailers/partners)
 *
 * For each candidate (a DEBIT with a matching REFUND_<request_id>) it asks
 * Pay2New's live transactionStatus. If the vendor says SUCCESS, the refund was
 * false and we lost the money → it is reported as a CONFIRMED LOSS.
 *
 * DEFAULT = READ-ONLY REPORT. Nothing moves. Review the report first.
 *
 * With --apply it performs the idempotent recovery: a CLAWBACK_<request_id>
 * re-debit that reverses the wrong refund (money recovered), and annotates the
 * original debit with the vendor OrderID. Idempotent — the wallet RPCs reject a
 * duplicate reference_id, so re-running never double-charges.
 *
 * Usage (from app root so .env is picked up):
 *   node scripts/pay2new-false-refund-sweep.cjs                 # report, auto-discover
 *   node scripts/pay2new-false-refund-sweep.cjs --ids SDS1,SDS2 # report specific ids
 *   node scripts/pay2new-false-refund-sweep.cjs --apply         # recover confirmed losses
 *   node scripts/pay2new-false-refund-sweep.cjs --apply --max 60000
 *
 * Env: DATABASE_URL, PAY2NEW_BASE_URL (default https://pay2new.in), PAY2NEW_SECRET.
 */

const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

function loadEnv() {
  for (const p of ['.env.local', '.env', path.join('sameday-backend', '.env.local'), path.join('sameday-backend', '.env')]) {
    try {
      const full = path.resolve(p)
      if (!fs.existsSync(full)) continue
      for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
        if (!m) continue
        const key = m[1]
        const val = m[2].replace(/^['"]|['"]$/g, '')
        if (process.env[key] === undefined) process.env[key] = val
      }
    } catch {}
  }
}
loadEnv()

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const MAX_AMOUNT = (() => {
  const i = args.indexOf('--max')
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : 100000
})()
const EXPLICIT_IDS = (() => {
  const i = args.indexOf('--ids')
  if (i >= 0 && args[i + 1]) return args[i + 1].split(',').map((s) => s.trim()).filter(Boolean)
  return null
})()

const DB_URL = process.env.DATABASE_URL
const BASE = (process.env.PAY2NEW_BASE_URL || 'https://pay2new.in').replace(/\/$/, '')
const SECRET = process.env.PAY2NEW_SECRET || ''

const money = (n) => `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function vendorStatus(requestId) {
  if (!SECRET) return { ok: false, status: 'NO_SECRET' }
  try {
    const res = await fetch(`${BASE}/apis/v1/transactionStatus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', secret: SECRET },
      body: JSON.stringify({ client_txn_id: requestId }),
    })
    const text = await res.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { return { ok: false, status: `HTTP ${res.status} non-JSON` } }
    const order = parsed && parsed.order
    if (!order) {
      // ONLY a genuine "no transaction found" is a real NOT_FOUND. Everything
      // else without an order block (IP not verified, invalid secret, rate
      // limit, provider pending) is INCONCLUSIVE and must NEVER be read as a
      // correct refund — otherwise a run from a non-whitelisted IP would falsely
      // clear real losses. Return ok:false so the loop skips it.
      const msg = String((parsed && parsed.message) || '').toLowerCase()
      if (/no\s*transaction\s*found/.test(msg)) return { ok: true, status: 'NOT_FOUND', raw: parsed }
      return { ok: false, status: `UNVERIFIED: ${(parsed && parsed.message) || 'no order block'}`, raw: parsed }
    }
    const os = String(order.status ?? '').trim()
    const om = String(order.message ?? '').toLowerCase()
    let norm = 'PENDING'
    if (os === '1' || /success|successful/.test(om)) norm = 'SUCCESS'
    else if (/refund|revers/.test(om)) norm = 'REFUNDED'
    else if (/fail|failure|reject|declin|cancel/.test(om)) norm = 'FAILED'
    return { ok: true, status: norm, order_id: order.order_id, operator_reference: order.operator_reference, raw: parsed }
  } catch (e) {
    return { ok: false, status: `ERROR ${e.message}` }
  }
}

async function discoverPartner(c) {
  const where = EXPLICIT_IDS
    ? `d.reference_id = ANY($1)`
    : `d.reference_id LIKE 'SDS%'`
  const params = EXPLICIT_IDS ? [EXPLICIT_IDS] : []
  const { rows } = await c.query(
    `SELECT d.partner_id AS owner_id, d.reference_id, d.debit, d.description, d.created_at,
            'partner' AS ledger
     FROM partner_wallet_ledger d
     WHERE d.service_type = 'pay2new' AND d.transaction_type = 'DEBIT' AND ${where}
       AND EXISTS (SELECT 1 FROM partner_wallet_ledger r
                   WHERE r.partner_id = d.partner_id AND r.reference_id = 'REFUND_' || d.reference_id)
       AND NOT EXISTS (SELECT 1 FROM partner_wallet_ledger cb
                       WHERE cb.partner_id = d.partner_id AND cb.reference_id = 'CLAWBACK_' || d.reference_id)
     ORDER BY d.created_at ASC`,
    params
  )
  return rows
}

async function discoverRetailer(c) {
  const where = EXPLICIT_IDS ? `d.reference_id = ANY($1)` : `d.reference_id LIKE 'SDS%'`
  const params = EXPLICIT_IDS ? [EXPLICIT_IDS] : []
  const { rows } = await c.query(
    `SELECT d.retailer_id AS owner_id, d.reference_id, d.debit, d.description, d.created_at,
            'retailer' AS ledger
     FROM wallet_ledger d
     WHERE d.service_type = 'pay2new' AND d.debit > 0 AND ${where}
       AND EXISTS (SELECT 1 FROM wallet_ledger r
                   WHERE r.retailer_id = d.retailer_id AND r.reference_id = 'REFUND_' || d.reference_id)
       AND NOT EXISTS (SELECT 1 FROM wallet_ledger cb
                       WHERE cb.retailer_id = d.retailer_id AND cb.reference_id = 'CLAWBACK_' || d.reference_id)
     ORDER BY d.created_at ASC`,
    params
  )
  return rows
}

async function clawbackPartner(c, row) {
  // Reverse the wrong refund: re-debit the partner wallet (idempotent).
  const total = Number(row.debit)
  const refundRef = `CLAWBACK_${row.reference_id}`
  await c.query(
    `SELECT debit_partner_wallet($1,$2,$3,$4,$5,$6)`,
    [row.owner_id, total, null, `BBPS-2 clawback of false refund — vendor SUCCESS | orig ${row.reference_id}`, refundRef, 'pay2new']
  )
}

async function clawbackRetailer(c, row) {
  const total = Number(row.debit)
  const refundRef = `CLAWBACK_${row.reference_id}`
  await c.query(
    `SELECT add_ledger_entry($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [row.owner_id, 'retailer', 'primary', 'service', 'pay2new', 'PAY2NEW_DEBIT',
     0, total, refundRef, null, 'completed', `BBPS-2 clawback of false refund — vendor SUCCESS | orig ${row.reference_id}`]
  )
}

;(async () => {
  if (!DB_URL) { console.error('DATABASE_URL not set.'); process.exit(1) }
  if (!SECRET) { console.error('PAY2NEW_SECRET not set — cannot verify vendor status.'); process.exit(1) }

  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()

  console.log(`\n=== Pay2New false-refund sweep ===  mode=${APPLY ? 'APPLY (recover)' : 'REPORT (read-only)'}  maxPerTxn=${money(MAX_AMOUNT)}\n`)

  try {
    const candidates = [...(await discoverPartner(c)), ...(await discoverRetailer(c))]
    if (candidates.length === 0) {
      console.log('No refunded Pay2New candidates found (either none, or already clawed back).')
      return
    }
    console.log(`Inspecting ${candidates.length} refunded candidate(s) against the vendor...\n`)

    let confirmedCount = 0
    let confirmedAmount = 0
    let recovered = 0
    let recoveredAmount = 0
    let inconclusive = 0
    const needManual = []

    for (const row of candidates) {
      const v = await vendorStatus(row.reference_id)
      await sleep(300)
      const tag = `${row.reference_id} [${row.ledger}] ${money(row.debit)} ${new Date(row.created_at).toISOString().slice(0, 19)}`

      if (!v.ok) { inconclusive++; console.log(`  ?  ${tag}  vendor=${v.status} (inconclusive, skipped)`); continue }
      if (v.status !== 'SUCCESS') { console.log(`  .  ${tag}  vendor=${v.status} (refund was correct)`); continue }

      // CONFIRMED LOSS: we refunded but the vendor succeeded.
      confirmedCount++
      confirmedAmount += Number(row.debit)
      console.log(`  ✗  ${tag}  vendor=SUCCESS order=${v.order_id || 'N/A'}  >>> CONFIRMED FALSE REFUND`)

      if (!APPLY) continue
      if (Number(row.debit) > MAX_AMOUNT) {
        console.log(`     ! skipped recovery: ₹${row.debit} exceeds --max ${MAX_AMOUNT}; add --max to include`)
        needManual.push(row.reference_id)
        continue
      }
      try {
        if (row.ledger === 'partner') {
          await clawbackPartner(c, row)
          // Annotate the original debit with the vendor OrderID + flip it off
          // 'failed' so bill/status (ledger-status.ts) resolves SUCCESS. The
          // CLAWBACK_ row makes ledger-status treat the REFUND_ as reversed.
          await c.query(
            `UPDATE partner_wallet_ledger SET status='completed',
               description = description || ' | OrderID:' || $2 || ' | Ref:' || $3 || ' | ReconVerified(clawback)'
             WHERE partner_id=$1 AND reference_id=$4 AND description NOT LIKE '%OrderID:%'`,
            [row.owner_id, v.order_id || 'N/A', v.operator_reference || 'N/A', row.reference_id]
          )
        } else {
          await clawbackRetailer(c, row)
          // In-app flow reports status from pay2new_transactions — flip to success.
          await c.query(
            `UPDATE pay2new_transactions
               SET status='success', order_id=COALESCE(order_id,$2),
                   operator_reference=COALESCE(operator_reference,$3),
                   completed_at=NOW(), error_message=NULL
             WHERE request_id=$1`,
            [row.reference_id, v.order_id || null, v.operator_reference || null]
          )
        }
        recovered++
        recoveredAmount += Number(row.debit)
        console.log(`     ✓ recovered ${money(row.debit)} via CLAWBACK_${row.reference_id}`)
      } catch (e) {
        console.log(`     ! recovery FAILED (${e.message}) — manual follow-up needed`)
        needManual.push(row.reference_id)
      }
    }

    console.log(`\n--- Summary ---`)
    console.log(`  Confirmed false refunds : ${confirmedCount}  (${money(confirmedAmount)})`)
    console.log(`  Inconclusive (skipped)  : ${inconclusive}`)
    if (inconclusive === candidates.length && candidates.length > 0) {
      console.log(`\n  ⚠  EVERY candidate was inconclusive — the vendor rejected all status`)
      console.log(`     checks (commonly "IP address not verified"). This run proves NOTHING.`)
      console.log(`     Re-run from the WHITELISTED production host (IP ${process.env.PAY2NEW_SERVER_IP || '15.207.31.125'}).`)
    }
    if (APPLY) {
      console.log(`  Recovered               : ${recovered}  (${money(recoveredAmount)})`)
      if (needManual.length) console.log(`  Needs manual follow-up  : ${needManual.join(', ')}`)
    } else {
      console.log(`  Run again with --apply to recover (re-debit) these amounts.`)
    }
    console.log('')
  } finally {
    await c.end()
  }
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1) })
