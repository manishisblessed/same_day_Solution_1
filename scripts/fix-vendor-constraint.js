const { Client } = require('pg');

async function run() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres.ohmvvtnfdvvatgofrzta:Development%400022122025@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  
  console.log('Dropping old constraint...');
  await c.query('ALTER TABLE service_vendor_rates DROP CONSTRAINT IF EXISTS service_vendor_rates_service_kind_check');
  
  console.log('Adding updated constraint with SETTLEMENT_1...');
  await c.query(
    "ALTER TABLE service_vendor_rates ADD CONSTRAINT service_vendor_rates_service_kind_check CHECK (service_kind IN ('BBPS','PAYOUT','SETTLEMENT_1'))"
  );
  
  console.log('DONE - constraint updated successfully');
  await c.end();
}

run().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
