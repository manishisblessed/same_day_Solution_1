const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const connectionString = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const created = [];
  try {
    // 0. Tables + columns exist.
    const cols = await client.query(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_name IN ('service_vendor_rates','company_mdr_floor')
      ORDER BY table_name, ordinal_position`);
    console.log('service_vendor_rates / company_mdr_floor columns found:', cols.rows.length);
    const bmGst = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name='brand_mdr_rates' AND column_name='gst_inclusive'`);
    console.log('brand_mdr_rates.gst_inclusive present:', bmGst.rowCount ? 'PASS' : 'FAIL');

    // 1. Valid insert: vendor 2.00%, min 2.50% (BBPS, bbps_1).
    const { rows: [r] } = await client.query(
      `INSERT INTO service_vendor_rates (service_kind, scope_key, category, min_amount, max_amount, vendor_rate_type, vendor_rate, min_charge_type, min_charge, gst_inclusive)
       VALUES ('BBPS','bbps_1',NULL,0,500000,'PERCENT',2.00,'PERCENT',2.50,false) RETURNING id`,
      []
    );
    created.push(['service_vendor_rates', r.id]);
    console.log('Valid service vendor rate inserted:', r.id);

    // 2. Overlapping exact-band duplicate must hit the unique index.
    let uniqueWorks = false;
    try {
      await client.query(
        `INSERT INTO service_vendor_rates (service_kind, scope_key, category, min_amount, max_amount, vendor_rate_type, vendor_rate, min_charge_type, min_charge, gst_inclusive)
         VALUES ('BBPS','bbps_1',NULL,0,500000,'PERCENT',2.10,'PERCENT',2.60,false)`,
        []
      );
    } catch (e) {
      uniqueWorks = /uq_service_vendor_rates_dims_band/.test(e.message);
    }
    console.log('Unique dims+band enforced:', uniqueWorks ? 'PASS' : 'FAIL');

    // 3. Floor insert.
    const { rows: [f] } = await client.query(
      `INSERT INTO company_mdr_floor (service_kind, scope_key, min_amount, max_amount, rate_type, floor_value)
       VALUES ('BBPS','*',0,999999999,'PERCENT',1.00) RETURNING id`,
      []
    );
    created.push(['company_mdr_floor', f.id]);
    console.log('Floor inserted:', f.id);

    console.log('All checks complete.');
  } finally {
    for (const [tbl, id] of created) {
      await client.query(`DELETE FROM ${tbl} WHERE id=$1`, [id]).catch(() => {});
    }
    await client.end();
    console.log('Cleanup done.');
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
