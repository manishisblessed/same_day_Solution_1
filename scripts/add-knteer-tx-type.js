// Adds KNTEER_PAYOUT_DEBIT and KNTEER_PAYOUT_REFUND to wallet_ledger transaction_type CHECK constraint
const { Client } = require('pg');
const fs = require('fs');

const envContent = fs.readFileSync('/home/ubuntu/sameday-backend/.env.local', 'utf8');
const dbUrl = envContent.split('\n').find(l => l.startsWith('DATABASE_URL='))?.split('=').slice(1).join('=').trim();
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

client.connect().then(async () => {
  // Drop existing constraint and re-create with new types added
  await client.query('BEGIN');
  try {
    await client.query(`ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_transaction_type_check`);
    
    await client.query(`
      ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_transaction_type_check
      CHECK (transaction_type = ANY (ARRAY[
        'ACCOUNT_VERIFICATION_CHARGE', 'ACCOUNT_VERIFICATION_REFUND',
        'ADJUSTMENT', 'ADMIN_CREDIT',
        'AEPS_CREDIT', 'AEPS_DEBIT', 'AEPS_SETTLEMENT',
        'BBPS_DEBIT', 'BBPS_REFUND',
        'COMMISSION_CREDIT', 'COMMISSION', 'COMMISSION_REVERSAL',
        'COMPANY_REVENUE', 'COMPANY_REVENUE_REVERSAL',
        'CREDIT', 'DEBIT',
        'DISTRIBUTOR_COMMISSION',
        'KNTEER_PAYOUT_DEBIT', 'KNTEER_PAYOUT_REFUND',
        'MASTER_DISTRIBUTOR_COMMISSION',
        'PAY2NEW_DEBIT', 'PAY2NEW_REFUND',
        'PAYOUT',
        'POS_CREDIT', 'POS_RENTAL_COMMISSION',
        'RECHARGEKIT_CC_DEBIT', 'RECHARGEKIT_CC_REFUND',
        'REFUND', 'REVENUE_CREDIT', 'REVENUE_REVERSAL',
        'SETTLEMENT2_REFUND', 'SETTLEMENT2_TRANSFER',
        'SUBSCRIPTION_DEBIT', 'SUBSCRIPTION_REVENUE',
        'TDS_DEDUCTION', 'TRANSFER_OUT'
      ]::text[]))
    `);
    
    await client.query('COMMIT');
    console.log('✅ Constraint updated successfully — KNTEER_PAYOUT_DEBIT and KNTEER_PAYOUT_REFUND added');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Failed:', e.message);
  }
  
  await client.end();
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
