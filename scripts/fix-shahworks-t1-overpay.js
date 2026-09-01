/**
 * One-off reconciliation: Shah Works partner T+1 over-settlement.
 *
 * Bug: the partner "resume/enable" endpoint never stamped
 * partners.t1_settlement_start_at, so the T+1 cron auto-settled the partner's
 * HISTORICAL backlog (the oldest transactions, ~14 txns / ~₹10L) instead of
 * only the enable-day (31 Aug) transaction. The linked master partner also
 * received an override commission over that whole wrong batch.
 *
 * Intended end state:
 *   - Only the 31 Aug transaction (₹1,202.00) should be settled — to the partner
 *     (net) and to the master partner (override commission).
 *   - Everything captured BEFORE the enable day stays permanently unsettled
 *     (it is settled manually, outside this system).
 *
 * What this script does:
 *   1. Fully REVERSES every currently auto-settled T+1 transaction for the
 *      partner (partner net clawback + master override clawback) and resets
 *      those rows to unsettled.
 *   2. Sets partners.t1_settlement_start_at to the enable day (default: start of
 *      YESTERDAY, IST), so the cron will never again touch the pre-enable
 *      backlog, and only 31 Aug onward is eligible.
 *   3. Previews exactly which unsettled txns WILL settle on the next cron run
 *      (using the same created_at gate the cron uses) — expected: just ₹1,202.
 *
 * It does NOT itself re-settle ₹1,202 (that goes through the real MDR path):
 * after committing, click "Run T+1 Settlement Now" in admin (or wait for the
 * schedule) and only the 31 Aug txn will settle.
 *
 * SAFE BY DEFAULT: dry-run. Pass --commit to apply. Runs in one DB transaction.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL="postgres://..."; node scripts/fix-shahworks-t1-overpay.js
 *   $env:DATABASE_URL="postgres://..."; node scripts/fix-shahworks-t1-overpay.js --commit
 *
 * Options:
 *   --commit                  Apply changes (default: dry-run only)
 *   --partner="Shah Works"    Partner name/business_name to match (ILIKE)
 *   --start-date=2026-08-31   Enable day (IST). Only txns on/after this settle.
 */

const { Client } = require('pg')

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required')
  process.exit(1)
}

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=').replace(/^["']|["']$/g, '') : fallback
}
const COMMIT = process.argv.includes('--commit')
const PARTNER_NAME = arg('partner', 'Shah Works')

// Resolve the enable day as IST (UTC+5:30) midnight → stored as UTC instant.
function istMidnight(dateStr) {
  // dateStr = 'YYYY-MM-DD' in IST. Midnight IST = 18:30 UTC the previous day.
  return new Date(`${dateStr}T00:00:00+05:30`)
}
function yesterdayIstDateStr() {
  const nowIst = new Date(Date.now() + 5.5 * 3600 * 1000)
  nowIst.setUTCDate(nowIst.getUTCDate() - 1)
  return nowIst.toISOString().slice(0, 10)
}
const START_DATE_STR = arg('start-date', yesterdayIstDateStr())
const START_AT = istMidnight(START_DATE_STR)
// Only reverse settlements EXECUTED on/after this instant (partner_auto_settled_at
// and the matching wallet-ledger credit). Defaults to the enable day, which
// excludes any earlier test-era settlements that were already pulled back.
const REVERSE_SINCE_STR = arg('reverse-since', START_DATE_STR)
const REVERSE_SINCE = istMidnight(REVERSE_SINCE_STR)

