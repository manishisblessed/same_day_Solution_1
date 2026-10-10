/**
 * Apply the Pay2New reliability-fix migrations (idempotent, each in its own txn):
 *   1) 20261010_0001_pay2new_cooldown_claim.sql    (race-safe cooldown RPC)
 *   2) 20261010_0002_pay2new_webhook_backfill.sql  (pay2new webhook reach)
 *
 * Usage (from app root so .env.local is picked up):
 *   node scripts/run-pay2new-fix-migrations.cjs
 *
 * Env: DATABASE_URL
 */
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(process.cwd(), '.env.local') })
const { Client } = require('pg')

const FILES = [
  'db/migrations/20261010_0001_pay2new_cooldown_claim.sql',
  'db/migrations/20261010_0002_pay2new_webhook_backfill.sql',
]

;(async () => {
  const conn = process.env.DATABASE_URL
  if (!conn) { console.error('DATABASE_URL not set'); process.exit(1) }

  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    for (const rel of FILES) {
      const full = path.join(process.cwd(), rel)
      if (!fs.existsSync(full)) { console.error(`❌ missing ${rel}`); process.exitCode = 1; return }
      const sql = fs.readFileSync(full, 'utf8')
      process.stdout.write(`Applying ${rel} ... `)
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('COMMIT')
        console.log('✅')
      } catch (e) {
        await client.query('ROLLBACK')
        console.log('❌')
        console.error(`   ${e.message}`)
        process.exitCode = 1
        return
      }
    }

    // ── Verify ────────────────────────────────────────────────────────────
    const fn = await client.query(
      `SELECT proname FROM pg_proc WHERE proname = 'pay2new_cooldown_claim'`
    )
    const con = await client.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'partner_webhooks_events_valid'`
    )
    const subs = await client.query(
      `SELECT count(*)::int AS n FROM partner_webhooks WHERE is_active = true AND 'pay2new' = ANY(events)`
    )
    console.log('\n--- Verify ---')
    console.log('pay2new_cooldown_claim fn:', fn.rows.length ? 'present ✅' : 'MISSING ❌')
    console.log('events constraint        :', con.rows[0] ? con.rows[0].def : '(none)')
    console.log('active pay2new webhook subscriptions:', subs.rows[0].n)
    console.log('')
  } finally {
    await client.end()
  }
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1) })
