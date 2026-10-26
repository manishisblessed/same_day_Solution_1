const { Client } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
c.connect().then(async () => {
  // Run the migration
  await c.query(`
    ALTER TABLE knteer_payout_transactions
      ADD COLUMN IF NOT EXISTS verification_charge  NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_new_beneficiary   BOOLEAN       NOT NULL DEFAULT FALSE
  `);
  console.log('Migration done: added verification_charge, is_new_beneficiary to knteer_payout_transactions');

  // Verify
  const r = await c.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='knteer_payout_transactions' AND column_name IN ('verification_charge','is_new_beneficiary')
  `);
  console.log('Verified columns:', r.rows.map(r => r.column_name));
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
