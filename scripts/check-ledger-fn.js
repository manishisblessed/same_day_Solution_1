const { Client } = require('pg');
const fs = require('fs');

const envContent = fs.readFileSync('/home/ubuntu/sameday-backend/.env.local', 'utf8');
const dbUrl = envContent.split('\n').find(l => l.startsWith('DATABASE_URL='))?.split('=').slice(1).join('=').trim();

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

client.connect().then(async () => {
  // Get add_ledger_entry function body to check for constraints
  const fn = await client.query(`
    SELECT pg_get_functiondef(oid) as body
    FROM pg_proc
    WHERE proname = 'add_ledger_entry'
    LIMIT 1
  `);
  console.log('=== add_ledger_entry body ===');
  console.log(fn.rows[0]?.body || 'NOT FOUND');

  // Also check distinct transaction_types in wallet_ledger
  const types = await client.query(`
    SELECT DISTINCT transaction_type, count(*) 
    FROM wallet_ledger 
    WHERE retailer_id = 'RET35258193'
    GROUP BY transaction_type
    ORDER BY count DESC
  `);
  console.log('\n=== Transaction types for RET35258193 ===');
  console.log(JSON.stringify(types.rows, null, 2));

  await client.end();
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
