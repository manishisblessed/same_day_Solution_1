const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Load DATABASE_URL from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.readFileSync(envPath, 'utf8');
const match = env.match(/^DATABASE_URL=(.+)$/m);
if (!match) { console.error('DATABASE_URL not found in .env.local'); process.exit(1); }
const connectionString = match[1].trim();

const sqlPath = path.join(__dirname, '..', 'supabase-aeps-partner-roles-migration.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log('Connected. Running migration...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration applied successfully.');

    // Verify the new constraints
    const { rows } = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname IN (
        'wallets_user_role_check',
        'wallet_ledger_user_role_check',
        'aeps_transactions_user_role_check',
        'aeps_settlement_accounts_user_role_check'
      )
      ORDER BY conname;
    `);
    console.log('\nVerified constraints:');
    for (const r of rows) console.log(`- ${r.conname}: ${r.def}`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Migration FAILED:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
