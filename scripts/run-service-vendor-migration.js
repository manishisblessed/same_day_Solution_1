const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const connectionString = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const sqlPath = path.join(__dirname, '..', 'db', 'migrations', '20261003_0003_service_vendor_rates_and_gst.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log('Connected. Running service_vendor_rates + GST migration...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration applied successfully.');

    const { rows } = await client.query(`
      SELECT to_regclass('public.service_vendor_rates') AS svr,
             to_regclass('public.company_mdr_floor') AS cmf;
    `);
    console.log('- service_vendor_rates:', rows[0].svr || 'MISSING');
    console.log('- company_mdr_floor:', rows[0].cmf || 'MISSING');

    const { rows: col } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='brand_mdr_rates' AND column_name='gst_inclusive';
    `);
    console.log('- brand_mdr_rates.gst_inclusive:', col.length ? 'present' : 'MISSING');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Migration FAILED:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
