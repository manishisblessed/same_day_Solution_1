/* eslint-disable */
// Reconcile past charges for a partner against their now-assigned scheme.
//
// Context: while the partner had NO scheme assigned, transactions used the old
// global-fallback pricing — Pay2New/Rechargekit CC bills were OVERCHARGED
// (e.g. ₹20/₹25 instead of the scheme's ₹10/₹15) and Shadval settlements were
// UNDERCHARGED (₹0 instead of ₹18/₹22). Now that the correct scheme is mapped,
// this script recomputes the correct charge for every past SUCCESSFUL
// transaction and posts a net wallet adjustment:
//   • correct > charged  (undercharged) => DEBIT  the shortfall from the wallet
//   • correct < charged  (overcharged)  => CREDIT the excess  to   the wallet
//
// It mirrors the exact live charge logic:
//   - Pay2New / Rechargekit CC  -> calculate_bbps_charge_from_scheme(category 'Credit Card')
//   - Shadval settlement        -> resolveShadvalCharge (RPC then mapping-scoped slab)
//   - GST = 18% on the base charge
//
// SAFETY:
//   - DRY-RUN by default. Prints a per-transaction table + totals and writes a
//     CSV. Applies NOTHING unless --apply is passed.
//   - Adjustment ledger rows use deterministic reference_ids (RECON_*) so the
//     wallet RPCs' idempotency makes re-runs safe (no double adjustment).
//   - Undercharge DEBITs require sufficient wallet balance; shortfalls are
//     reported and skipped (never forces a negative balance).
//
// Usage:
//   node scripts/reconcile-ecaps-charges.mjs                       # dry-run
//   node scripts/reconcile-ecaps-charges.mjs --partner "EQUITY CAPITAL"
//   node scripts/reconcile-ecaps-charges.mjs --apply               # execute
//   node scripts/reconcile-ecaps-charges.mjs --apply --only refund # only credits
//   node scripts/reconcile-ecaps-charges.mjs --apply --only collect# only debits

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.join(__dirname, '..')

const GST_RATE = 0.18
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// ---- args ----
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const only = (() => {
  const i = args.indexOf('--only')
  return i !== -1 ? (args[i + 1] || '').toLowerCase() : ''
})()
const partnerQuery = (() => {
  const i = args.indexOf('--partner')
  return i !== -1 && args[i + 1] ? args[i + 1] : 'EQUITY CAPITAL ADVISORS'
})()
// Out-of-slab = a past charge whose amount falls outside every scheme slab, so
// the "correct" charge computes to ₹0. Refunding the whole charge there is
// usually wrong (these are sub-min test payments). Skipped unless explicitly opted in.
const REFUND_OUT_OF_SLAB = args.includes('--refund-out-of-slab')

// ---- env ----
function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    if (process.env[key] !== undefined && process.env[key] !== '') continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}
for (const f of [path.join(ROOT, '.env.local'), path.join(process.cwd(), '.env.local')]) loadEnvFile(f)

function sslFor(cs) {
  const s = cs || ''
  if (/sslmode=disable/i.test(s)) return false
  if (/@localhost|@127\.0\.0\.1|@\[::1\]/i.test(s)) return false
  return { rejectUnauthorized: false }
}

// Parse "+ ₹23.60 charge" (total incl GST) out of a ledger description.
function parseTotalChargeWithGst(description) {
  const text = description || ''
  const m = text.match(/\+\s*₹?([\d,.]+)\s*(?:GST|charge)/i)
  return m ? parseFloat(m[1].replace(/,/g, '')) : 0
}

