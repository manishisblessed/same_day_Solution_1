const { Client } = require('pg');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
c.connect().then(async () => {
  // Get wallet_ledger CHECK constraint definition
  const r = await c.query(`
    SELECT pg_get_constraintdef(oid) AS constraint_def
    FROM pg_constraint
    WHERE conrelid = 'wallet_ledger'::regclass AND contype = 'c' AND conname LIKE '%transaction_type%'
  `);
  console.log('Constraint:', r.rows[0]?.constraint_def);

  // Check add_ledger_entry RPC signature
  const r2 = await c.query(`
    SELECT proname, pg_get_function_arguments(oid) AS args
    FROM pg_proc WHERE proname = 'add_ledger_entry'
  `);
  console.log('RPC:', JSON.stringify(r2.rows[0]?.args?.slice(0,300)));

  // Check if bene reg columns exist on knteer_payout_transactions
  const r3 = await c.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='knteer_payout_transactions' AND column_name IN ('verification_charge','is_new_beneficiary')
  `);
  console.log('Bene charge cols:', r3.rows.map(r=>r.column_name));

  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
