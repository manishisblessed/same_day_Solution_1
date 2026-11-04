const { Client } = require('pg')
const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
const ACC = '921010035105294'
c.connect()
  .then(async () => {
    const { rows } = await c.query(`
      SELECT id, retailer_id, account_number, ifsc_code, bene_code, bene_name,
             is_bank_verified, is_active, created_at
      FROM knteer_beneficiaries
      WHERE account_number = $1
      ORDER BY created_at DESC
    `, [ACC])
    console.log(`knteer_beneficiaries rows for account ${ACC}:`)
    if (rows.length === 0) console.log('  (none — account never saved to DB)')
    rows.forEach(r => console.log(
      ` id=${r.id} retailer=${r.retailer_id} bene_code=${r.bene_code || 'NULL'} verified=${r.is_bank_verified} active=${r.is_active} ${r.created_at.toISOString().substring(0,19)}`
    ))

    // Also check if any transactions exist for this account
    const { rows: txns } = await c.query(`
      SELECT id, status, bene_code, partner_trans_id, knteer_trans_id, created_at
      FROM knteer_payout_transactions
      WHERE account_number = $1
      ORDER BY created_at DESC LIMIT 10
    `, [ACC])
    console.log(`\nknteer_payout_transactions for account ${ACC}:`)
    if (txns.length === 0) console.log('  (none)')
    txns.forEach(r => console.log(
      ` status=${r.status} bene_code=${r.bene_code || 'NULL'} partnerTxn=${r.partner_trans_id} ${r.created_at.toISOString().substring(0,19)}`
    ))
  })
  .catch(e => console.error('ERROR:', e.message))
  .finally(() => c.end())
