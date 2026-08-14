/**
 * READ-ONLY detector for Settlement-2 (Shadval) "double-money" incidents.
 *
 * Finds settlements that were marked FAILED and had the wallet REFUNDED, even
 * though the bank payout may have actually SUCCEEDED (a UTR is present). These
 * are the transactions that cost the company money: the beneficiary received the
 * transfer AND the retailer/partner got their wallet credited back.
 *
 * This script makes NO changes. It only reports candidates so they can be
 * verified against the provider and clawed back.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/find-settlement2-double-money.js
 *   DATABASE_URL=postgres://... node scripts/find-settlement2-double-money.js --days 30
 *
 * Recommended follow-up for each flagged reference_id:
 *   1) Confirm with the provider it is a genuine SUCCESS (has UTR).
 *      Admin API: POST /api/admin/reversal/shadval-refund
 *                 { "identifiers": ["<ref>"], "dryRun": true, "verifyProvider": true }
 *      A "reconciled_success" result == provider confirms money left == double-money.
 *   2) Claw back the wrong refund with an ADJUSTMENT debit for the refunded amount.
 */
const { Client } = require('pg')

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

const daysArgIdx = process.argv.indexOf('--days')
const DAYS = daysArgIdx > -1 ? parseInt(process.argv[daysArgIdx + 1], 10) || 90 : 90

async function main() {
  const c = new Client(DB_URL)
  await c.connect()

  // FAILED settlements within the window that ALSO have a refund credit in either
  // the retailer ledger (wallet_ledger) or the partner ledger (partner_wallet_ledger),
  // keyed by the canonical or legacy timeout refund reference.
  const { rows } = await c.query(
    `
    WITH failed AS (
      SELECT id, retailer_id, reference_id, amount, charges, total_debit,
             actual_wallet_debit, utr, order_id, status, status_message, created_at
      FROM shadval_settlement
      WHERE status = 'FAILED'
        AND created_at >= NOW() - ($1 || ' days')::interval
    )
    SELECT f.*,
           COALESCE(rl.credit, pl.credit) AS refund_credit,
           CASE WHEN rl.id IS NOT NULL THEN 'retailer'
                WHEN pl.id IS NOT NULL THEN 'partner'
                ELSE NULL END AS refund_wallet
    FROM failed f
    LEFT JOIN LATERAL (
      SELECT id, credit FROM wallet_ledger
      WHERE retailer_id = f.retailer_id
        AND reference_id IN ('REFUND_' || f.reference_id, 'REFUND_TIMEOUT_' || f.reference_id)
        AND credit > 0
      LIMIT 1
    ) rl ON TRUE
    LEFT JOIN LATERAL (
      SELECT id, credit FROM partner_wallet_ledger
      WHERE partner_id::text = f.retailer_id
        AND reference_id IN ('REFUND_' || f.reference_id, 'REFUND_TIMEOUT_' || f.reference_id)
        AND credit > 0
      LIMIT 1
    ) pl ON TRUE
    WHERE rl.id IS NOT NULL OR pl.id IS NOT NULL
    ORDER BY f.created_at DESC
    `,
    [String(DAYS)]
  )

  const money = (v) => `₹${parseFloat(v || 0).toFixed(2)}`
  const sumOf = (arr) => arr.reduce((s, r) => s + parseFloat(r.refund_credit || 0), 0)

  // A refunded payout that ACTUALLY LEFT the bank leaves one of two fingerprints:
  //   1. a UTR on the settlement row, OR
  //   2. a provider message that says the transfer was initiated / succeeded.
  // NOTE: the real-world incidents had status_message "Bank Transfer Initiated
  // Successfully" with NO UTR — so message matching is essential, UTR alone misses them.
  const looksPaidOut = (r) => {
    const m = (r.status_message || '').toLowerCase()
    const hasUtr = !!(r.utr && String(r.utr).trim())
    const saysInitiated = m.includes('initiat') || (m.includes('success') && !m.includes('could not') && !m.includes('unsuccess'))
    return hasUtr || saysInitiated
  }

  const highRisk = rows.filter(looksPaidOut)
  const other = rows.filter((r) => !looksPaidOut(r))

  console.log(`\nSettlement-2 refunded-FAILED settlements in last ${DAYS} days: ${rows.length} (${money(sumOf(rows))})`)
  console.log(`  ⚠️  HIGH RISK — provider indicates payout LEFT (UTR or "initiated/success" msg): ${highRisk.length} (${money(sumOf(highRisk))})`)
  console.log(`      other (message suggests a genuine failure — still verify): ${other.length} (${money(sumOf(other))})`)

  // Breakdown by provider message so genuine failures (invalid IFSC, service
  // down, limits) are easy to separate from real losses.
  const byMsg = new Map()
  for (const r of rows) {
    const key = (r.status_message || '').replace(/\s*\[Wallet refunded[^\]]*\]\s*$/i, '').trim() || '(blank)'
    const cur = byMsg.get(key) || { cnt: 0, sum: 0 }
    cur.cnt++
    cur.sum += parseFloat(r.refund_credit || 0)
    byMsg.set(key, cur)
  }
  console.log('\n=== Breakdown by provider message (count | refunded) ===')
  for (const [msg, v] of [...byMsg.entries()].sort((a, b) => b[1].sum - a[1].sum)) {
    console.log(`${String(v.cnt).padStart(5)} | ${money(v.sum).padStart(16)} | ${msg}`)
  }

  if (highRisk.length > 0) {
    console.log('\n=== HIGH RISK — verify against provider (from a whitelisted server) then claw back ===')
    for (const r of highRisk) {
      console.log(
        `${r.reference_id} | ${r.refund_wallet} ${r.retailer_id} | refunded ${money(r.refund_credit)} | utr=${r.utr || '-'} | order=${r.order_id || '-'} | ${new Date(r.created_at).toISOString()} | "${r.status_message}"`
      )
    }
    console.log('\nreference_ids for the admin reversal dry-run (verifyProvider=true):')
    console.log(highRisk.map((r) => r.reference_id).join('\n'))
  }

  console.log('\nThis was a READ-ONLY report. No records were changed.')
  await c.end()
}

main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
