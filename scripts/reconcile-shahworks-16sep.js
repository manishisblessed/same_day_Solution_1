/**
 * Reconcile Shah Works 16-Sept POS settlement per user instruction:
 *
 *   1. Backfill partner_id on the AMEX txn (device TID 91975745 is assigned to
 *      the partner in pos_machines but the row was ingested with partner_id=NULL,
 *      so the T+1 cron never saw it).
 *   2. REVERSE the single batched credit that settled 4 VISA txns in one entry
 *      (ref ...-35dc17018057, ₹1,37,787.88).
 *   3. Reset those 4 txns to un-credited.
 *   4. Re-settle ALL 5 txns individually — one wallet credit + one ledger entry
 *      per transaction — at the correct per-brand MDR (VISA 1.05%, AMEX 1.5%).
 *
 * Per-txn reference == PARTNER-T1-<date>-<partnerId>-<sha256(txn.id)[:12]>, the
 * exact formula the fixed cron uses, so a later cron run hits the duplicate
 * guard and never double-credits.
 *
 * DRY-RUN by default. Pass --commit to apply. Idempotent: aborts if the
 * reversal has already been recorded.
 */
const { Client } = require('pg')
const { createHash } = require('crypto')
const fs = require('fs'), path = require('path')
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const COMMIT = process.argv.includes('--commit')
const P = '078ebf34-5593-47c2-98ff-101e4e275c39' // Shah Works
const AMEX_TXN = '260916093842963R01gMr3GGA'
const VISA_TXNS = [
  'PTM_2026091616003800015227241350',
  'PL_7264745446',
  'PL_7264737367',
  'PTM_2026091614201200015127241350',
]
const ALL_TXNS = [...VISA_TXNS, AMEX_TXN]
const SETTLE_DATE = '2026-09-17' // date the batch settled / recon runs
const money = (n) => `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
const r2 = (n) => Math.round(Number(n) * 100) / 100
const canon = (b) => String(b || '').toUpperCase().replace(/[\s_-]+/g, '').replace('AMERICANEXPRESS', 'AMEX').replace('MASTER', 'MASTERCARD').replace('MASTERCARDCARD', 'MASTERCARD')
const refFor = (id) => `PARTNER-T1-${SETTLE_DATE}-${P}-${createHash('sha256').update(String(id)).digest('hex').slice(0, 12)}`

;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = (s, p) => c.query(s, p).then(r => r.rows)
  console.log(`\n=== Shah Works 16-Sept reconciliation — ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ===\n`)

  // Scheme rates (all-company, per brand).
  const scheme = (await q(`select scheme_id from resolve_scheme_for_user($1,'partner','mdr',null,null)`, [P]))[0]
  if (!scheme?.scheme_id) throw new Error('no scheme resolved')
  const rates = await q(
    `select card_type, brand_type, partner_mdr from scheme_mdr_rates
      where scheme_id=$1 and status='active' and mode='CARD' and partner_mdr is not null and merchant_slug is null`,
    [scheme.scheme_id]
  )
  const rateForBrand = (brand) => {
    const cb = canon(brand)
    const hit = rates.find((r) => canon(r.brand_type) === cb) || rates[0]
    return { pct: parseFloat(hit.partner_mdr), matchedBrand: hit.brand_type }
  }

  // Load the 5 target txns.
  const txns = await q(
    `select id, txn_id, tid, partner_id, coalesce(gross_amount, amount) amt, card_brand, card_type,
            display_status, settlement_type, settlement_mode, partner_wallet_credited, partner_wallet_credit_id
       from razorpay_pos_transactions where txn_id = any($1)`, [ALL_TXNS]
  )
  if (txns.length !== 5) console.warn(`WARNING: expected 5 txns, found ${txns.length}`)

  // Identify the batch ledger entry that paid the 4 VISA txns.
  const batchLedgerIds = [...new Set(txns.filter(t => VISA_TXNS.includes(t.txn_id) && t.partner_wallet_credit_id).map(t => t.partner_wallet_credit_id))]
  if (batchLedgerIds.length !== 1) throw new Error(`expected exactly 1 batch ledger id, got ${JSON.stringify(batchLedgerIds)}`)
  const batchLedger = (await q(`select id, reference_id, credit from partner_wallet_ledger where id=$1`, [batchLedgerIds[0]]))[0]
  if (!batchLedger) throw new Error('batch ledger row not found')
  const batchCredit = Number(batchLedger.credit)
  const reversalRef = `REVERSAL-${batchLedger.reference_id}`

  // Idempotency guard.
  const already = (await q(`select id from partner_wallet_ledger where reference_id=$1 and partner_id=$2`, [reversalRef, P]))[0]
  if (already) { console.log(`Reversal ${reversalRef} already exists — nothing to do.`); await c.end(); return }

  const balBefore = Number((await q(`select balance from partner_wallets where partner_id=$1`, [P]))[0].balance)

  // Compute per-txn plan.
  const plan = txns.map((t) => {
    const { pct, matchedBrand } = rateForBrand(t.card_brand)
    const fee = r2((Number(t.amt) * pct) / 100)
    const net = r2(Number(t.amt) - fee)
    return { ...t, pct, matchedBrand, fee, net, newRef: refFor(t.id) }
  })
  const totalNet = r2(plan.reduce((s, i) => s + i.net, 0))

  console.log('Scheme rates:', rates.map(r => `${r.brand_type}=${r.partner_mdr}%`).join(', '))
  console.log(`\nBatch to reverse: ${batchLedger.reference_id}  credit ${money(batchCredit)}\n`)
  console.log('Per-transaction re-settlement:')
  for (const i of plan) {
    console.log(`  ${i.txn_id.padEnd(34)} ${String(i.card_brand).padEnd(12)} gross ${money(i.amt).padStart(14)}  mdr ${i.pct}% → fee ${money(i.fee).padStart(10)}  net ${money(i.net).padStart(14)}  ${i.partner_id ? '' : '[partner_id NULL→backfill]'}`)
  }
  console.log(`\n  Balance now:              ${money(balBefore)}`)
  console.log(`  After reversal (−batch):  ${money(balBefore - batchCredit)}`)
  console.log(`  After per-txn credits:    ${money(balBefore - batchCredit + totalNet)}`)
  console.log(`  Net change:               ${money(totalNet - batchCredit)}  (= AMEX net only)`)

  if (!COMMIT) { console.log('\nDRY-RUN. Re-run with --commit to apply.'); await c.end(); return }

  await c.query('BEGIN')
  try {
    // 1. Reverse the batched credit.
    await c.query(`select debit_partner_wallet($1,$2::decimal,null,$3,$4,'pos_settlement_reversal')`,
      [P, batchCredit, `Reversal of batched 4-txn T+1 settlement (${batchLedger.reference_id}); re-settled per transaction`, reversalRef])

    // 2. Reset the 4 VISA txns to un-credited (settlement_mode stays NULL).
    await c.query(
      `update razorpay_pos_transactions
          set partner_wallet_credited=false, partner_wallet_credit_id=null,
              partner_net_amount=null, partner_mdr_amount=null, partner_auto_settled_at=null
        where txn_id = any($1)`, [VISA_TXNS])

    // 3. Backfill partner_id on the AMEX txn.
    await c.query(`update razorpay_pos_transactions set partner_id=$1 where txn_id=$2 and partner_id is null`, [P, AMEX_TXN])

    // 4. Re-settle all 5 individually.
    for (const i of plan) {
      const claimed = (await c.query(
        `update razorpay_pos_transactions set partner_wallet_credited=true
          where id=$1 and partner_wallet_credited=false returning id`, [i.id])).rows
      if (claimed.length === 0) { console.log(`  skip ${i.txn_id} (already credited)`); continue }
      await c.query(`select credit_partner_wallet($1,$2::decimal,$3,$4,'CREDIT','pos')`,
        [P, i.net, `T+1 Auto Settlement - txn ${i.txn_id}, Gross: ${money(i.amt)}, MDR: ${money(i.fee)}, Net: ${money(i.net)}`, i.newRef])
      const ledgerId = (await c.query(`select id from partner_wallet_ledger where reference_id=$1 and partner_id=$2 limit 1`, [i.newRef, P])).rows[0]?.id || null
      await c.query(
        `update razorpay_pos_transactions
            set partner_wallet_credit_id=$1, partner_mdr_amount=$2, partner_net_amount=$3, partner_auto_settled_at=now()
          where id=$4`, [ledgerId, i.fee, i.net, i.id])
      console.log(`  ✓ ${i.txn_id} credited ${money(i.net)} (ref ${i.newRef})`)
    }

    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK'); throw e
  }

  const balAfter = Number((await q(`select balance from partner_wallets where partner_id=$1`, [P]))[0].balance)
  console.log(`\nCOMMIT successful. Balance: ${money(balBefore)} → ${money(balAfter)}`)
  await c.end()
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1) })
