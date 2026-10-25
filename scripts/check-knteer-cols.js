const { Client } = require('pg');
const fs = require('fs');

const envContent = fs.readFileSync('/home/ubuntu/sameday-backend/.env.local', 'utf8');
const dbUrl = envContent.split('\n').find(l => l.startsWith('DATABASE_URL='))?.split('=').slice(1).join('=').trim();

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

client.connect().then(async () => {
  const cols = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'knteer_payout_transactions'
    ORDER BY ordinal_position
  `);
  console.log('Columns:', cols.rows.map(r => r.column_name + ' (' + r.data_type + ')').join('\n'));
  
  // Also get recent rows with all columns
  const r = await client.query(`SELECT * FROM knteer_payout_transactions ORDER BY created_at DESC LIMIT 5`);
  console.log('\nRecent rows:', JSON.stringify(r.rows, null, 2));
  
  await client.end();
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
