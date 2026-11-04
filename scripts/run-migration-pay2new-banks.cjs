// Run once: applies 20261104_pay2new_cc_billers.sql to Supabase
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

const sql = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20261104_pay2new_cc_billers.sql'),
  'utf8'
)

const client = new Client({
  connectionString: 'postgresql://postgres.ohmvvtnfdvvatgofrzta:Development%400022122025@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
})

;(async () => {
  try {
    await client.connect()
    console.log('Connected to Supabase.')
    await client.query(sql)
    console.log('Migration applied successfully.')

    const res = await client.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='pay2new_cc_billers' ORDER BY ordinal_position"
    )
    console.log('Table columns:')
    res.rows.forEach((r) => console.log(' ', r.column_name, ':', r.data_type))

    const idx = await client.query(
      "SELECT indexname FROM pg_indexes WHERE tablename='pay2new_cc_billers'"
    )
    console.log('Indexes:', idx.rows.map((r) => r.indexname).join(', '))

    console.log('\nDone. Table pay2new_cc_billers is ready.')
  } catch (err) {
    console.error('Migration error:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
})()
