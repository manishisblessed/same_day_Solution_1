/**
 * Reverse commissions for 1640372527 — transaction never processed at Knteer.
 * Mirrors reverseServiceCommission() logic.
 */
const { Client } = require('pg');
const fs = require('fs');

const envContent = fs.readFileSync('/home/ubuntu/sameday-backend/.env.local', 'utf8');
const dbUrl = envContent.split('\n').find(l => l.startsWith('DATABASE_URL='))?.split('=').slice(1).join('=').trim();
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

const TX_UUID = 'e92180cf-14c5-4210-97d7-9e62782b80fd'; // knteer_payout_transactions.id

async function reverseRef(ref, fund) {
  // Find existing credit entries for this ref
  const { rows: entries } = await client.query(`
    SELECT id, retailer_id, user_role, wallet_type, credit
    FROM wallet_ledger
    WHERE reference_id = $1 AND credit > 0
  `, [ref]);

  if (entries.length === 0) {
    console.log(`  No entry found for ${ref} — skipping`);
    return;
  }

  for (const entry of entries) {
    const revRef = `REV-${ref}`;
    // Check if already reversed
    const { rows: existing } = await client.query(
      `SELECT id FROM wallet_ledger WHERE reference_id = $1 AND retailer_id = $2`, 
      [revRef, entry.retailer_id]
    );
    if (existing.length > 0) {
      console.log(`  Already reversed: ${revRef} for ${entry.retailer_id}`);
      continue;
    }

    // Issue reversal
    const { rows: r } = await client.query(`
      SELECT public.add_ledger_entry(
        $1, $2, $3, $4,
        'knteer_payout', 'COMMISSION_REVERSAL',
        0, $5,
        $6, $7::uuid, 'completed',
        $8
      ) AS ledger_id
    `, [
      entry.retailer_id, 
      entry.user_role, 
      entry.wallet_type || 'primary', 
      fund,
      entry.credit,  // debit = original credit amount
      revRef,
      TX_UUID,
      `Reversal of ${ref}`,
    ]);
    console.log(`  ✅ Reversed ${ref}: debit ₹${entry.credit} from ${entry.retailer_id} → ledger_id=${r[0].ledger_id}`);
  }
}

client.connect().then(async () => {
  console.log('=== Reversing commissions for 1640372527 ===\n');
  
  const refsToReverse = [
    { ref: 'KNTEER-RTCOMM-1640372527', fund: 'commission' },
    { ref: 'KNTEER-DTCOMM-1640372527', fund: 'commission' },
    { ref: 'KNTEER-DTMARGIN-1640372527', fund: 'commission' },
    { ref: 'KNTEER-MDMARGIN-1640372527', fund: 'commission' },
    { ref: 'KNTEER-REV-1640372527', fund: 'revenue' },
  ];

  for (const { ref, fund } of refsToReverse) {
    console.log(`Processing ${ref}...`);
    await reverseRef(ref, fund).catch(e => console.error(`  ERROR: ${e.message}`));
  }

  // Verify final state
  const { rows: finalCheck } = await client.query(`
    SELECT reference_id, retailer_id, credit, debit, transaction_type
    FROM wallet_ledger
    WHERE reference_id ILIKE '%1640372527%'
    ORDER BY created_at
  `);
  console.log('\n=== All wallet_ledger entries for 1640372527 ===');
  console.log(JSON.stringify(finalCheck, null, 2));

  await client.end();
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
