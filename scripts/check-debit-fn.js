const { Client } = require('pg');
const fs = require('fs');
const envContent = fs.readFileSync('/home/ubuntu/sameday-backend/.env.local', 'utf8');
const dbUrl = envContent.split('\n').find(l => l.startsWith('DATABASE_URL='))?.split('=').slice(1).join('=').trim();
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
client.connect().then(async () => {
  const r = await client.query(`
    SELECT pg_get_functiondef(oid) as body FROM pg_proc WHERE proname = 'debit_wallet_bbps' LIMIT 1
  `);
  console.log(r.rows[0]?.body?.slice(0, 800) || 'not found');
  await client.end();
}).catch(e => { console.error(e.message); process.exit(1); });
