/**
 * Backfill script for Shah Works (pk_live_c72d99cc...) missing POS transactions.
 *
 * 12 transactions from March 31 – April 4, 2026 that were processed on
 * Razorpay POS terminals but not captured by the webhook.
 *
 * Usage:
 *   npx ts-node scripts/backfill-shah-works-transactions.ts
 *
 * Or call the admin API directly:
 *   POST /api/admin/backfill-pos-transactions
 *   (requires admin session cookie)
 *
 * The transaction data below is derived from the partner's receipt records.
 * TIDs 96202858 (MID JBS331, Serial 3170042105) and
 *      96202885 (MID JBS358, Serial 3170041971).
 */

const BACKFILL_TRANSACTIONS = [
  {
    txnId: 'BACKFILL-96202885-20260331-215754',
    tid: '96202885',
    mid: 'JBS358',
    amount: 99253.00,
    status: 'AUTHORIZED',
    rrn: '000000000005',
    authCode: '092248',
    cardLastFour: '7862',
    customerName: 'SHAH/MANISH KUMAR',
    paymentMode: 'CARD',
    deviceSerial: '3170041971',
    txnTime: '2026-03-31T21:57:54.000+05:30',
  },
  {
    txnId: 'BACKFILL-96202858-20260401-194433',
    tid: '96202858',
    mid: 'JBS331',
    amount: 139512.00,
    status: 'AUTHORIZED',
    rrn: '000000000008',
    authCode: '763027',
    cardLastFour: '6010',
    customerName: 'SATYAM VATSA',
    paymentMode: 'CARD',
    deviceSerial: '3170042105',
    txnTime: '2026-04-01T19:44:33.000+05:30',
  },
  {
    txnId: 'BACKFILL-96202858-20260401-194629',
    tid: '96202858',
    mid: 'JBS331',
    amount: 120011.00,
    status: 'AUTHORIZED',
    rrn: '000000000010',
    authCode: '393013',
    cardLastFour: '8304',
    customerName: 'SATYAM VATSA',
    paymentMode: 'CARD',
    deviceSerial: '3170042105',
    txnTime: '2026-04-01T19:46:29.000+05:30',
  },
  {
    txnId: 'BACKFILL-96202858-20260401-194728',
    tid: '96202858',
    mid: 'JBS331',
    amount: 139451.00,
    status: 'AUTHORIZED',
    rrn: '000000000011',
    authCode: '806572',
    cardLastFour: '4741',
    customerName: 'SATYAM',
    paymentMode: 'CARD',
    deviceSerial: '3170042105',
    txnTime: '2026-04-01T19:47:28.000+05:30',
  },
  {
    txnId: 'BACKFILL-96202858-20260401-194833',
    tid: '96202858',
    mid: 'JBS331',
    amount: 100761.00,
    status: 'AUTHORIZED',
    rrn: '000000000012',
    authCode: '015707',
    cardLastFour: '5625',
    customerName: 'SATYAM VATSA',
    paymentMode: 'CARD',
    deviceSerial: '3170042105',
    txnTime: '2026-04-01T19:48:33.000+05:30',
  },
  {
    txnId: 'BACKFILL-96202885-20260401-220413',
    tid: '96202885',
    mid: 'JBS358',
    amount: 118881.00,
    status: 'AUTHORIZED',
    rrn: '000000000009',
    authCode: '011004',
    cardLastFour: '1290',
    customerName: 'MANISH KUMAR SHAH',
    paymentMode: 'CARD',
    deviceSerial: '3170041971',
    txnTime: '2026-04-01T22:04:13.000+05:30',
  },
  {
    txnId: 'BACKFILL-96202885-20260402-210359',
    tid: '96202885',
    mid: 'JBS358',
    amount: 137814.00,
    status: 'AUTHORIZED',
    rrn: '000000000013',
    authCode: '174696',
    cardLastFour: '2015',
    customerName: 'MANISH KUMAR SHAH',
    paymentMode: 'CARD',
    deviceSerial: '3170041971',
    txnTime: '2026-04-02T21:03:59.000+05:30',
  },
  {
    txnId: 'BACKFILL-96202885-20260402-214641',
    tid: '96202885',
    mid: 'JBS358',
    amount: 68102.00,
    status: 'AUTHORIZED',
    rrn: '000000000014',
    authCode: '193547',
    cardLastFour: '2015',
    customerName: 'MANISH KUMAR SHAH',
    paymentMode: 'CARD',
    deviceSerial: '3170041971',
    txnTime: '2026-04-02T21:46:41.000+05:30',
  },
  {
    txnId: 'BACKFILL-96202885-20260403-204824',
    tid: '96202885',
    mid: 'JBS358',
    amount: 28501.00,
    status: 'AUTHORIZED',
    rrn: '000000000018',
    authCode: '028190',
    cardLastFour: '6216',
    customerName: 'MANDEEP SINGH',
    paymentMode: 'CARD',
    deviceSerial: '3170041971',
    txnTime: '2026-04-03T20:48:24.000+05:30',
  },
  {
    txnId: 'BACKFILL-96202885-20260403-205043',
    tid: '96202885',
    mid: 'JBS358',
    amount: 55841.00,
    status: 'AUTHORIZED',
    rrn: '000000000019',
    authCode: '160155',
    cardLastFour: '2015',
    customerName: 'MANISH KUMAR SHAH',
    paymentMode: 'CARD',
    deviceSerial: '3170041971',
    txnTime: '2026-04-03T20:50:43.000+05:30',
  },
  {
    txnId: 'BACKFILL-96202885-20260403-205456',
    tid: '96202885',
    mid: 'JBS358',
    amount: 136401.00,
    status: 'AUTHORIZED',
    rrn: '000000000020',
    authCode: 'X41736',
    cardLastFour: '4968',
    customerName: 'MANISH SHAH',
    paymentMode: 'CARD',
    deviceSerial: '3170041971',
    txnTime: '2026-04-03T20:54:56.000+05:30',
  },
  {
    txnId: 'BACKFILL-96202858-20260404-222428',
    tid: '96202858',
    mid: 'JBS331',
    amount: 56011.00,
    status: 'AUTHORIZED',
    rrn: '000000000016',
    authCode: 'X16431',
    cardLastFour: '4968',
    customerName: 'MANISH SHAH',
    paymentMode: 'CARD',
    deviceSerial: '3170042105',
    txnTime: '2026-04-04T22:24:28.000+05:30',
  },
]

