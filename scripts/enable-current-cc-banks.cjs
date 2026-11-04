// Enable all banks currently visible on the Credit Card tab
// (everything NOT in the legacy hardcoded blocklist).
const { Client } = require('pg')

const BLOCKED = [
  'yes bank credit card',
  'rbl bank credit card',
  'kotak mahindra bank credit card',
  'bank of maharashtra credit card',
  'bob credit card',
  'dbs bank credit card',
  'hsbc credit card',
  'hdfc bank pixel credit card',
  'hdfc credit card',
  'saraswat co-operative bank ltd',
]

const client = new Client({
  connectionString: 'postgresql://postgres.ohmvvtnfdvvatgofrzta:Development%400022122025@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
})

;(async () => {
  try {
    await client.connect()

    const { rows: all } = await client.query(
      'SELECT product_code, product_name, enabled FROM pay2new_cc_billers ORDER BY product_name'
    )
    console.log(`Total banks in table: ${all.length}`)

    const toEnable = all.filter(
      (r) => !BLOCKED.includes(r.product_name.toLowerCase())
    )
    const toKeepDisabled = all.filter(
      (r) => BLOCKED.includes(r.product_name.toLowerCase())
    )

    console.log(`\nWill ENABLE (${toEnable.length}):`)
    toEnable.forEach((r) => console.log('  +', r.product_name))

    console.log(`\nWill KEEP DISABLED (${toKeepDisabled.length}):`)
    toKeepDisabled.forEach((r) => console.log('  -', r.product_name))

    const codes = toEnable.map((r) => r.product_code)
    if (codes.length > 0) {
      const res = await client.query(
        `UPDATE pay2new_cc_billers
         SET enabled = TRUE, updated_by = 'migration:seed-current-visible', updated_at = NOW()
         WHERE product_code = ANY($1::text[])`,
        [codes]
      )
      console.log(`\nUpdated ${res.rowCount} rows to enabled = TRUE.`)
    }

    const { rows: stats } = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE enabled) AS enabled,
         COUNT(*) FILTER (WHERE NOT enabled) AS disabled,
         COUNT(*) AS total
       FROM pay2new_cc_billers`
    )
    console.log('\nFinal stats:', stats[0])
  } catch (err) {
    console.error('ERROR:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
})()
