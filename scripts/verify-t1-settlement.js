/**
 * Verify a T+1 auto-settlement run.
 *
 * Run AFTER the 09:00 IST cron (or a manual run):
 *   node scripts/verify-t1-settlement.js
 *
 * It isolates the LATEST run (via t1_cron_settings.last_run_at) and confirms:
 *  - cron last-run status
 *  - what settled in that run (settlement_mode = AUTO_T1) with retailer net and
 *    distributor commission gross / 2% TDS / net
 *  - DOUBLE-PAY GUARD: nothing dated before the backlog anchor was paid
 *  - distributor commission actually credited in the ledger (net of TDS)
 *  - any settlement alerts raised in the run
 *
 * Backlog anchor: transactions captured on/after this settle; anything before is
 * the manually-handled backlog that must NOT auto-settle.
 */
const { Client } = require('pg')
const fs = require('fs'), path = require('path')
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

// Aug 5 2026 00:00 IST — the "today-onward only" line. Only txns >= this settle.
const BACKLOG_ANCHOR = '2026-08-04T18:30:00.000Z'
const FOCUS_RETAILER = 'RET64519407'
const FOCUS_DISTRIBUTOR = 'DIS64443281'

;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: false })
  await c.connect()
  const q = async (label, sql, params = []) => { const r = await c.query(sql, params); console.log(`\n=== ${label} ===`); console.table(r.rows); return r.rows }

  // Latest run boundary (2-min buffer before last_run_at so we catch all its writes).
  const lr = await c.query(`select last_run_at, last_run_status, last_run_message,
      last_run_processed, last_run_failed from t1_cron_settings`)
  console.log('\n=== cron last run ==='); console.table(lr.rows)
  const runStart = new Date(new Date(lr.rows[0].last_run_at).getTime() - 2 * 60 * 1000).toISOString()
  console.log('Isolating settlements with auto_settled_at >=', runStart)
  console.log('Backlog anchor (must not settle, before):', BACKLOG_ANCHOR)

  // 1. What settled in THIS run (per retailer)
  await q('settled in latest run (per retailer)', `
    select retailer_id,
           count(*)                                                 txns,
           round(sum(coalesce(gross_amount, amount)), 2)            gross,
           round(sum(net_amount), 2)                                retailer_net,
           round(sum(coalesce(distributor_commission_gross,0)), 2)  comm_gross,
           round(sum(coalesce(distributor_tds,0)), 2)               tds_2pct,
           round(sum(coalesce(distributor_commission_net,0)), 2)    comm_net
    from razorpay_pos_transactions
    where settlement_mode = 'AUTO_T1' and auto_settled_at >= $1
    group by retailer_id order by gross desc`, [runStart])

  // 2. Focus retailer detail
  await q(`${FOCUS_RETAILER} — settled in latest run`, `
    select txn_id, tid, card_brand, coalesce(gross_amount,amount) gross, net_amount retailer_net,
           distributor_commission_gross comm_gross, distributor_tds tds, distributor_commission_net comm_net,
           auto_settled_at
    from razorpay_pos_transactions
    where retailer_id=$2 and settlement_mode='AUTO_T1' and auto_settled_at >= $1
    order by auto_settled_at`, [runStart, FOCUS_RETAILER])

  // 3. DOUBLE-PAY GUARD — pre-anchor txns paid in this run (MUST be 0)
  await q('!! backlog paid in latest run (MUST be 0) !!', `
    select count(*) leaked, coalesce(round(sum(net_amount),2),0) leaked_net
    from razorpay_pos_transactions
    where settlement_mode='AUTO_T1' and auto_settled_at >= $1 and transaction_time < $2`,
    [runStart, BACKLOG_ANCHOR])

  // 4. Distributor commission credited in this run (net of TDS)
  await q(`${FOCUS_DISTRIBUTOR} — commission ledger in latest run`, `
    select count(*) rows, round(coalesce(sum(credit),0),2) net_credited
    from wallet_ledger
    where retailer_id=$2 and transaction_type='DISTRIBUTOR_COMMISSION' and created_at >= $1`,
    [runStart, FOCUS_DISTRIBUTOR])

  // 5. Alerts raised in this run
  await q('open settlement alerts in latest run', `
    select retailer_id, txn_id, alert_type, reason, created_at
    from settlement_alerts
    where status='open' and created_at >= $1
    order by created_at desc limit 30`, [runStart]).catch(e => console.log('alerts:', e.message))

  await c.end()
})().catch(e => { console.error(e); process.exit(1) })
