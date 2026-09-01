const { Client } = require('pg')
;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const ids = {
    'Shah Works (partner)': '078ebf34-5593-47c2-98ff-101e4e275c39',
    'grandhr (master)': 'b3d4a601-35ee-441c-9df1-f7eb43d5d61a',
  }
  for (const [label, id] of Object.entries(ids)) {
    const { rows } = await c.query('select balance, is_frozen from partner_wallets where partner_id = $1', [id])
    console.log(label, '->', rows[0] ? `balance ₹${rows[0].balance}, frozen=${rows[0].is_frozen}` : 'NO WALLET')
  }
  await c.end()
})().catch((e) => { console.error(e.message); process.exit(1) })
