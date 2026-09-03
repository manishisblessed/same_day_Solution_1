/**
 * Apply the permanent T+1 settlement fixes to the database:
 *  1. Replace backfill_pos_retailer_ids() with the ownership-time-gated version
 *     (from supabase-migrations/fix-device-ownership-time-gate.sql).
 *  3. Stamp t1_settlement_start_at for the two backlog-flooding partners so
 *     their manually-reconciled history is permanently excluded from auto pay
 *     (config only — moves no money). Only sets it where currently NULL.
 *  5. Re-enable partner_t1_cron_settings for monitoring.
 *
 * Usage:  node scripts/apply-permanent-fixes.js            (dry run / report)
 *         node scripts/apply-permanent-fixes.js --commit   (apply)
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const COMMIT = process.argv.includes('--commit')
const FLOODING_PARTNERS = [
  'a7d15a7b-736f-47f2-9e57-0f3bbcf6bb8a', // JMP NEXTGENPAY PRIVATE LIMITED
  '71d4a2b8-848a-4668-9686-1a62dc1ada2c', // PAYMATRIX SOLUTIONS PRIVATE LIMITED
]

// Today 00:00 IST expressed in UTC (IST = UTC+5:30).
function istMidnightTodayUtc() {
  const nowIst = new Date(Date.now() + 5.5 * 3600 * 1000)
  const y = nowIst.getUTCFullYear(), m = nowIst.getUTCMonth(), d = nowIst.getUTCDate()
  return new Date(Date.UTC(y, m, d) - 5.5 * 3600 * 1000)
}

;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = (s, p) => c.query(s, p).then(r => r.rows)

  const startAt = istMidnightTodayUtc().toISOString()
  console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`)
  console.log(`Start date to stamp (today 00:00 IST): ${startAt}\n`)

  console.log('== BEFORE ==')
  console.log('partners:', await q(`select id, name, t1_settlement_start_at, t1_settlement_paused from partners where id = any($1)`, [FLOODING_PARTNERS]))
  console.log('partner_cron enabled:', (await q(`select is_enabled from partner_t1_cron_settings limit 1`))[0])

  if (!COMMIT) {
    console.log('\nDry run — re-run with --commit to apply.')
    await c.end()
    return
  }

  // 1. Backfill RPC (ownership-time gate)
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase-migrations', 'fix-device-ownership-time-gate.sql'), 'utf8')
  await c.query(sql)
  console.log('\n[1] backfill_pos_retailer_ids() replaced with ownership-time-gated version.')

  // 3. Stamp start_at only where NULL (never move an already-set date)
  const upd = await q(
    `update partners set t1_settlement_start_at = $2, updated_at = now()
       where id = any($1) and t1_settlement_start_at is null
     returning id, name, t1_settlement_start_at`,
    [FLOODING_PARTNERS, startAt]
  )
  console.log('[3] start_at stamped for:', upd)

  // 5. Re-enable partner cron settings (monitoring/status)
  await c.query(`update partner_t1_cron_settings set is_enabled = true where id is not null`)
  console.log('[5] partner_t1_cron_settings.is_enabled = true')

  console.log('\n== AFTER ==')
  console.log('partners:', await q(`select id, name, t1_settlement_start_at from partners where id = any($1)`, [FLOODING_PARTNERS]))
  console.log('partner_cron enabled:', (await q(`select is_enabled from partner_t1_cron_settings limit 1`))[0])

  await c.end()
  console.log('\nDone.')
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
