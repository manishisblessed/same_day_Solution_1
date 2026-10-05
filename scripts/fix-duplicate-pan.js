const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.readFileSync(envPath, 'utf8');
const match = env.match(/^DATABASE_URL=(.+)$/m);
if (!match) { console.error('DATABASE_URL not found in .env.local'); process.exit(1); }
const connectionString = match[1].trim();

// Unused older duplicate retailer (0 transactions) — free up its PAN + suspend.
const PARTNER_ID = 'RET46456414';
const PAN = 'DGAPK9072F';

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows: before } = await client.query(
      `SELECT partner_id, pan_number, status FROM retailers WHERE partner_id = $1`,
      [PARTNER_ID]
    );
    console.log('Before:', before[0]);

    const { rowCount } = await client.query(
      `UPDATE retailers
          SET pan_number = NULL, status = 'suspended', updated_at = now()
        WHERE partner_id = $1 AND pan_number = $2`,
      [PARTNER_ID, PAN]
    );
    console.log(`Updated ${rowCount} row(s).`);

    const { rows: after } = await client.query(
      `SELECT partner_id, pan_number, status FROM retailers WHERE partner_id = $1`,
      [PARTNER_ID]
    );
    console.log('After:', after[0]);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