async function resolveBbpsSchemeId(client, partnerId) {
  // Mirror live: resolve_scheme_for_user first, then mapping-scoped fallback.
  const rpc = await client.query(
    `SELECT scheme_id, scheme_name FROM resolve_scheme_for_user($1,'partner','bbps',NULL,NULL) LIMIT 1`,
    [partnerId]
  )
  if (rpc.rows[0]?.scheme_id) return rpc.rows[0]

  const map = await client.query(
    `SELECT scheme_id FROM scheme_mappings
      WHERE entity_id=$1 AND entity_role='partner' AND status='active'
        AND (service_type IS NULL OR service_type IN ('all','bbps'))
      ORDER BY priority ASC NULLS LAST, created_at DESC LIMIT 1`,
    [partnerId]
  )
  return map.rows[0] ? { scheme_id: map.rows[0].scheme_id, scheme_name: null } : null
}

async function correctBbpsBase(client, schemeId, amount, category = 'Credit Card') {
  // RPC first
  try {
    const rpc = await client.query(
      `SELECT retailer_charge FROM calculate_bbps_charge_from_scheme($1,$2,$3) LIMIT 1`,
      [schemeId, amount, category]
    )
    const v = parseFloat(rpc.rows[0]?.retailer_charge)
    if (Number.isFinite(v) && v > 0) return v
  } catch {}
  // Slab fallback (mirror route)
  const slabs = await client.query(
    `SELECT * FROM scheme_bbps_commissions
      WHERE scheme_id=$1 AND status='active' AND min_amount<=$2 AND max_amount>=$2
      ORDER BY min_amount DESC`,
    [schemeId, amount]
  )
  const best = (slabs.rows || []).find((s) => {
    const sc = (s.category || '').toString()
    return !sc || sc === '' || sc.toLowerCase() === 'all' || sc.toLowerCase() === 'all categories' || sc === category
  })
  if (!best) return 0
  const rc = parseFloat(best.retailer_charge) || 0
  return best.retailer_charge_type === 'percentage' ? r2(amount * rc / 100) : rc
}

async function correctShadvalBase(client, partnerId, amount, mode) {
  // 1. RPC via resolved scheme
  try {
    const rpc = await client.query(
      `SELECT scheme_id FROM resolve_scheme_for_user($1,'partner','shadval_settlement',NULL,NULL) LIMIT 1`,
      [partnerId]
    )
    const sid = rpc.rows[0]?.scheme_id
    if (sid) {
      const calc = await client.query(
        `SELECT retailer_charge FROM calculate_shadval_settlement_charge_from_scheme($1,$2,$3) LIMIT 1`,
        [sid, amount, mode]
      )
      const v = parseFloat(calc.rows[0]?.retailer_charge) || 0
      if (v > 0) return { base: v, schemeId: sid }
    }
  } catch {}
  // 2. Mapping-scoped slab fallback
  const map = await client.query(
    `SELECT scheme_id FROM scheme_mappings
      WHERE entity_id=$1 AND entity_role='partner' AND status='active'
        AND (service_type IS NULL OR service_type IN ('all','shadval_settlement'))`,
    [partnerId]
  )
  const schemeIds = (map.rows || []).map((m) => m.scheme_id)
  if (schemeIds.length === 0) return { base: 0, schemeId: null }
  const slabs = await client.query(
    `SELECT * FROM scheme_shadval_settlement_charges
      WHERE scheme_id = ANY($1) AND status='active' AND transfer_mode=$2
        AND min_amount<=$3 AND max_amount>=$3
      ORDER BY min_amount DESC LIMIT 1`,
    [schemeIds, mode, amount]
  )
  const s = slabs.rows[0]
  if (!s) return { base: 0, schemeId: null }
  const rtPc = parseFloat(s.rt_purchase_charge) || 0
  const rawRc = parseFloat(s.retailer_charge) || 0
  const effCharge = rtPc > 0 ? rtPc : rawRc
  const effType = rtPc > 0 ? (s.rt_purchase_charge_type || 'flat') : (s.retailer_charge_type || 'flat')
  const base = effType === 'percentage' ? r2(amount * effCharge / 100) : effCharge
  return { base, schemeId: s.scheme_id }
}