const money = (n) => `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

async function main() {
  console.log('='.repeat(72))
  console.log(`Shah Works T+1 over-settlement reconciliation ${COMMIT ? '(COMMIT)' : '(DRY-RUN)'}`)
  console.log(`Partner match: "${PARTNER_NAME}"`)
  console.log(`Enable day (start_at): ${START_DATE_STR} IST  →  ${START_AT.toISOString()}`)
  console.log('='.repeat(72))

  const c = new Client({
    connectionString: DB_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false },
  })
  await c.connect()

  try {
    // 1) Resolve the partner.
    const { rows: partners } = await c.query(
      `SELECT id, name, business_name, master_partner_id
         FROM partners
        WHERE business_name ILIKE $1 OR name ILIKE $1
        ORDER BY created_at ASC`,
      [`%${PARTNER_NAME}%`]
    )
    if (partners.length === 0) throw new Error(`No partner matched "${PARTNER_NAME}"`)
    if (partners.length > 1) {
      console.log('Multiple partners matched — refine --partner:')
      partners.forEach((p) => console.log(`  ${p.id}  ${p.business_name || p.name}`))
      throw new Error('Ambiguous partner match')
    }
    const partner = partners[0]
    console.log(`Partner: ${partner.business_name || partner.name}  (${partner.id})`)

    // 2) Resolve the linked master partner (assignment first, then column).
    const { rows: assign } = await c.query(
      `SELECT master_partner_id FROM master_partner_partner_assignments
        WHERE partner_id = $1 AND status = 'active' LIMIT 1`,
      [partner.id]
    )
    const masterId = assign[0]?.master_partner_id || partner.master_partner_id || null
    if (masterId) {
      const { rows: mp } = await c.query(`SELECT business_name, name FROM partners WHERE id = $1`, [masterId])
      console.log(`Master partner: ${mp[0]?.business_name || mp[0]?.name || '(unknown)'}  (${masterId})`)
    } else {
      console.log('Master partner: none linked')
    }

    // 3) Load the wrongly auto-settled T+1 batch (only settlements EXECUTED on/
    //    after REVERSE_SINCE — excludes earlier test-era runs already pulled).
    const { rows: settled } = await c.query(
      `SELECT id, txn_id, amount, gross_amount, created_at, transaction_time,
              partner_net_amount, partner_mdr_amount, partner_auto_settled_at,
              master_partner_commission_credited, master_partner_commission_amount
         FROM razorpay_pos_transactions
        WHERE partner_id = $1
          AND partner_wallet_credited = true
          AND settlement_type = 'T1'
          AND partner_auto_settled_at IS NOT NULL
          AND partner_auto_settled_at >= $2
        ORDER BY COALESCE(transaction_time, created_at) ASC`,
      [partner.id, REVERSE_SINCE.toISOString()]
    )
    console.log(`\nAuto-settled T+1 transactions to REVERSE (settled on/after ${REVERSE_SINCE_STR}): ${settled.length}`)
    const gross = (t) => Number(t.gross_amount ?? t.amount ?? 0)
    settled.forEach((t) =>
      console.log(
        `  ${t.txn_id}  ${money(gross(t))}  net=${money(t.partner_net_amount)}  mcpComm=${money(t.master_partner_commission_amount)}  txn=${new Date(t.transaction_time || t.created_at).toISOString()}  settledAt=${new Date(t.partner_auto_settled_at).toISOString()}`
      )
    )

    // Clawback amounts are taken from the ACTUAL wallet-ledger credits (source of
    // truth for money moved), not the per-txn flags, so we debit exactly what was
    // credited. Scoped to the erroneous batch(es) executed on/after REVERSE_SINCE.
    const { rows: pCred } = await c.query(
      `SELECT COALESCE(SUM(credit), 0) AS total
         FROM partner_wallet_ledger
        WHERE partner_id = $1 AND service_type = 'pos'
          AND reference_id LIKE 'PARTNER-T1-%' AND created_at >= $2`,
      [partner.id, REVERSE_SINCE.toISOString()]
    )
    const partnerClawback = Math.round(Number(pCred[0].total) * 100) / 100
    let masterClawback = 0
    if (masterId) {
      const { rows: mCred } = await c.query(
        `SELECT COALESCE(SUM(credit), 0) AS total
           FROM partner_wallet_ledger
          WHERE partner_id = $1 AND service_type = 'pos_master_override'
            AND reference_id LIKE 'MCP-T1-%' AND created_at >= $2`,
        [masterId, REVERSE_SINCE.toISOString()]
      )
      masterClawback = Math.round(Number(mCred[0].total) * 100) / 100
    }

    // Sanity: ledger clawback should match the sum of per-txn net being reset.
    const flagNet = Math.round(settled.reduce((s, t) => s + (Number(t.partner_net_amount) || 0), 0) * 100) / 100
    if (Math.abs(flagNet - partnerClawback) > 1) {
      console.log(`\n  NOTE: ledger credit (${money(partnerClawback)}) vs sum of reset txn net (${money(flagNet)}) differ by ${money(Math.abs(flagNet - partnerClawback))}. Debiting the LEDGER amount (actual money moved).`)
    }

    // 4) Preview what will settle on the next cron run: unsettled, captured on/
    //    after start_at. The cron gates on created_at, so we preview the same.
    const { rows: willSettle } = await c.query(
      `SELECT txn_id, amount, gross_amount, created_at, transaction_time
         FROM razorpay_pos_transactions
        WHERE partner_id = $1
          AND partner_wallet_credited = false
          AND settlement_type = 'T1'
          AND (display_status ILIKE 'SUCCESS' OR display_status ILIKE 'CAPTURED')
          AND created_at >= $2
        ORDER BY COALESCE(transaction_time, created_at) ASC`,
      [partner.id, START_AT.toISOString()]
    )

    console.log('\n-- PLAN --')
    console.log(`  Reverse ${settled.length} txn(s):`)
    console.log(`    Partner wallet clawback (sum net):        ${money(partnerClawback)}`)
    console.log(`    Master wallet clawback (sum commission):  ${money(masterClawback)}`)
    console.log(`  Set partners.t1_settlement_start_at = ${START_AT.toISOString()}`)
    console.log(`\n  After commit, the NEXT T+1 run will settle ${willSettle.length} txn(s) (created_at >= start_at):`)
    willSettle.forEach((t) =>
      console.log(`    ${t.txn_id}  ${money(gross(t))}  ${new Date(t.transaction_time || t.created_at).toISOString()}`)
    )
    if (willSettle.length !== 1) {
      console.log(`\n  NOTE: expected exactly 1 (the ₹1,202 txn). Got ${willSettle.length}.`)
      console.log(`  If this is wrong, adjust --start-date so only the intended day is on/after it.`)
      console.log(`  (The cron gates on created_at; the UI shows transaction_time — they can differ.)`)
    }

    if (!COMMIT) {
      console.log('\nDRY-RUN complete. Re-run with --commit to apply.')
      return
    }
    if (settled.length === 0) {
      console.log('\nNothing settled to reverse. Only setting start_at.')
    }

    // 5) Apply atomically.
    await c.query('BEGIN')
    const settleDate = new Date().toISOString().split('T')[0]

    if (partnerClawback > 0) {
      await c.query(`SELECT debit_partner_wallet($1, $2::decimal, NULL, $3, $4, $5)`, [
        partner.id,
        partnerClawback,
        `Reversal of over-settled T+1 backlog — ${settled.length} historical txn(s) auto-settled in error before the settlement start date. Net clawed back: ${money(partnerClawback)}.`,
        `REVERSAL-PARTNER-T1-${settleDate}-${partner.id}`,
        'pos_settlement_reversal',
      ])
      console.log(`  \u2713 Debited partner ${money(partnerClawback)}`)
    }
    if (masterId && masterClawback > 0) {
      await c.query(`SELECT debit_partner_wallet($1, $2::decimal, NULL, $3, $4, $5)`, [
        masterId,
        masterClawback,
        `Reversal of over-credited MCP override — ${settled.length} historical txn(s) from partner ${partner.id}. Commission clawed back: ${money(masterClawback)}.`,
        `REVERSAL-MCP-T1-${settleDate}-${masterId}-${partner.id}`,
        'pos_master_override_reversal',
      ])
      console.log(`  \u2713 Debited master ${money(masterClawback)}`)
    }

    if (settled.length > 0) {
      await c.query(
        `UPDATE razorpay_pos_transactions
            SET partner_wallet_credited = false,
                partner_wallet_credit_id = NULL,
                partner_net_amount = NULL,
                partner_mdr_amount = NULL,
                partner_auto_settled_at = NULL,
                master_partner_commission_credited = false,
                master_partner_commission_id = NULL,
                master_partner_commission_amount = NULL,
                master_partner_commission_tds = NULL
          WHERE id = ANY($1::uuid[])`,
        [settled.map((t) => t.id)]
      )
      console.log(`  \u2713 Reset ${settled.length} transaction(s) to unsettled`)
    }

    await c.query(`UPDATE partners SET t1_settlement_start_at = $1 WHERE id = $2`, [START_AT.toISOString(), partner.id])
    console.log(`  \u2713 Set t1_settlement_start_at = ${START_AT.toISOString()}`)

    await c.query('COMMIT')
    console.log('\nCOMMIT successful.')
    console.log('Next: run "Run T+1 Settlement Now" in admin (or wait for schedule) to settle the 31 Aug ₹1,202 txn.')
  } catch (err) {
    try { await c.query('ROLLBACK') } catch { /* not in a txn */ }
    console.error('\nFAILED:', err.message)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