const TOTAL = BACKFILL_TRANSACTIONS.reduce((s, t) => s + t.amount, 0)

async function main() {
  const baseUrl = process.env.BASE_URL || 'https://api.samedaysolution.in'

  console.log('=== Shah Works POS Transaction Backfill ===')
  console.log(`Transactions: ${BACKFILL_TRANSACTIONS.length}`)
  console.log(`Total amount: Rs. ${TOTAL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`)
  console.log(`Target: ${baseUrl}/api/admin/backfill-pos-transactions`)
  console.log('')

  for (const txn of BACKFILL_TRANSACTIONS) {
    console.log(`  ${txn.txnTime.slice(0, 10)}  TID ${txn.tid}  Rs. ${txn.amount.toLocaleString('en-IN').padStart(12)}  ${txn.customerName}`)
  }

  console.log('')
  console.log('To execute, call the admin API endpoint with the transactions array above.')
  console.log('Example curl:')
  console.log(`
  curl -X POST ${baseUrl}/api/admin/backfill-pos-transactions \\
    -H "Content-Type: application/json" \\
    -H "Cookie: <admin-session-cookie>" \\
    -d '${JSON.stringify({ transactions: BACKFILL_TRANSACTIONS })}'
  `)
}

main().catch(console.error)

export { BACKFILL_TRANSACTIONS }
