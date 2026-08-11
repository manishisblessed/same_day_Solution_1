// Apply a .sql migration file inside a single transaction (rolls back on any error).
// Usage (from repo root):  node supabase-migrations/security/run.js <path-to.sql>
const fs = require('fs')
const { getClient } = require('./_db')

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('usage: node run.js <file.sql>')
  const sql = fs.readFileSync(file, 'utf8')
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const res = await client.query(sql)
    await client.query('COMMIT')
    const results = Array.isArray(res) ? res : [res]
    for (const r of results) {
      if (r && r.command === 'SELECT' && r.rows && r.rows.length) {
        console.log(`\n-- SELECT rows (${r.rows.length}) --`)
        console.dir(r.rows, { depth: null, maxArrayLength: null })
      }
    }
    console.log('\nOK: applied', file)
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    console.error('FAILED (rolled back):', e.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main()
