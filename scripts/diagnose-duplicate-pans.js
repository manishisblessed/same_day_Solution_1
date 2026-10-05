const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.readFileSync(envPath, 'utf8');
const match = env.match(/^DATABASE_URL=(.+)$/m);
if (!match) { console.error('DATABASE_URL not found in .env.local'); process.exit(1); }
const connectionString = match[1].trim();

// Tables that reference a retailer and the column that holds the retailer key.
const USAGE = [
  ['wallets', 'user_id'],
  ['wallet_ledger', 'retailer_id'],
  ['razorpay_pos_transactions', 'retailer_id'],
  ['bbps_transactions', 'retailer_id'],
  ['aeps_transactions', 'retailer_id'],
  ['commissions', 'retailer_id'],
];

async function colExists(client, table, col) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, col]
  );
  return rows.length > 0;
}

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  for (const tbl of ['retailers', 'distributors', 'master_distributors']) {
    const { rows } = await client.query(
      `SELECT pan_number, count(*) AS n FROM ${tbl}
        WHERE pan_number IS NOT NULL AND pan_number <> ''
        GROUP BY pan_number HAVING count(*) > 1`
    );
    if (!rows.length) { console.log(`\n${tbl}: no duplicate PANs`); continue; }
    console.log(`\n${tbl}: ${rows.length} duplicate PAN(s)`);
    for (const r of rows) {
      const { rows: accts } = await client.query(
        `SELECT id, partner_id, name, email, phone, status, created_at
           FROM ${tbl} WHERE pan_number = $1 ORDER BY created_at`,
        [r.pan_number]
      );
      console.log(`\n  PAN ${r.pan_number} (${r.n} accounts):`);
      for (const a of accts) {
        console.log(`    * ${a.partner_id} (uuid ${a.id}) | ${a.name} | ${a.email} | ${a.status} | created ${a.created_at.toISOString?.() || a.created_at}`);
        if (tbl === 'retailers') {
          const keys = [a.partner_id, a.id];
          for (const [ut, col] of USAGE) {
            if (!(await colExists(client, ut, col))) continue;
            const { rows: c } = await client.query(
              `SELECT count(*)::int AS n FROM ${ut} WHERE ${col} = ANY($1::text[])`,
              [keys.map(String)]
            ).catch(() => ({ rows: [{ n: 'n/a' }] }));
            if (c[0].n) console.log(`        ${ut}.${col}: ${c[0].n} rows`);
          }
        }
      }
    }
  }
  await client.end();
})();
