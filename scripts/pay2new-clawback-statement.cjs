/**
 * Per-partner statement of BBPS-2 (Pay2New) FALSE-REFUND reversals (clawbacks).
 *
 * For each partner we debited, lists every transaction, why it was debited, and
 * the vendor proof (OrderID / operator reference). Also lists amounts still to be
 * recovered (queued, debited automatically as balance becomes available).
 *
 * Output: readable console statement + a shareable CSV (pay2new-clawback-statement.csv).
 *
 * Usage (from app root):  node scripts/pay2new-clawback-statement.cjs
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')
function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    try {
      const p = path.join(process.cwd(), f)
      if (!fs.existsSync(p)) continue
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
        if (!m) continue
        if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
      }
    } catch {}
  }
}
loadEnv()

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
const dt = (s) => new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Pull structured fields out of the original debit description.
function parseDesc(desc) {
  desc = desc || ''
  const amt = desc.match(/₹([\d.,]+)\s*\+\s*₹([\d.,]+)\s*charge/)
  const biller = desc.match(/charge\s*\|\s*([^|]+?)\s*\|\s*Card/)
  const card = desc.match(/Card:\s*([^\s|]+)/)
  const mob = desc.match(/Mob:\s*([^\s|]+)/)
  const name = desc.match(/Name:\s*([^|]+)/)
  const order = desc.match(/OrderID:\s*([^\s|]+)/) || desc.match(/FalseRefundConfirmed\(order:\s*([^\s)]+)/)
  const ref = desc.match(/\bRef:\s*([^\s|]+)/) || desc.match(/ref:\s*([^\s)]+)/)
  return {
    bill: amt ? amt[1] : '',
    charge: amt ? amt[2] : '',
    biller: biller ? biller[1].trim() : '',
    card: card ? card[1] : '',
    mobile: mob ? mob[1] : '',
    customer: name ? name[1].trim() : '',
    order: order ? order[1] : '',
    opref: ref ? ref[1] : '',
  }
}

;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    // 1) Recovered (CLAWBACK_ rows) joined to their original debit.
    const recovered = (await c.query(
      `SELECT cb.partner_id, pr.business_name, cb.debit AS amount, cb.created_at AS claw_date,
              orig.reference_id AS req_id, orig.created_at AS txn_date, orig.description AS desc
         FROM partner_wallet_ledger cb
         JOIN partner_wallet_ledger orig
           ON orig.partner_id = cb.partner_id
          AND orig.reference_id = REPLACE(cb.reference_id, 'CLAWBACK_', '')
         JOIN partners pr ON pr.id = cb.partner_id
        WHERE cb.service_type = 'pay2new' AND cb.reference_id LIKE 'CLAWBACK_%'
        ORDER BY pr.business_name, orig.created_at`
    )).rows

    // 2) Pending recovery (confirmed false refund, queued, not yet clawed back).
    const pending = (await c.query(
      `SELECT d.partner_id, pr.business_name, d.debit AS amount,
              d.reference_id AS req_id, d.created_at AS txn_date, d.description AS desc
         FROM partner_wallet_ledger d
         JOIN partners pr ON pr.id = d.partner_id
        WHERE d.service_type = 'pay2new' AND d.transaction_type = 'DEBIT'
          AND d.description ILIKE '%FalseRefundConfirmed%'
          AND d.description NOT ILIKE '%ReconVerified(clawback)%'
        ORDER BY pr.business_name, d.created_at`
    )).rows

    const partners = {}
    const add = (r, status) => {
      const p = parseDesc(r.desc)
      ;(partners[r.business_name] = partners[r.business_name] || { recovered: [], pending: [] })[status].push({
        req_id: r.req_id, txn_date: r.txn_date, amount: Number(r.amount), claw_date: r.claw_date, ...p,
      })
    }
    recovered.forEach((r) => add(r, 'recovered'))
    pending.forEach((r) => add(r, 'pending'))

    const csv = [
      'partner,status,request_id,transaction_date,biller,card,mobile,customer,bill_amount,charge,total_debited,vendor_order_id,operator_reference,reason',
    ]
    const REASON = 'Bill payment SUCCEEDED at BBPS-2 vendor but was wrongly refunded to wallet earlier; incorrect refund reversed (clawback).'

    console.log('\n==================  BBPS-2 FALSE-REFUND REVERSAL STATEMENT  ==================')
    console.log('Reason for debit: a credit-card bill payment that actually SUCCEEDED at the')
    console.log('vendor had been wrongly refunded to the wallet; we reversed that wrong refund.\n')

    for (const name of Object.keys(partners).sort()) {
      const g = partners[name]
      const recSum = g.recovered.reduce((s, x) => s + x.amount, 0)
      const penSum = g.pending.reduce((s, x) => s + x.amount, 0)
      console.log(`\n########  ${name}  ########`)
      console.log(`  Debited (recovered): ${g.recovered.length} txn = ${money(recSum)}`)
      console.log(`  Still to be debited (as balance allows): ${g.pending.length} txn = ${money(penSum)}\n`)

      const printRows = (rows, status) => {
        for (const x of rows) {
          console.log(`  • ${x.req_id} | ${dt(x.txn_date)} | ${x.biller || '-'} | Card ${x.card || '-'} | Mob ${x.mobile || '-'}`)
          console.log(`      bill ${money(x.bill || 0)} + charge ${money(x.charge || 0)} = debited ${money(x.amount)} | vendor OrderID ${x.order || '-'} / Ref ${x.opref || '-'}${status === 'recovered' && x.claw_date ? ' | debited on ' + dt(x.claw_date) : ' | PENDING (auto-debits when balance available)'}`)
          csv.push([
            '"' + name + '"', status, x.req_id, '"' + dt(x.txn_date) + '"', '"' + (x.biller || '') + '"',
            x.card || '', x.mobile || '', '"' + (x.customer || '') + '"', x.bill || '', x.charge || '',
            x.amount, x.order || '', x.opref || '', '"' + REASON + '"',
          ].join(','))
        }
      }
      if (g.recovered.length) { console.log('  --- Already debited (recovered) ---'); printRows(g.recovered, 'recovered') }
      if (g.pending.length) { console.log('  --- Pending (will auto-debit as balance allows) ---'); printRows(g.pending, 'pending') }
    }

    const out = path.join(process.cwd(), 'pay2new-clawback-statement.csv')
    fs.writeFileSync(out, csv.join('\n'), 'utf8')
    console.log(`\n\nCSV written: ${out}  (${csv.length - 1} rows)\n`)
  } finally {
    await c.end()
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