function fmt(n) { return `₹${r2(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` }

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL not set (checked .env.local)')

  const client = new Client({ connectionString, ssl: sslFor(connectionString) })
  await client.connect()

  try {
    // --- Partner ---
    const pRes = await client.query(
      `SELECT id, name, business_name, email FROM partners
        WHERE name ILIKE $1 OR business_name ILIKE $1 ORDER BY created_at ASC`,
      [`%${partnerQuery}%`]
    )
    if (pRes.rows.length === 0) throw new Error(`No partner matches "${partnerQuery}"`)
    if (pRes.rows.length > 1) {
      console.log('Multiple partners match; using the first:')
      pRes.rows.forEach((p) => console.log(`   ${p.id}  ${p.name || p.business_name}`))
    }
    const partner = pRes.rows[0]
    const partnerId = partner.id
    console.log('='.repeat(78))
    console.log(`Partner : ${partner.name || partner.business_name}`)
    console.log(`ID      : ${partnerId}`)
    console.log(`Mode    : ${APPLY ? 'APPLY (writes to wallet)' : 'DRY-RUN (no writes)'}${only ? ` | only=${only}` : ''}`)
    console.log('='.repeat(78))

    const bbpsScheme = await resolveBbpsSchemeId(client, partnerId)
    console.log(`BBPS/CC scheme: ${bbpsScheme ? (bbpsScheme.scheme_name || bbpsScheme.scheme_id) : 'NONE'}`)
    console.log('')

    const rows = [] // { kind, ref, date, amount, mode, actualTotal, correctTotal, delta }

    // ---------- 1) Pay2New / Rechargekit CC (partner_wallet_ledger) ----------
    const led = await client.query(
      `SELECT id, reference_id, service_type, description, debit, amount, status, created_at
         FROM partner_wallet_ledger
        WHERE partner_id=$1
          AND transaction_type='DEBIT'
          AND status='completed'
          AND service_type IN ('pay2new','rechargekit')
          AND (reference_id IS NULL OR reference_id NOT LIKE 'RECON\\_%')
        ORDER BY created_at ASC`,
      [partnerId]
    )

    // Refund set (failed txns already returned) — exclude them.
    const refunded = new Set()
    const refRes = await client.query(
      `SELECT reference_id FROM partner_wallet_ledger
        WHERE partner_id=$1 AND transaction_type='REFUND' AND reference_id LIKE 'REFUND\\_%'`,
      [partnerId]
    )
    for (const r of refRes.rows) refunded.add(String(r.reference_id).replace(/^REFUND_/, ''))

    for (const tx of led.rows) {
      if (tx.reference_id && refunded.has(tx.reference_id)) continue
      const debit = Number(tx.debit) || Number(tx.amount) || 0
      const actualTotal = r2(parseTotalChargeWithGst(tx.description))
      const billAmount = r2(debit - actualTotal)
      if (billAmount <= 0) continue
      if (!bbpsScheme) continue
      const correctBase = await correctBbpsBase(client, bbpsScheme.scheme_id, billAmount, 'Credit Card')
      const correctTotal = r2(correctBase * (1 + GST_RATE))
      const delta = r2(correctTotal - actualTotal)
      rows.push({
        kind: tx.service_type === 'rechargekit' ? 'RK-CC' : 'Pay2New-CC',
        ref: tx.reference_id, date: tx.created_at, amount: billAmount, mode: '-',
        actualTotal, correctTotal, delta,
      })
    }

    // ---------- 2) Shadval settlements ----------
    const set = await client.query(
      `SELECT id, reference_id, amount, charges, mode, status, created_at
         FROM shadval_settlement
        WHERE retailer_id=$1 AND status='SUCCESS'
        ORDER BY created_at ASC`,
      [partnerId]
    )
    for (const tx of set.rows) {
      const amount = Number(tx.amount) || 0
      const actualTotal = r2(Number(tx.charges) || 0)
      const mode = tx.mode || 'IMPS'
      const { base } = await correctShadvalBase(client, partnerId, amount, mode)
      const correctTotal = r2(base * (1 + GST_RATE))
      const delta = r2(correctTotal - actualTotal)
      rows.push({
        kind: 'Settlement', ref: tx.reference_id, date: tx.created_at, amount, mode,
        actualTotal, correctTotal, delta,
      })
    }

    // ---------- Report ----------
    // Out-of-slab: charged something historically but the scheme has no covering
    // slab now (correctTotal 0) => refund would zero it out. Park these separately.
    const outOfSlab = rows.filter((r) => r.delta < 0 && r.correctTotal === 0)
    const adjPool = REFUND_OUT_OF_SLAB ? rows : rows.filter((r) => !(r.delta < 0 && r.correctTotal === 0))
    const adj = adjPool.filter((r) => Math.abs(r.delta) >= 0.01)
    const overcharged = adj.filter((r) => r.delta < 0)   // refund to partner
    const undercharged = adj.filter((r) => r.delta > 0)  // collect from partner

    const totalRefund = r2(overcharged.reduce((s, r) => s + -r.delta, 0))
    const totalCollect = r2(undercharged.reduce((s, r) => s + r.delta, 0))

    const line = (r) =>
      `${(r.kind).padEnd(11)} ${String(r.ref || '').slice(0, 34).padEnd(34)} ${new Date(r.date).toISOString().slice(0, 10)} ` +
      `amt=${String(fmt(r.amount)).padStart(13)} charged=${String(fmt(r.actualTotal)).padStart(10)} ` +
      `correct=${String(fmt(r.correctTotal)).padStart(10)} delta=${String((r.delta > 0 ? '+' : '') + fmt(r.delta)).padStart(11)}`

    console.log(`Scanned: ${rows.length} successful txns | Needing adjustment: ${adj.length}`)
    console.log('')
    if (overcharged.length) {
      console.log(`── OVERCHARGED → REFUND to partner (${overcharged.length}) ──`)
      overcharged.forEach((r) => console.log('  ' + line(r)))
      console.log('')
    }
    if (undercharged.length) {
      console.log(`── UNDERCHARGED → COLLECT from partner (${undercharged.length}) ──`)
      undercharged.forEach((r) => console.log('  ' + line(r)))
      console.log('')
    }

    const byKind = {}
    for (const r of adj) {
      const k = r.kind
      byKind[k] = byKind[k] || { refund: 0, collect: 0, n: 0 }
      byKind[k].n++
      if (r.delta < 0) byKind[k].refund += -r.delta
      else byKind[k].collect += r.delta
    }
    console.log('── Summary by service ──')
    for (const [k, v] of Object.entries(byKind)) {
      console.log(`  ${k.padEnd(11)} txns=${String(v.n).padStart(4)}  refund=${fmt(v.refund).padStart(12)}  collect=${fmt(v.collect).padStart(12)}`)
    }
    console.log('')
    if (outOfSlab.length && !REFUND_OUT_OF_SLAB) {
      const ooTotal = r2(outOfSlab.reduce((s, r) => s + r.actualTotal, 0))
      console.log(`── OUT-OF-SLAB (SKIPPED — amount outside every scheme slab; ${outOfSlab.length} txns, charged ${fmt(ooTotal)}) ──`)
      outOfSlab.forEach((r) => console.log('  ' + line(r)))
      console.log('  (pass --refund-out-of-slab to refund these in full)')
      console.log('')
    }

    console.log('── TOTALS ──')
    console.log(`  Refund to partner (overcharged) : ${fmt(totalRefund)}  across ${overcharged.length} txns`)
    console.log(`  Collect from partner (under)    : ${fmt(totalCollect)}  across ${undercharged.length} txns`)
    console.log(`  NET wallet effect on partner    : ${fmt(totalRefund - totalCollect)} (positive = partner gains)`)

    const bal = await client.query(`SELECT balance FROM partner_wallets WHERE partner_id=$1`, [partnerId])
    const currentBalance = Number(bal.rows[0]?.balance || 0)
    console.log(`  Current wallet balance          : ${fmt(currentBalance)}`)
    console.log('')

    // CSV artifact
    const csvPath = path.join(ROOT, `reconcile-${String(partner.name || 'partner').replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}-${Date.now()}.csv`)
    const csv = ['kind,reference_id,date,amount,charged_total,correct_total,delta,action']
      .concat(adj.map((r) => [
        r.kind, r.ref, new Date(r.date).toISOString(), r.amount, r.actualTotal, r.correctTotal, r.delta,
        r.delta < 0 ? 'REFUND' : 'COLLECT',
      ].join(',')))
      .join('\n')
    fs.writeFileSync(csvPath, csv)
    console.log(`CSV written: ${csvPath}`)

    if (!APPLY) {
      console.log('\nDRY-RUN complete. No wallet changes made. Re-run with --apply to execute.')
      return
    }

    // ---------- Apply ----------
    console.log('\nAPPLYING adjustments...')
    let refunds = 0, refundAmt = 0, collects = 0, collectAmt = 0, skipped = 0
    const failures = []

    for (const r of adj) {
      const isRefund = r.delta < 0
      if (only === 'refund' && !isRefund) continue
      if (only === 'collect' && isRefund) continue

      const svc = r.kind === 'Settlement' ? 'shadval_settlement' : (r.kind === 'RK-CC' ? 'rechargekit' : 'pay2new')
      try {
        if (isRefund) {
          const amt = r2(-r.delta)
          await client.query(
            `SELECT credit_partner_wallet($1,$2,$3,$4,'ADJUSTMENT',$5)`,
            [partnerId, amt,
             `Scheme reconciliation refund (overcharge) for ${r.ref} — charged ${fmt(r.actualTotal)}, correct ${fmt(r.correctTotal)}`,
             `RECON_REFUND_${r.ref}`, svc]
          )
          refunds++; refundAmt = r2(refundAmt + amt)
        } else {
          const amt = r2(r.delta)
          await client.query(
            `SELECT debit_partner_wallet($1,$2,NULL,$3,$4,$5)`,
            [partnerId, amt,
             `Scheme reconciliation collection (undercharge) for ${r.ref} — charged ${fmt(r.actualTotal)}, correct ${fmt(r.correctTotal)}`,
             `RECON_COLLECT_${r.ref}`, svc]
          )
          collects++; collectAmt = r2(collectAmt + amt)
        }
      } catch (e) {
        const msg = String(e?.message || e)
        if (/Duplicate: reference_id/.test(msg)) { skipped++; continue } // already applied
        if (/Insufficient balance/.test(msg)) { failures.push({ ref: r.ref, reason: 'insufficient_balance', delta: r.delta }); continue }
        failures.push({ ref: r.ref, reason: msg, delta: r.delta })
      }
    }

    const bal2 = await client.query(`SELECT balance FROM partner_wallets WHERE partner_id=$1`, [partnerId])
    console.log('')
    console.log(`Refunds credited : ${refunds}  (${fmt(refundAmt)})`)
    console.log(`Collections debited: ${collects}  (${fmt(collectAmt)})`)
    console.log(`Already applied (skipped): ${skipped}`)
    console.log(`New wallet balance: ${fmt(Number(bal2.rows[0]?.balance || 0))}`)
    if (failures.length) {
      console.log(`\nFAILURES (${failures.length}) — need manual review:`)
      failures.forEach((f) => console.log(`  ${f.ref}  delta=${fmt(f.delta)}  reason=${f.reason}`))
    }
    console.log('\nDONE.')
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error('ERROR:', e?.message || e); process.exit(1) })
