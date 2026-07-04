const { Client } = require('pg')
const DB_URL = 'postgresql://postgres.ohmvvtnfdvvatgofrzta:Development%400022122025@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'

async function main() {
  const c = new Client(DB_URL)
  await c.connect()

  const { rows: rates } = await c.query(`
    SELECT mode, card_type, brand_type, retailer_mdr_t1, partner_mdr, status
    FROM scheme_mdr_rates WHERE scheme_id='546d657b-2390-4ae2-897f-a91aeecf4810'
    ORDER BY mode, card_type, brand_type NULLS FIRST`)
  console.log('=== RT PLAN rates ===')
  console.log(JSON.stringify(rates, null, 2))

  const { rows: txns } = await c.query(`
    SELECT txn_id, amount, card_type, card_brand, display_status,
           wallet_credited, settlement_mode, wallet_credit_id, mdr_rate, mdr_scheme_id,
           transaction_time, auto_settled_at
    FROM razorpay_pos_transactions
    WHERE retailer_id='RET94155448' AND card_brand ILIKE 'RUPAY' AND card_type ILIKE 'CREDIT'
    ORDER BY transaction_time DESC`)
  console.log('=== RET94155448 CREDIT RUPAY txns ===')
  console.log(JSON.stringify(txns, null, 2))

  // Any currently-unsettled txn for this retailer?
  const { rows: uns } = await c.query(`
    SELECT txn_id, amount, card_type, card_brand, transaction_time
    FROM razorpay_pos_transactions
    WHERE retailer_id='RET94155448' AND wallet_credited=false AND settlement_mode IS NULL
      AND (display_status ILIKE 'SUCCESS' OR display_status ILIKE 'CAPTURED')
    ORDER BY transaction_time DESC`)
  console.log('=== RET94155448 currently unsettled ===')
  console.log(JSON.stringify(uns, null, 2))

  await c.end()
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
