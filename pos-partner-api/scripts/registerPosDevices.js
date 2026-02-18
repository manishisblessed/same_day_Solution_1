'use strict';

/**
 * Register POS devices from existing pos_device_mapping table
 * into the Partner API system (partner_retailers + partner_pos_machines).
 * 
 * Steps:
 *   1. Query existing pos_device_mapping to find all active POS devices
 *   2. Query razorpay_pos_transactions for recent txn details (tid, device_serial)
 *   3. Create retailer entries in partner_retailers
 *   4. Register POS machines in partner_pos_machines
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const PARTNER_ID = 'fede1413-5fd4-486b-af0a-e2c09184e3c2'; // Same Day Solution

async function main() {
  try {
    console.log('='.repeat(60));
    console.log('  POS Device Registration for Partner API');
    console.log('='.repeat(60));

    // ========================================================
    // Step 1: Discover existing POS devices
    // ========================================================
    console.log('\n[Step 1] Querying existing pos_device_mapping...\n');

    const deviceMappings = await pool.query(`
      SELECT device_serial, tid, retailer_id, distributor_id, 
             master_distributor_id, status
      FROM pos_device_mapping
      WHERE status = 'ACTIVE'
      ORDER BY created_at
    `);

    if (deviceMappings.rows.length === 0) {
      console.log('  No active POS devices found in pos_device_mapping.');
      console.log('  Checking razorpay_pos_transactions for device info...\n');
    } else {
      console.log(`  Found ${deviceMappings.rows.length} active POS device(s):\n`);
      deviceMappings.rows.forEach((d, i) => {
        console.log(`  Device ${i + 1}:`);
        console.log(`    device_serial  : ${d.device_serial}`);
        console.log(`    tid            : ${d.tid || 'N/A'}`);
        console.log(`    retailer_id    : ${d.retailer_id || 'N/A'}`);
        console.log(`    distributor_id : ${d.distributor_id || 'N/A'}`);
        console.log(`    status         : ${d.status}`);
        console.log('');
      });
    }

    // ========================================================
    // Step 2: Get recent transaction details for TID extraction
    // ========================================================
    console.log('[Step 2] Querying recent POS transactions for TID info...\n');

    const recentTxns = await pool.query(`
      SELECT DISTINCT ON (device_serial, tid) 
        txn_id, device_serial, tid, amount, status, payment_mode,
        transaction_time
      FROM razorpay_pos_transactions
      WHERE device_serial IS NOT NULL
        AND tid IS NOT NULL
      ORDER BY device_serial, tid, transaction_time DESC
      LIMIT 20
    `);

    if (recentTxns.rows.length > 0) {
      console.log(`  Found ${recentTxns.rows.length} unique device/TID combination(s):\n`);
      recentTxns.rows.forEach((t, i) => {
        console.log(`  Terminal ${i + 1}:`);
        console.log(`    TID            : ${t.tid}`);
        console.log(`    device_serial  : ${t.device_serial}`);
        console.log(`    last txn       : ${t.txn_id}`);
        console.log(`    amount         : ${t.amount}`);
        console.log(`    status         : ${t.status}`);
        console.log(`    time           : ${t.transaction_time}`);
        console.log('');
      });
    } else {
      console.log('  No recent POS transactions found.\n');
    }

    // ========================================================
    // Step 3: Register devices in Partner API system
    // ========================================================
    
    // Collect all unique devices
    const devicesToRegister = new Map();
    
    // From device mappings
    for (const d of deviceMappings.rows) {
      if (d.device_serial) {
        devicesToRegister.set(d.device_serial, {
          device_serial: d.device_serial,
          tid: d.tid,
          retailer_id: d.retailer_id,
        });
      }
    }

    // From recent transactions (fill in missing TIDs)
    for (const t of recentTxns.rows) {
      if (t.device_serial && t.tid) {
        const existing = devicesToRegister.get(t.device_serial);
        if (existing) {
          // Fill in TID if missing
          if (!existing.tid) existing.tid = t.tid;
        } else {
          devicesToRegister.set(t.device_serial, {
            device_serial: t.device_serial,
            tid: t.tid,
            retailer_id: null,
          });
        }
      }
    }

    if (devicesToRegister.size === 0) {
      console.log('[Step 3] No devices to register. Exiting.\n');
      return;
    }

    console.log(`[Step 3] Registering ${devicesToRegister.size} device(s) in Partner API...\n`);

    // Create a default retailer for the partner
    console.log('  Creating default retailer...');
    const retailerResult = await pool.query(`
      INSERT INTO partner_retailers (partner_id, retailer_code, name, business_name, status)
      VALUES ($1, 'RET-001', 'Default Retailer', 'Same Day Solution Retail', 'active')
      ON CONFLICT (partner_id, retailer_code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, retailer_code, name
    `, [PARTNER_ID]);

    const retailer = retailerResult.rows[0];
    console.log(`  Retailer: ${retailer.name} (${retailer.retailer_code}) → ${retailer.id}\n`);

    // Register each POS machine
    let registered = 0;
    let skipped = 0;

    for (const [serial, device] of devicesToRegister) {
      if (!device.tid) {
        console.log(`  ⚠ Skipping device ${serial} - no TID found`);
        skipped++;
        continue;
      }

      try {
        const machineResult = await pool.query(`
          INSERT INTO partner_pos_machines (partner_id, retailer_id, terminal_id, device_serial, machine_model, status, activated_at)
          VALUES ($1, $2, $3, $4, 'Razorpay POS', 'active', NOW())
          ON CONFLICT (terminal_id) DO UPDATE SET 
            device_serial = EXCLUDED.device_serial,
            status = 'active',
            updated_at = NOW()
          RETURNING id, terminal_id, device_serial
        `, [PARTNER_ID, retailer.id, device.tid, serial]);

        const machine = machineResult.rows[0];
        console.log(`  ✅ Registered: TID=${machine.terminal_id}, Serial=${machine.device_serial} → ${machine.id}`);
        registered++;
      } catch (err) {
        console.log(`  ❌ Failed to register TID=${device.tid}, Serial=${serial}: ${err.message}`);
      }
    }

    console.log(`\n  Result: ${registered} registered, ${skipped} skipped\n`);

    // ========================================================
    // Step 4: Verification
    // ========================================================
    console.log('[Step 4] Verification - Current Partner API setup:\n');

    const partnersResult = await pool.query(`
      SELECT id, name, status FROM partners WHERE id = $1
    `, [PARTNER_ID]);
    console.log(`  Partner: ${partnersResult.rows[0]?.name} (${partnersResult.rows[0]?.status})`);

    const retailersResult = await pool.query(`
      SELECT id, retailer_code, name, status FROM partner_retailers WHERE partner_id = $1
    `, [PARTNER_ID]);
    console.log(`  Retailers: ${retailersResult.rows.length}`);
    retailersResult.rows.forEach(r => {
      console.log(`    - ${r.retailer_code}: ${r.name} (${r.status})`);
    });

    const machinesResult = await pool.query(`
      SELECT id, terminal_id, device_serial, status FROM partner_pos_machines WHERE partner_id = $1
    `, [PARTNER_ID]);
    console.log(`  POS Machines: ${machinesResult.rows.length}`);
    machinesResult.rows.forEach(m => {
      console.log(`    - TID: ${m.terminal_id}, Serial: ${m.device_serial} (${m.status})`);
    });

    const apiKeysResult = await pool.query(`
      SELECT id, api_key, label, is_active FROM partner_api_keys WHERE partner_id = $1
    `, [PARTNER_ID]);
    console.log(`  API Keys: ${apiKeysResult.rows.length}`);
    apiKeysResult.rows.forEach(k => {
      console.log(`    - ${k.api_key.substring(0, 20)}... (${k.is_active ? 'active' : 'inactive'})`);
    });

    const txnCount = await pool.query(`
      SELECT COUNT(*) as cnt FROM pos_transactions WHERE partner_id = $1
    `, [PARTNER_ID]);
    console.log(`  Transactions in pos_transactions: ${txnCount.rows[0].cnt}`);

    console.log('\n' + '='.repeat(60));
    console.log('  SETUP COMPLETE');
    console.log('='.repeat(60));
    console.log('\n  Next real POS transactions on registered terminals will');
    console.log('  automatically appear in the Partner API!\n');

  } catch (error) {
    console.error('Error:', error.message);
    if (error.detail) console.error('Detail:', error.detail);
  } finally {
    await pool.end();
  }
}

main();

