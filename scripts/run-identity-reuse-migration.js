const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Load DATABASE_URL from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.readFileSync(envPath, 'utf8');
const match = env.match(/^DATABASE_URL=(.+)$/m);
if (!match) { console.error('DATABASE_URL not found in .env.local'); process.exit(1); }
const connectionString = match[1].trim();

const sqlPath = path.join(__dirname, '..', 'db', 'migrations', '20261003_0001_identity_reuse_multi_role.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log('Connected. Running identity-reuse migration...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration applied successfully.');

    const { rows: tbl } = await client.query(`
      SELECT to_regclass('public.identity_reuse_requests') AS tbl;
    `);
    console.log('\nTable identity_reuse_requests:', tbl[0].tbl || 'MISSING');

    const { rows: idx } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('uq_retailers_pan', 'uq_distributors_pan', 'uq_master_distributors_pan')
      ORDER BY indexname;
    `);
    console.log('Unique PAN indexes:');
    for (const r of idx) console.log(`- ${r.indexname}`);
    if (idx.length !== 3) console.warn('WARNING: expected 3 unique PAN indexes, found', idx.length);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Migration FAILED:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
