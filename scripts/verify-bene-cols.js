const { Client } = require('pg')
const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
c.connect()
  .then(() => c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='knteer_beneficiaries' ORDER BY ordinal_position"))
  .then(r => {
    console.log('knteer_beneficiaries columns:')
    r.rows.forEach(row => console.log(' ', row.column_name.padEnd(28), row.data_type))
  })
  .catch(e => console.error('ERROR:', e.message))
  .finally(() => c.end())
