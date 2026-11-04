const { Client } = require('pg')
const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
c.connect()
  .then(() => c.query("SELECT column_name FROM information_schema.columns WHERE table_name='knteer_payout_transactions' ORDER BY ordinal_position"))
  .then(r => {
    console.log('knteer_payout_transactions columns:')
    r.rows.forEach(row => console.log(' ', row.column_name))
  })
  .catch(e => console.error('ERROR:', e.message))
  .finally(() => c.end())
