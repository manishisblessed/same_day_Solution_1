/* READ-ONLY post-reconciliation verification. */
const { Client } = require('pg')
const fs = require('fs'), path = require('path')
for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const P = '078ebf34-5593-47c2-98ff-101e4e275c39'
const ALL = ['PTM_2026091616003800015227241350','PL_7264745446','PL_7264737367','PTM_2026091614201200015127241350','260916093842963R01gMr3GGA']
;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = async (label, sql, params=[]) => { const r = await c.query(sql, params); console.log(`\n=== ${label} ===`); console.table(r.rows); return r.rows }

  await q('5 txns after recon', `
    select txn_id, card_brand, partner_id is not null has_partner, partner_wallet_credited credited,
           partner_mdr_amount mdr, partner_net_amount net, settlement_mode
    from razorpay_pos_transactions where txn_id = any($1) order by partner_net_amount desc`, [ALL])

  await q('per-txn ledger entries created today', `
    select reference_id, credit, debit, description, created_at
    from partner_wallet_ledger where partner_id=$1 and created_at::date = current_date
    order by created_at`, [P])

  await q('balance', `select balance from partner_wallets where partner_id=$1`, [P])
  await c.end()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
