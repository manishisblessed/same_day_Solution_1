'use strict';

/**
 * Generate API Key + Secret for a Partner
 * 
 * Usage:
 *   node scripts/generateApiKey.js <partner_id> [label]
 * 
 * Example:
 *   node scripts/generateApiKey.js "a1b2c3d4-..." "Production Key"
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { Pool } = require('pg');
const { generateApiKey, generateApiSecret } = require('../utils/crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function main() {
  const partnerId = process.argv[2];
  const label = process.argv[3] || 'default';

  if (!partnerId) {
    console.error('Usage: node scripts/generateApiKey.js <partner_id> [label]');
    process.exit(1);
  }

  try {
    // Verify partner exists
    const partnerResult = await pool.query(
      'SELECT id, name, status FROM partners WHERE id = $1',
      [partnerId]
    );

    if (partnerResult.rows.length === 0) {
      console.error(`Partner not found: ${partnerId}`);
      process.exit(1);
    }

    const partner = partnerResult.rows[0];
    console.log(`Partner: ${partner.name} (${partner.status})`);

    // Generate keys
    const apiKey = generateApiKey('pk_live_');
    const apiSecret = generateApiSecret('sk_live_');

    // Insert into database
    const result = await pool.query(
      `INSERT INTO partner_api_keys (partner_id, api_key, api_secret, label, permissions)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, api_key, created_at`,
      [partnerId, apiKey, apiSecret, label, JSON.stringify(['read', 'export'])]
    );

    console.log('\n═══════════════════════════════════════════════════');
    console.log('  API KEY GENERATED SUCCESSFULLY');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Key ID   : ${result.rows[0].id}`);
    console.log(`  API Key  : ${apiKey}`);
    console.log(`  Secret   : ${apiSecret}`);
    console.log(`  Label    : ${label}`);
    console.log('═══════════════════════════════════════════════════');
    console.log('  ⚠️  SAVE THE SECRET NOW! It cannot be retrieved later.');
    console.log('  The partner needs both API Key and Secret for authentication.');
    console.log('═══════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();


