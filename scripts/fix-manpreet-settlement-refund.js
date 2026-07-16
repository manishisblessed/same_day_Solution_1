const { Client } = require('pg')

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error('DATABASE_URL environment variable is required'); process.exit(1) }

async function main() {
  const c = new Client(DB_URL)
  await c.connect()

  // Find Manpreet Singh's pending settlement for ₹23,800 (instant)
  const { rows: settlements } = await c.query(`
    SELECT s.id, s.user_id, s.user_role, s.amount, s.charge, s.net_amount,
           s.settlement_mode, s.status, s.ledger_entry_id, s.created_at
    FROM settlements s
    WHERE s.id = '7961f947-3d33-42d1-8aad-c46429830bdb'
    ORDER BY s.created_at DESC
  `)

  if (settlements.length === 0) {
    console.error('No matching pending settlement found for ₹23,800 on 13/7/2026')
    await c.end()
    process.exit(1)
  }

  if (settlements.length > 1) {
    console.warn('Multiple matching settlements found:')
    settlements.forEach(s => console.log(`  ${s.id} | ${s.user_id} | ₹${s.amount} | ${s.status} | ${s.created_at}`))
    console.warn('Using the most recent one.')
  }

  const settlement = settlements[0]
  console.log('\n=== Settlement Found ===')
  console.log(`ID:        ${settlement.id}`)
  console.log(`User ID:   ${settlement.user_id}`)
  console.log(`Role:      ${settlement.user_role}`)
  console.log(`Amount:    ₹${settlement.amount}`)
  console.log(`Charge:    ₹${settlement.charge}`)
  console.log(`Net:       ₹${settlement.net_amount}`)
  console.log(`Mode:      ${settlement.settlement_mode}`)
  console.log(`Status:    ${settlement.status}`)
  console.log(`Created:   ${settlement.created_at}`)

  // Get current wallet balance before refund
  const { rows: [balBefore] } = await c.query(`
    SELECT balance FROM wallets
    WHERE user_id = $1 AND wallet_type = 'primary'
  `, [settlement.user_id])
  console.log(`\nWallet balance before: ₹${balBefore?.balance || 'N/A'}`)

  // Step 1: Update settlement status to 'failed'
  const { rowCount: updated } = await c.query(`
    UPDATE settlements
    SET status = 'failed',
        failure_reason = 'Admin marked as failed - refund processed',
        updated_at = NOW()
    WHERE id = $1 AND status IN ('pending', 'processing')
  `, [settlement.id])

  if (updated === 0) {
    console.error('Failed to update settlement status (may have already been processed)')
    await c.end()
    process.exit(1)
  }
  console.log('\n✓ Settlement status updated to "failed"')

  // Step 2: Credit full amount back to wallet via add_ledger_entry
  const refundAmount = parseFloat(settlement.amount)
  const referenceId = `SETTLEMENT_FAILED_REFUND_${settlement.id}`

  const { rows: [ledgerResult] } = await c.query(`
    SELECT add_ledger_entry(
      p_user_id := $1,
      p_user_role := $2,
      p_wallet_type := 'primary',
      p_fund_category := 'settlement',
      p_service_type := 'settlement',
      p_tx_type := 'REFUND',
      p_credit := $3,
      p_debit := 0,
      p_reference_id := $4,
      p_status := 'completed',
      p_remarks := 'Settlement failed - Admin refund for pending instant settlement'
    )
  `, [settlement.user_id, settlement.user_role, refundAmount, referenceId])

  const reversalLedgerId = ledgerResult?.add_ledger_entry
  console.log(`✓ Wallet refund of ₹${refundAmount} credited (ledger ID: ${reversalLedgerId})`)

  // Update settlement with reversal ledger ID
  await c.query(`
    UPDATE settlements SET reversal_ledger_id = $1 WHERE id = $2
  `, [reversalLedgerId, settlement.id])

  // If original ledger entry exists, mark it completed
  if (settlement.ledger_entry_id) {
    await c.query(`
      UPDATE wallet_ledger SET status = 'completed' WHERE id = $1
    `, [settlement.ledger_entry_id])
    console.log(`✓ Original ledger entry ${settlement.ledger_entry_id} marked completed`)
  }

  // Get balance after
  const { rows: [balAfter] } = await c.query(`
    SELECT balance FROM wallets
    WHERE user_id = $1 AND wallet_type = 'primary'
  `, [settlement.user_id])
  console.log(`\nWallet balance after:  ₹${balAfter?.balance || 'N/A'}`)

  console.log('\n=== Done ===')
  console.log(`Settlement ${settlement.id} → failed`)
  console.log(`₹${refundAmount} refunded to ${settlement.user_id} (${settlement.user_role})`)

  await c.end()
}

main().catch(err => { console.error('Script error:', err); process.exit(1) })
