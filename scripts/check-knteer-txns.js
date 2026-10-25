const { Client } = require('pg');
const fs = require('fs');

const envContent = fs.readFileSync('/home/ubuntu/sameday-backend/.env.local', 'utf8');
const dbUrl = envContent.split('\n').find(l => l.startsWith('DATABASE_URL='))?.split('=').slice(1).join('=').trim();

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

client.connect().then(async () => {
  // Search by reference_id and partner_trans_id
  const r = await client.query(`
    SELECT id, retailer_id, status, amount, partner_trans_id, reference_id,
           provider_ref, provider_status, created_at, updated_at, is_refunded
    FROM knteer_payout_transactions
    WHERE reference_id ILIKE ANY(ARRAY['%9995331665%','%1640372527%'])
       OR partner_trans_id ILIKE ANY(ARRAY['%9995331665%','%1640372527%'])
    ORDER BY created_at DESC
  `);
  
  if (r.rows.length === 0) {
    console.log('No rows found. Trying broader search...');
    // Check all recent transactions
    const r2 = await client.query(`
      SELECT id, retailer_id, status, amount, partner_trans_id, reference_id,
             provider_ref, provider_status, created_at
      FROM knteer_payout_transactions
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 20
    `);
    console.log('Recent 24h transactions:');
    console.log(JSON.stringify(r2.rows, null, 2));
  } else {
    console.log('Found transactions:');
    console.log(JSON.stringify(r.rows, null, 2));
  }
  
  await client.end();
}).catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
