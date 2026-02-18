'use strict';

/**
 * Create Monthly Partition for pos_transactions
 * 
 * Usage:
 *   node scripts/createPartition.js [YYYY] [MM]
 * 
 * Without args, creates the partition for 2 months ahead.
 * 
 * Example:
 *   node scripts/createPartition.js 2027 04
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function main() {
  let year, month;

  if (process.argv[2] && process.argv[3]) {
    year = parseInt(process.argv[2], 10);
    month = parseInt(process.argv[3], 10);
  } else {
    // Default: 2 months from now
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 2);
    year = futureDate.getFullYear();
    month = futureDate.getMonth() + 1;
  }

  const monthStr = String(month).padStart(2, '0');
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthStr = String(nextMonth).padStart(2, '0');

  const partitionName = `pos_transactions_${year}_${monthStr}`;
  const rangeStart = `${year}-${monthStr}-01`;
  const rangeEnd = `${nextYear}-${nextMonthStr}-01`;

  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS ${partitionName}
      PARTITION OF pos_transactions
      FOR VALUES FROM ('${rangeStart}') TO ('${rangeEnd}')
    `;

    await pool.query(sql);
    console.log(`✅ Partition created: ${partitionName}`);
    console.log(`   Range: ${rangeStart} to ${rangeEnd}`);
  } catch (error) {
    if (error.code === '42P07') {
      console.log(`ℹ️  Partition already exists: ${partitionName}`);
    } else {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main();


