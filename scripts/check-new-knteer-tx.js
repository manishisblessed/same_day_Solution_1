const { Client } = require('pg');
const fs = require('fs');
const envContent = fs.readFileSync('/home/ubuntu/sameday-backend/.env.local', 'utf8');
const dbUrl = envContent.split('\n').find(l => l.startsWith('DATABASE_URL='))?.split('=').slice(1).join('=').trim();
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
client.connect().then(async () => {
  // Check wallet_ledger transaction_type for recent Knteer debits
  const r = await client.query(`
    SELECT reference_id, transaction_type, service_type, credit, debit, description, created_at
    FROM wallet_ledger
    WHERE service_type = 'knteer_payout' AND debit > 0
    ORDER BY created_at DESC LIMIT 5
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  await client.end();
}).catch(e => { console.error(e.message); process.exit(1); });
