const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const connectionString = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const revUser = (env.match(/^SUBSCRIPTION_REVENUE_USER_ID=(.+)$/m) || [])[1]?.trim();

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    // 1. Central vendor rates configured?
    const svr = await client.query(
      `SELECT service_kind, count(*) FILTER (WHERE active) AS active_rows
       FROM service_vendor_rates GROUP BY service_kind ORDER BY service_kind`
    );
    console.log('service_vendor_rates (active):', svr.rows.length ? svr.rows : 'NONE');

    // 2. BBPS scheme slabs: how many carry a company_charge (vendor cost basis)?
    const bbps = await client.query(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE COALESCE(company_charge,0) > 0) AS with_cost,
              count(*) FILTER (WHERE COALESCE(md_purchase_charge,0) > 0) AS charge_model
       FROM scheme_bbps_commissions WHERE status='active'`
    );
    console.log('scheme_bbps_commissions:', bbps.rows[0]);

    // 3. Settlement-2 (shadval) slabs with charge model?
    const shad = await client.query(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE COALESCE(company_charge,0) > 0) AS with_cost,
              count(*) FILTER (WHERE COALESCE(md_purchase_charge,0) > 0) AS charge_model
       FROM scheme_shadval_settlement_charges WHERE status='active'`
    ).catch((e) => ({ rows: [{ note: e.message }] }));
    console.log('scheme_shadval_settlement_charges:', shad.rows[0]);

    // 4. Is revenue actually being booked? COMPANY_REVENUE ledger by service.
    const rev = await client.query(
      `SELECT service_type, count(*) AS txns, round(sum(credit)::numeric,2) AS total_revenue,
              min(created_at)::date AS first, max(created_at)::date AS last
       FROM wallet_ledger
       WHERE tx_type='COMPANY_REVENUE'
       GROUP BY service_type ORDER BY total_revenue DESC NULLS LAST`
    );
    console.log('COMPANY_REVENUE by service:', rev.rows.length ? rev.rows : 'NONE BOOKED YET');

    // 5. Revenue wallet user exists?
    if (revUser) {
      const u = await client.query(
        `SELECT 'retailers' tbl, count(*) n FROM retailers WHERE partner_id=$1
         UNION ALL SELECT 'distributors', count(*) FROM distributors WHERE partner_id=$1
         UNION ALL SELECT 'master_distributors', count(*) FROM master_distributors WHERE partner_id=$1`,
        [revUser]
      ).catch((e) => ({ rows: [{ tbl: 'err', n: e.message }] }));
      console.log(`Revenue user "${revUser}" presence:`, u.rows);
    }
  } finally {
    await client.end();
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
