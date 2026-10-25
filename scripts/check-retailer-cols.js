const { Client } = require('pg');
const fs = require('fs');
const envContent = fs.readFileSync('/home/ubuntu/sameday-backend/.env.local', 'utf8');
const dbUrl = envContent.split('\n').find(l => l.startsWith('DATABASE_URL='))?.split('=').slice(1).join('=').trim();
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
client.connect().then(async () => {
  const r = await client.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'retailers' ORDER BY ordinal_position
  `);
  console.log(r.rows.map(c => c.column_name + ' (' + c.data_type + ')').join('\n'));
  await client.end();
}).catch(e => { console.error(e.message); process.exit(1); });
