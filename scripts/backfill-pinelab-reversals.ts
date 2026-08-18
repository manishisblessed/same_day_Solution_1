/**
 * Runner for the Pine Labs reversal backfill.
 *
 * Re-pulls a Pine Labs window and reinstates/marks any voided-reversed-refunded
 * transactions that the old sync had hard-deleted, then (optionally) notifies
 * partners. Writes a CSV report next to this script.
 *
 * Usage:
 *   # 1) DRY RUN first (no writes, no webhooks) — inspect the CSV:
 *   npx tsx scripts/backfill-pinelab-reversals.ts --merchant=<slug> --from=2026-02-01 --to=2026-02-28
 *
 *   # 2) Apply DB changes only (still no webhooks):
 *   npx tsx scripts/backfill-pinelab-reversals.ts --merchant=<slug> --from=... --to=... --apply
 *
 *   # 3) Apply + notify partners:
 *   npx tsx scripts/backfill-pinelab-reversals.ts --merchant=<slug> --from=... --to=... --apply --emit
 *
 *   # Restrict to specific raw Pine Labs ids (e.g. the nextgen txn 7211256230):
 *   npx tsx scripts/backfill-pinelab-reversals.ts --merchant=<slug> --from=... --to=... --ids=7211256230
 *
 * Env required: BASE_URL (default https://api.samedaysolution.in), CRON_SECRET.
 */
import * as fs from 'fs'
import * as path from 'path'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local' })
loadEnv()

function arg(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const baseUrl = process.env.BASE_URL || 'https://api.samedaysolution.in'
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) throw new Error('CRON_SECRET not set in environment')

  const merchant = arg('merchant')
  const fromDate = arg('from')
  const toDate = arg('to')
  if (!merchant || !fromDate || !toDate) {
    throw new Error('Required: --merchant=<slug> --from=YYYY-MM-DD --to=YYYY-MM-DD')
  }

  const idsArg = arg('ids')
  const payload = {
    merchant,
    fromDate,
    toDate,
    dryRun: !flag('apply'),
    emitWebhooks: flag('emit'),
    txnIds: idsArg ? idsArg.split(',').map(s => s.trim()).filter(Boolean) : undefined,
  }

  console.log('=== Pine Labs Reversal Backfill ===')
  console.log(`Target:   ${baseUrl}/api/admin/backfill-pinelab-reversals`)
  console.log(`Merchant: ${merchant}  Window: ${fromDate} → ${toDate}`)
  console.log(`Mode:     ${payload.dryRun ? 'DRY RUN' : 'APPLY'}${payload.emitWebhooks ? ' + EMIT WEBHOOKS' : ''}`)
  if (payload.txnIds) console.log(`Ids:      ${payload.txnIds.join(', ')}`)
  console.log('')

  const res = await fetch(`${baseUrl}/api/admin/backfill-pinelab-reversals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
    body: JSON.stringify(payload),
  })

  const json: any = await res.json()
  if (!res.ok) {
    console.error('Backfill failed:', json)
    process.exit(1)
  }

  console.log('Summary:', JSON.stringify(json.summary, null, 2))

  if (json.csv) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outPath = path.join(process.cwd(), `pinelab-reversals-${merchant}-${stamp}.csv`)
    fs.writeFileSync(outPath, json.csv)
    console.log(`\nCSV report written: ${outPath}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
