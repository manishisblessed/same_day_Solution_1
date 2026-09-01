const { Client } = require('pg')
;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const ids = {
    'Shah Works (partner)': '078ebf34-5593-47c2-98ff-101e4e275c39',
    'grandhr (master)': 'b3d4a601-35ee-441c-9df1-f7eb43d5d61a',
  }
  for (const [label, id] of Object.entries(ids)) {
    console.log('\n===== ' + label + ' =====')
    const { rows } = await c.query(
      `select created_at, transaction_type, credit, debit, closing_balance, service_type, reference_id, left(description,80) as description
         from partner_wallet_ledger where partner_id = $1 order by created_at asc`,
      [id]
    )
    rows.forEach((r) =>
      console.log(
        `${new Date(r.created_at).toISOString()} | ${r.transaction_type} | +${r.credit} -${r.debit} | bal ${r.closing_balance} | ${r.service_type || ''} | ${r.reference_id || ''} | ${r.description || ''}`
      )
    )
    const { rows: agg } = await c.query(
      `select coalesce(sum(credit),0) as tot_credit, coalesce(sum(debit),0) as tot_debit, count(*) as n
         from partner_wallet_ledger where partner_id = $1`,
      [id]
    )
    console.log(`TOTno rows=${agg[0].n}, credits=₹${agg[0].tot_credit}, debits=₹${agg[0].tot_debit}`)
  }
  await c.end()
})().catch((e) => { console.error(e.message); process.exit(1) })
