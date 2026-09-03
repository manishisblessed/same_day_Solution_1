/**
 * Undo the erroneous 2026-09-03 script settlement of Shah Works and reset state
 * so the 9:00 AM cron can settle Sep-3 naturally, per user's instruction:
 *
 *  - REVERSE the full ₹2,07,452.65 partner credit (ref ...-e46b7e24b141).
 *  - SEP-1 txns (PL_7239391077, PL_7239393596): already paid manually via
 *    ADMIN_PUSH ₹58,615 on 2026-09-02 -> mark settlement_mode='MANUAL' and clear
 *    all partner + master settlement fields so the cron never re-pays them.
 *  - SEP-3 txns (PL_7242621744, PL_7242641731): NOT manually paid -> reset to
 *    pending (partner_wallet_credited=false, settlement_mode=NULL, fields cleared)
 *    so the 9 AM partner cron settles them and credits master fresh.
 *  - CLEAR the master partner wallet completely to ₹0 and reset the
 *    master_partner_commission_* flags on ALL Shah Works txns.
 *
 * DRY-RUN by default. Pass --commit to apply.
 */
const { Client } = require('pg')
const COMMIT = process.argv.includes('--commit')

const P = '078ebf34-5593-47c2-98ff-101e4e275c39'          // Shah Works
const M = 'b3d4a601-35ee-441c-9df1-f7eb43d5d61a'          // master (Manish Kumar Shah)
const MY_CREDIT_REF = 'PARTNER-T1-2026-09-03-078ebf34-5593-47c2-98ff-101e4e275c39-e46b7e24b141'
const SEP1 = ['PL_7239391077', 'PL_7239393596']           // already manually settled
const SEP3 = ['PL_7242621744', 'PL_7242641731']           // reset to pending for 9 AM cron
const money = (n) => `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

const CLEAR_MASTER_FIELDS = `master_partner_commission_credited=false,
  master_partner_commission_id=null, master_partner_commission_amount=null,
  master_partner_commission_tds=null`
const CLEAR_PARTNER_FIELDS = `partner_wallet_credited=false, partner_wallet_credit_id=null,
  partner_net_amount=null, partner_mdr_amount=null, partner_auto_settled_at=null`

;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = (s, p) => c.query(s, p).then(r => r.rows)

  const pBal = Number((await q(`select balance from partner_wallets where partner_id=$1`, [P]))[0].balance)
  const mBal = Number((await q(`select balance from partner_wallets where partner_id=$1`, [M]))[0].balance)
  const myCredit = Number((await q(`select credit from partner_wallet_ledger where reference_id=$1 and partner_id=$2`, [MY_CREDIT_REF, P]))[0]?.credit || 0)

  console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`)
  console.log(`Partner balance now: ${money(pBal)} | reverse my credit: ${money(myCredit)} -> after: ${money(pBal - myCredit)}`)
  console.log(`Master balance now:  ${money(mBal)} -> clear to ₹0.00`)

  console.log('\nSep-3 retailer_id (must be null so retailer cron ignores them):')
  console.log(await q(`select txn_id, tid, retailer_id, wallet_credited, settlement_mode from razorpay_pos_transactions where txn_id = any($1)`, [SEP3]))

  if (!COMMIT) { console.log('\nDRY-RUN. Re-run with --commit.'); await c.end(); return }

  await c.query('BEGIN')

  // 1. Reverse the full partner credit
  await c.query(
    `select debit_partner_wallet($1,$2::decimal,null,$3,$4,'pos_settlement_reversal')`,
    [P, myCredit, `Reversal of duplicate 2026-09-03 auto-settlement (Sep-1 already paid manually; Sep-3 reset for 9 AM cron)`, `REVERSAL-${MY_CREDIT_REF}`]
  )

  // 2. Sep-1 -> MANUAL + clear all settlement fields
  await c.query(
    `update razorpay_pos_transactions
        set settlement_mode='MANUAL', manual_settled_at=now(),
            manual_settlement_note='Settled manually via ADMIN_PUSH ₹58,615 on 2026-09-02 (ref ADMIN_PUSH_1788329551157)',
            ${CLEAR_PARTNER_FIELDS}, ${CLEAR_MASTER_FIELDS}
      where txn_id = any($1)`, [SEP1])

  // 3. Sep-3 -> back to pending (settlement_mode stays NULL) for the 9 AM cron
  await c.query(
    `update razorpay_pos_transactions
        set ${CLEAR_PARTNER_FIELDS}, ${CLEAR_MASTER_FIELDS}
      where txn_id = any($1)`, [SEP3])

  // 4. Clear master wallet completely + reset master flags on ALL Shah Works txns
  const mBalNow = Number((await q(`select balance from partner_wallets where partner_id=$1`, [M]))[0].balance)
  if (mBalNow > 0) {
    await c.query(
      `select debit_partner_wallet($1,$2::decimal,null,$3,$4,'pos_master_override_reversal')`,
      [M, mBalNow, 'Master partner ledger cleared to zero per admin instruction (2026-09-04)', `MASTER-CLEAR-${M}-${Date.now()}`]
    )
  }
  await c.query(
    `update razorpay_pos_transactions set ${CLEAR_MASTER_FIELDS} where partner_id=$1 and master_partner_commission_id is not null`, [P])

  await c.query('COMMIT')

  console.log('\n== AFTER ==')
  console.log('partner balance:', money(Number((await q(`select balance from partner_wallets where partner_id=$1`, [P]))[0].balance)))
  console.log('master balance :', money(Number((await q(`select balance from partner_wallets where partner_id=$1`, [M]))[0].balance)))
  console.log('Sep-1 (MANUAL):', await q(`select txn_id, partner_wallet_credited, settlement_mode from razorpay_pos_transactions where txn_id=any($1)`, [SEP1]))
  console.log('Sep-3 (pending):', await q(`select txn_id, partner_wallet_credited, settlement_mode from razorpay_pos_transactions where txn_id=any($1)`, [SEP3]))
  await c.end()
  console.log('\nDone.')
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
