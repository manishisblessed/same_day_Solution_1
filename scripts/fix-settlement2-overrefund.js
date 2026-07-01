const { Client } = require('pg')

const DB_URL = 'postgresql://postgres.ohmvvtnfdvvatgofrzta:Development%400022122025@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'

async function main() {
  const c = new Client(DB_URL)
  await c.connect()

  const { rows: failedTxs } = await c.query(`
    SELECT id, retailer_id, amount, charges, total_debit, reference_id, status, created_at
    FROM shadval_settlement
    WHERE status = 'FAILED'
    ORDER BY created_at DESC
  `)

  let totalOverpaid = 0
  const corrections = []

  for (const tx of failedTxs) {
    const { rows: debits } = await c.query(`
      SELECT debit FROM wallet_ledger
      WHERE retailer_id = $1 AND transaction_type = 'SETTLEMENT2_TRANSFER' AND transaction_id = $2
      ORDER BY created_at ASC LIMIT 1
    `, [tx.retailer_id, tx.id])

    const { rows: refunds } = await c.query(`
      SELECT credit FROM wallet_ledger
      WHERE retailer_id = $1 AND transaction_type = 'SETTLEMENT2_REFUND' AND transaction_id = $2
      ORDER BY created_at ASC LIMIT 1
    `, [tx.retailer_id, tx.id])

    if (debits.length === 0 || refunds.length === 0) continue

    const debitAmount = parseFloat(debits[0].debit)
    const refundAmount = parseFloat(refunds[0].credit)
    const overpaid = Math.round((refundAmount - debitAmount) * 100) / 100

    if (overpaid <= 0) continue

    const { rows: existing } = await c.query(`
      SELECT id FROM wallet_ledger
      WHERE retailer_id = $1 AND reference_id = $2 LIMIT 1
    `, [tx.retailer_id, `ADJ_OVERREFUND_${tx.reference_id}`])

    if (existing.length > 0) {
      console.log(`[SKIP] ${tx.reference_id} — already corrected`)
      continue
    }

    totalOverpaid += overpaid
    corrections.push({
      retailer_id: tx.retailer_id,
      tx_id: tx.id,
      reference_id: tx.reference_id,
      debit_amount: debitAmount,
      refund_amount: refundAmount,
      overpaid,
    })
    console.log(`${tx.reference_id} | ${tx.retailer_id} | Over-refund: ₹${overpaid}`)
  }

  console.log(`\nTotal: ${corrections.length} corrections, ₹${totalOverpaid.toFixed(2)}\n`)

  if (corrections.length === 0) {
    await c.end()
    return
  }

  for (const corr of corrections) {
    try {
      await c.query(`
        SELECT add_ledger_entry(
          $1, 'retailer', 'primary', 'service', 'shadval_settlement',
          'ADJUSTMENT',
          0::decimal, $2::decimal,
          $3, $4::uuid,
          'completed',
          $5
        )
      `, [
        corr.retailer_id,
        corr.overpaid,
        `ADJ_OVERREFUND_${corr.reference_id}`,
        corr.tx_id,
        `Over-refund correction: ₹${corr.overpaid.toFixed(2)} (debited ₹${corr.debit_amount.toFixed(2)}, refunded ₹${corr.refund_amount.toFixed(2)})`,
      ])
      console.log(`  OK ${corr.reference_id} | -₹${corr.overpaid.toFixed(2)} from ${corr.retailer_id}`)
    } catch (e) {
      console.error(`  FAIL ${corr.reference_id}:`, e.message)
    }
  }

  console.log(`\nRecovered ₹${totalOverpaid.toFixed(2)}`)
  await c.end()
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
