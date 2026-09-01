/**
 * Settle the single eligible Shah Works T+1 transaction (31 Aug, ₹1,202) that
 * the app-side cron is currently unable to process (stuck isRunning on EC2).
 *
 * Faithfully mirrors lib/cron/t1-settlement-cron-partners.ts so the result is
 * identical to the cron and idempotent with it:
 *   - Resolves partner MDR the same way calculatePartnerMDR's fallback does
 *     (scheme_mdr_rates, mode=CARD, partner_mdr not null, merchant_slug NULL).
 *   - Uses the same deterministic reference (PARTNER-T1-<date>-<pid>-<hash>) so a
 *     later cron run hits the duplicate guard and never double-credits.
 *   - Credits the Master Channel Partner override (master_commission_percent,
 *     TDS) with the same MCP-T1 reference, capped at the company margin.
 *
 * Only settles transactions that are STILL pending (partner_wallet_credited=false)
 * and captured on/after the partner's t1_settlement_start_at (the enable-day gate).
 *
 * DRY-RUN by default. Pass --commit to apply.
 */

const { Client } = require('pg')
const { createHash } = require('crypto')

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error('DATABASE_URL required'); process.exit(1) }
const COMMIT = process.argv.includes('--commit')

const P = '078ebf34-5593-47c2-98ff-101e4e275c39' // Shah Works
const money = (n) => `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
const r2 = (n) => Math.round(n * 100) / 100

async function main() {
  console.log(`Settle Shah Works ₹1,202 ${COMMIT ? '(COMMIT)' : '(DRY-RUN)'}`)
  const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const partner = (await c.query('select id, t1_settlement_paused, status, t1_settlement_start_at from partners where id=$1', [P])).rows[0]
    if (partner.t1_settlement_paused || partner.status !== 'active') throw new Error('partner paused/inactive')
    const startAt = partner.t1_settlement_start_at

    // Eligible pending T1 txns (same gate as the cron).
    const cutoff = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
    const { rows: pend } = await c.query(
      `select id, txn_id, amount, gross_amount, payment_mode, card_type, card_brand, merchant_slug, created_at
         from razorpay_pos_transactions
        where partner_id=$1 and settlement_type='T1' and partner_wallet_credited=false
          and (display_status ilike 'SUCCESS' or display_status ilike 'CAPTURED')
          and created_at <= $2 and created_at >= $3
        order by created_at asc`,
      [P, cutoff, startAt]
    )
    console.log(`Eligible txns: ${pend.length}`)
    if (pend.length === 0) { console.log('Nothing to settle.'); return }

    // Resolve partner MDR + master override rate (fallback path).
    const scheme = (await c.query(`select scheme_id from resolve_scheme_for_user($1,'partner','mdr',null,null)`, [P])).rows[0]
    if (!scheme?.scheme_id) throw new Error('no scheme resolved')
    const rate = (await c.query(
      `select partner_mdr, retailer_mdr_t0, master_commission_percent, master_commission_tds_percent
         from scheme_mdr_rates
        where scheme_id=$1 and status='active' and mode='CARD' and partner_mdr is not null and merchant_slug is null
        limit 1`,
      [scheme.scheme_id]
    )).rows[0]
    if (!rate) throw new Error('no CARD partner_mdr rate in scheme')
    const partnerMdrPct = parseFloat(rate.partner_mdr)
    const mcpPct = rate.master_commission_percent != null ? parseFloat(rate.master_commission_percent) : 0
    const mcpTdsPct = rate.master_commission_tds_percent != null ? parseFloat(rate.master_commission_tds_percent) : 2

    // Master partner link.
    const masterId = (await c.query(
      `select master_partner_id from master_partner_partner_assignments where partner_id=$1 and status='active' limit 1`, [P]
    )).rows[0]?.master_partner_id || null

    const items = pend.map((t) => {
      const amt = Number(t.gross_amount ?? t.amount ?? 0)
      const fee = Number(((amt * partnerMdrPct) / 100).toFixed(4))
      const net = Number((amt - fee).toFixed(2))
      let mcpGross = mcpPct > 0 ? r2((amt * mcpPct) / 100) : 0
      if (mcpGross > fee) mcpGross = fee
      const mcpTds = mcpGross > 0 ? r2((mcpGross * mcpTdsPct) / 100) : 0
      const mcpComm = mcpGross > 0 ? r2(mcpGross - mcpTds) : 0
      return { id: t.id, txn_id: t.txn_id, amt, fee, net, mcpComm, mcpTds }
    })
    const totalNet = r2(items.reduce((s, i) => s + i.net, 0))
    const totalMcp = r2(items.reduce((s, i) => s + i.mcpComm, 0))
    const totalMcpTds = r2(items.reduce((s, i) => s + i.mcpTds, 0))

    console.log(`\nPartner MDR: ${partnerMdrPct}%  |  MCP override: ${mcpPct}% (TDS ${mcpTdsPct}%)  |  master: ${masterId || 'none'}`)
    items.forEach((i) => console.log(`  ${i.txn_id}  gross ${money(i.amt)}  fee ${money(i.fee)}  net ${money(i.net)}  mcp ${money(i.mcpComm)}`))
    console.log(`\n  Credit partner: ${money(totalNet)}`)
    console.log(`  Credit master:  ${money(totalMcp)} (TDS ${money(totalMcpTds)})`)

    if (!COMMIT) { console.log('\nDRY-RUN. Re-run with --commit to apply.'); return }

    await c.query('BEGIN')
    // Claim (idempotent).
    const ids = items.map((i) => i.id)
    const claimed = (await c.query(
      `update razorpay_pos_transactions set partner_wallet_credited=true
        where id = any($1::uuid[]) and partner_wallet_credited=false returning id`, [ids]
    )).rows.map((r) => r.id)
    if (claimed.length === 0) { await c.query('ROLLBACK'); console.log('Already claimed by another process. Nothing done.'); return }
    const claimedItems = items.filter((i) => claimed.includes(i.id))
    const claimedNet = r2(claimedItems.reduce((s, i) => s + i.net, 0))

    const settleDate = new Date().toISOString().split('T')[0]
    const batchHash = createHash('sha256').update([...claimed].sort().join(',')).digest('hex').slice(0, 12)
    const pRef = `PARTNER-T1-${settleDate}-${P}-${batchHash}`
    const pDesc = `T+1 Auto Settlement - ${claimedItems.length} txn(s), Net: ${money(claimedNet)}`
    await c.query(`select credit_partner_wallet($1,$2::decimal,$3,$4,'CREDIT','pos')`, [P, claimedNet, pDesc, pRef])
    for (const i of claimedItems) {
      await c.query(
        `update razorpay_pos_transactions
            set partner_mdr_amount=$2, partner_net_amount=$3, partner_auto_settled_at=now(),
                partner_wallet_credit_id=(select id from partner_wallet_ledger where reference_id=$4 and partner_id=$1 limit 1)
          where id=$5`,
        [P, i.fee, i.net, pRef, i.id]
      )
    }
    console.log(`  \u2713 Credited partner ${money(claimedNet)} (ref ${pRef})`)

    // Master override.
    if (masterId && totalMcp > 0) {
      const claimedMcp = r2(claimedItems.reduce((s, i) => s + i.mcpComm, 0))
      const mRef = `MCP-T1-${settleDate}-${masterId}-${batchHash}`
      const mDesc = `Master Channel Partner POS override - ${claimedItems.length} txn(s) from partner ${P}, Net: ${money(claimedMcp)}`
      await c.query(`select credit_partner_wallet($1,$2::decimal,$3,$4,'CREDIT','pos_master_override')`, [masterId, claimedMcp, mDesc, mRef])
      const mcpLedgerId = (await c.query(`select id from partner_wallet_ledger where reference_id=$1 and partner_id=$2 limit 1`, [mRef, masterId])).rows[0]?.id || null
      for (const i of claimedItems) {
        await c.query(
          `update razorpay_pos_transactions
              set master_partner_commission_credited=true, master_partner_commission_id=$1,
                  master_partner_commission_amount=$2, master_partner_commission_tds=$3
            where id=$4`,
          [mcpLedgerId, i.mcpComm, i.mcpTds, i.id]
        )
      }
      console.log(`  \u2713 Credited master ${money(claimedMcp)} (ref ${mRef})`)
    }

    await c.query('COMMIT')
    console.log('\nCOMMIT successful.')
  } catch (e) {
    try { await c.query('ROLLBACK') } catch {}
    console.error('FAILED:', e.message)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1) })
