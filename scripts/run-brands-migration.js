const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Load DATABASE_URL from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.readFileSync(envPath, 'utf8');
const match = env.match(/^DATABASE_URL=(.+)$/m);
if (!match) { console.error('DATABASE_URL not found in .env.local'); process.exit(1); }
const connectionString = match[1].trim();

const sqlPath = path.join(__dirname, '..', 'db', 'migrations', '20261003_0002_brands_and_brand_mdr_rates.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log('Connected. Running brands + brand_mdr_rates migration...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration applied successfully.');

    const { rows: tbls } = await client.query(`
      SELECT to_regclass('public.brands') AS brands,
             to_regclass('public.brand_mdr_rates') AS brand_mdr_rates;
    `);
    console.log('\nTables:');
    console.log('- brands:', tbls[0].brands || 'MISSING');
    console.log('- brand_mdr_rates:', tbls[0].brand_mdr_rates || 'MISSING');

    const { rows: col } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'pos_machines' AND column_name = 'brand_id';
    `);
    console.log('- pos_machines.brand_id:', col.length ? 'present' : 'MISSING');

    const { rows: seeded } = await client.query('SELECT key, name FROM brands ORDER BY key;');
    console.log('\nSeeded brands:');
    for (const r of seeded) console.log(`- ${r.key} -> ${r.name}`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Migration FAILED:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
