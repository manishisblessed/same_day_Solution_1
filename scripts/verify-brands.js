const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const connectionString = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows: [b] } = await client.query(`SELECT id, key FROM brands WHERE key='teachway'`);
    console.log('Brand teachway:', b.id);

    // 1. Guardrail: min < vendor must fail the CHECK constraint.
    let guardrailWorks = false;
    try {
      await client.query(
        `INSERT INTO brand_mdr_rates (brand_id, mdr_value, min_mdr_value, min_amount, max_amount)
         VALUES ($1, 1.50, 1.00, 0, 100000)`,
        [b.id]
      );
    } catch (e) {
      guardrailWorks = /chk_brand_min_vs_vendor/.test(e.message);
    }
    console.log('Guardrail (min < vendor rejected):', guardrailWorks ? 'PASS' : 'FAIL');

    // 2. Valid insert: vendor 1.50, min 1.80 (margin 0.30).
    const { rows: [r] } = await client.query(
      `INSERT INTO brand_mdr_rates (brand_id, provider, mode, min_amount, max_amount, mdr_value, min_mdr_value)
       VALUES ($1, '*', 'CARD', 0, 500000, 1.50, 1.80) RETURNING id, mdr_value, min_mdr_value`,
      [b.id]
    );
    console.log('Valid rate inserted:', r.id, `vendor=${r.mdr_value}% min=${r.min_mdr_value}% margin=${(r.min_mdr_value - r.mdr_value).toFixed(2)}%`);

    // 3. Duplicate exact-band insert must hit the unique index.
    let uniqueWorks = false;
    try {
      await client.query(
        `INSERT INTO brand_mdr_rates (brand_id, provider, mode, min_amount, max_amount, mdr_value, min_mdr_value)
         VALUES ($1, '*', 'CARD', 0, 500000, 1.60, 1.90)`,
        [b.id]
      );
    } catch (e) {
      uniqueWorks = /uq_brand_mdr_dims_band/.test(e.message);
    }
    console.log('Unique dims+band enforced:', uniqueWorks ? 'PASS' : 'FAIL');

    // Cleanup the test rate.
    await client.query(`DELETE FROM brand_mdr_rates WHERE id=$1`, [r.id]);
    console.log('Cleanup done. All checks complete.');
  } finally {
    await client.end();
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
