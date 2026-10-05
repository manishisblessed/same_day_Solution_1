const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const connectionString = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const revUser = (env.match(/^SUBSCRIPTION_REVENUE_USER_ID=(.+)$/m) || [])[1]?.trim();

const sqlPath = path.join(__dirname, '..', 'db', 'migrations', '20261005_0001_company_revenue_report.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log('Connected. Running company revenue report migration...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration applied successfully.');

    // Smoke-test the function over the full history.
    const { rows } = await client.query(
      `SELECT * FROM get_company_revenue_summary($1, now() - interval '400 days', now(),
         ARRAY['bbps','pay2new','shadval_settlement'])`,
      [revUser]
    );
    console.log('Summary (bbps/pay2new/shadval):', rows);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Migration FAILED:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
