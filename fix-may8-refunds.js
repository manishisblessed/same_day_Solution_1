/**
 * One-time fix: Refund 18 stuck shadval_settlement transactions from 2026-05-08.
 *
 * These show REFUNDED on Shadval's dashboard but are stuck as PENDING/FAILED
 * in our DB with no wallet credit. Uses the same logic as
 * lib/settlement-2/shadval-refund.ts (refundShadvalSettlement).
 *
 * Run: cd sameday-backend && node fix-may8-refunds.js [--dry-run]
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DRY_RUN = process.argv.includes('--dry-run');

const orderIds = [
  'APITXN0508261422128G','APITXN0508261421015N','APITXN0508261418327B',
  'APITXN0508261412422H','APITXN0508261400410O','APITXN0508261359507K',
  'APITXN0508261357338Q','APITXN0508261357329L','APITXN0508261356280L',
  'APITXN0508261347149N','APITXN0508261336440G','APITXN0508261336433F',
  'APITXN0508261334316L','APITXN0508261329484C','APITXN0508261329023J',
  'APITXN0508261255307L','APITXN0508261252504O','APITXN0508261250530J',
];

function computeRefundAmount(tx) {
  const recorded = parseFloat(tx.actual_wallet_debit ?? tx.total_debit ?? 0);
  if (recorded > 0) return recorded;
  const derived = parseFloat(tx.amount ?? 0) + parseFloat(tx.charges ?? 0);
  return derived > 0 ? derived : 0;
}

function isDuplicate(err) {
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('duplicate') || err?.code === '23505';
}

async function refundOne(tx) {
  const refundAmount = computeRefundAmount(tx);
  if (!(refundAmount > 0)) return { order: tx.order_id, status: 'SKIP', reason: 'zero amount' };

  const refRef = `REFUND_${tx.reference_id}`;
  const legacyRef = `REFUND_TIMEOUT_${tx.reference_id}`;
  const desc = `Settlement-2 refund ₹${refundAmount.toFixed(2)} — provider REFUNDED on Shadval (manual fix 2026-08-07)`;

  // Determine if partner or retailer
  const { data: partnerRow } = await supabase
    .from('partners')
    .select('id')
    .eq('id', tx.retailer_id)
    .maybeSingle();

  const isPartner = !!partnerRow;
  const target = isPartner ? 'partner' : 'retailer';

  // Idempotency check
  if (isPartner) {
    const { data: existing } = await supabase
      .from('partner_wallet_ledger')
      .select('id')
      .eq('partner_id', tx.retailer_id)
      .in('reference_id', [refRef, legacyRef])
      .gt('credit', 0)
      .limit(1);
    if (existing && existing.length > 0) {
      return { order: tx.order_id, status: 'ALREADY_REFUNDED', target, amount: refundAmount };
    }
  } else {
    const { data: existing } = await supabase
      .from('wallet_ledger')
      .select('id')
      .eq('retailer_id', tx.retailer_id)
      .in('reference_id', [refRef, legacyRef])
      .gt('credit', 0)
      .limit(1);
    if (existing && existing.length > 0) {
      return { order: tx.order_id, status: 'ALREADY_REFUNDED', target, amount: refundAmount };
    }
  }

  if (DRY_RUN) {
    return { order: tx.order_id, status: 'DRY_RUN_WOULD_REFUND', target, amount: refundAmount, retailer: tx.retailer_id };
  }

  // Execute refund
  let refundErr;
  if (isPartner) {
    const { error } = await supabase.rpc('refund_partner_wallet', {
      p_partner_id: tx.retailer_id,
      p_amount: refundAmount,
      p_payout_transaction_id: tx.id,
      p_description: desc,
      p_reference_id: refRef,
    });
    refundErr = error;
  } else {
    const { error } = await supabase.rpc('add_ledger_entry', {
      p_user_id: tx.retailer_id,
      p_user_role: 'retailer',
      p_wallet_type: 'primary',
      p_fund_category: 'service',
      p_service_type: 'shadval_settlement',
      p_tx_type: 'SETTLEMENT2_REFUND',
      p_credit: refundAmount,
      p_debit: 0,
      p_reference_id: refRef,
      p_transaction_id: tx.id,
      p_status: 'completed',
      p_remarks: desc,
    });
    refundErr = error;
  }

  if (refundErr) {
    if (isDuplicate(refundErr)) {
      return { order: tx.order_id, status: 'ALREADY_REFUNDED', target, amount: refundAmount };
    }
    return { order: tx.order_id, status: 'CRITICAL_FAIL', target, amount: refundAmount, error: refundErr.message };
  }

  // Update settlement status to FAILED + mark wallet refunded
  const newMsg = (tx.status_message || '') + ' [Wallet refunded]';
  await supabase
    .from('shadval_settlement')
    .update({ status: 'FAILED', status_message: newMsg.trim() })
    .eq('id', tx.id);

  return { order: tx.order_id, status: 'REFUNDED', target, amount: refundAmount, retailer: tx.retailer_id };
}

(async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  SHADVAL MAY-8 REFUND FIX — ${DRY_RUN ? 'DRY RUN' : 'LIVE EXECUTION'}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);

  const { data: txns, error } = await supabase
    .from('shadval_settlement')
    .select('id, retailer_id, reference_id, order_id, status, status_message, amount, charges, total_debit, actual_wallet_debit')
    .in('order_id', orderIds)
    .order('created_at', { ascending: false });

  if (error) { console.error('Failed to fetch:', error.message); process.exit(1); }
  console.log(`Fetched ${txns.length} settlement rows\n`);

  let refunded = 0, skipped = 0, failed = 0, alreadyDone = 0;
  let totalAmount = 0;

  for (const tx of txns) {
    const result = await refundOne(tx);
    const icon = result.status === 'REFUNDED' || result.status === 'DRY_RUN_WOULD_REFUND' ? '✅'
      : result.status === 'ALREADY_REFUNDED' ? '⏭️'
      : result.status === 'CRITICAL_FAIL' ? '❌'
      : '⚪';

    console.log(`${icon} ${result.order} → ${result.status} | ${result.target || ''} | ₹${result.amount || 0} ${result.error ? '| ERR: ' + result.error : ''}`);

    if (result.status === 'REFUNDED' || result.status === 'DRY_RUN_WOULD_REFUND') {
      refunded++;
      totalAmount += result.amount || 0;
    } else if (result.status === 'ALREADY_REFUNDED') {
      alreadyDone++;
    } else if (result.status === 'CRITICAL_FAIL') {
      failed++;
    } else {
      skipped++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  SUMMARY`);
  console.log(`  Refunded:         ${refunded} (₹${totalAmount.toFixed(2)})`);
  console.log(`  Already refunded: ${alreadyDone}`);
  console.log(`  Failed:           ${failed}`);
  console.log(`  Skipped:          ${skipped}`);
  console.log(`${'='.repeat(60)}\n`);
})();
