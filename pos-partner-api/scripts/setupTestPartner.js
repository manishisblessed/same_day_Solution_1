'use strict';

/**
 * Create a test partner and generate API key
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { Pool } = require('pg');
const { generateApiKey, generateApiSecret } = require('../utils/crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function main() {
  try {
    // Step 1: Create partner
    console.log('Step 1: Creating partner...');
    let partnerId;
    
    const insertResult = await pool.query(
      `INSERT INTO partners (name, business_name, email, phone, status)
       VALUES ('Same Day Solution', 'Same Day Solution Pvt Ltd', 'admin@samedaysolution.in', '9999999999', 'active')
       ON CONFLICT DO NOTHING
       RETURNING id, name`
    );

    if (insertResult.rows.length > 0) {
      partnerId = insertResult.rows[0].id;
      console.log(`  Partner created: ${insertResult.rows[0].name} (${partnerId})`);
    } else {
      const existing = await pool.query('SELECT id, name FROM partners WHERE email = $1', ['admin@samedaysolution.in']);
      if (existing.rows.length > 0) {
        partnerId = existing.rows[0].id;
        console.log(`  Partner already exists: ${existing.rows[0].name} (${partnerId})`);
      } else {
        console.error('  Failed to create or find partner');
        process.exit(1);
      }
    }

    // Step 2: Create partner export limit
    console.log('\nStep 2: Setting up export limits...');
    await pool.query(
      `INSERT INTO partner_export_limits (partner_id, daily_limit)
       VALUES ($1, 10)
       ON CONFLICT (partner_id) DO NOTHING`,
      [partnerId]
    );
    console.log('  Export limit set: 10/day');

    // Step 3: Generate API key
    console.log('\nStep 3: Generating API key...');
    const apiKey = generateApiKey('pk_live_');
    const apiSecret = generateApiSecret('sk_live_');

    const keyResult = await pool.query(
      `INSERT INTO partner_api_keys (partner_id, api_key, api_secret, label, permissions)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, api_key, created_at`,
      [partnerId, apiKey, apiSecret, 'Production Key', JSON.stringify(['read', 'export'])]
    );

    console.log('\n' + '='.repeat(60));
    console.log('  SETUP COMPLETE - SAVE THESE CREDENTIALS');
    console.log('='.repeat(60));
    console.log(`  Partner ID : ${partnerId}`);
    console.log(`  Key ID     : ${keyResult.rows[0].id}`);
    console.log(`  API Key    : ${apiKey}`);
    console.log(`  API Secret : ${apiSecret}`);
    console.log('='.repeat(60));
    console.log('  WARNING: Save the Secret now! It cannot be retrieved later.');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

