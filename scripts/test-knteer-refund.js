const { Client } = require('pg');
const fs = require('fs');

const envContent = fs.readFileSync('/home/ubuntu/sameday-backend/.env.local', 'utf8');
const dbUrl = envContent.split('\n').find(l => l.startsWith('DATABASE_URL='))?.split('=').slice(1).join('=').trim();
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

client.connect().then(async () => {
  // 1. Check constraints on wallet_ledger
  const constraints = await client.query(`
    SELECT con.conname, con.contype, pg_get_constraintdef(con.oid) as def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'wallet_ledger'
  `);
  console.log('=== wallet_ledger constraints ===');
  console.log(JSON.stringify(constraints.rows, null, 2));

  // 2. Distinct service_type values
  const svctypes = await client.query(`SELECT DISTINCT service_type FROM wallet_ledger ORDER BY 1`);
  console.log('\n=== Distinct service_types ===');
  console.log(svctypes.rows.map(r => r.service_type).join('\n'));

  // 3. Try a dry-run test: call add_ledger_entry with knteer_payout to see if it would fail
  // We use SAVEPOINT to rollback
  await client.query('BEGIN');
  try {
    const r = await client.query(`
      SELECT public.add_ledger_entry(
        'RET35258193', 'retailer', 'primary', 'service',
        'knteer_payout', 'KNTEER_PAYOUT_REFUND',
        15925, 0,
        'TEST_REFUND_DRY_RUN', NULL, 'completed',
        'DRY RUN — testing knteer refund'
      )
    `);
    console.log('\n=== add_ledger_entry dry-run SUCCESS ===', r.rows[0]);
    await client.query('ROLLBACK');
  } catch (e) {
    console.log('\n=== add_ledger_entry dry-run FAILED ===\n', e.message);
    await client.query('ROLLBACK');
  }

  await client.end();
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
