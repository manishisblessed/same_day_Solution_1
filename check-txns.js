require('dotenv').config({ path: '.env.local' });
const {createClient} = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const orderIds = [
  'APITXN0508261422128G','APITXN0508261421015N','APITXN0508261418327B',
  'APITXN0508261412422H','APITXN0508261400410O','APITXN0508261359507K',
  'APITXN0508261357338Q','APITXN0508261357329L','APITXN0508261356280L',
  'APITXN0508261347149N','APITXN0508261336440G','APITXN0508261336433F',
  'APITXN0508261334316L','APITXN0508261329484C','APITXN0508261329023J',
  'APITXN0508261255307L','APITXN0508261252504O','APITXN0508261250530J',
  'APITXN050826095428558JFLP','APITXN050826095337015QTVO','APITXN050826093447248OIBK'
];

(async () => {
  // Step 1: Get full settlement details with retailer_id and reference_id
  console.log('========== STEP 1: SETTLEMENT DETAILS ==========');
  const {data: txns, error: txErr} = await supabase
    .from('shadval_settlement')
    .select('id, retailer_id, reference_id, order_id, status, status_message, amount, charges, total_debit, actual_wallet_debit, created_at')
    .in('order_id', orderIds)
    .order('created_at', {ascending: false});

  if (txErr) { console.log('Error:', txErr.message); return; }
  console.log(`Found ${txns.length} settlements\n`);

  txns.forEach(t => {
    console.log(`${t.order_id} | ${t.status} | amt:${t.amount} | charges:${t.charges} | total_debit:${t.total_debit} | actual_debit:${t.actual_wallet_debit} | retailer:${t.retailer_id} | ref:${t.reference_id} | msg:${t.status_message || 'none'}`);
  });

  // Step 2: Check wallet_ledger for existing refunds
  console.log('\n========== STEP 2: EXISTING REFUND ENTRIES IN WALLET_LEDGER ==========');
  const refIds = txns.map(t => `REFUND_${t.reference_id}`);
  const timeoutRefIds = txns.map(t => `REFUND_TIMEOUT_${t.reference_id}`);
  const allRefIds = [...refIds, ...timeoutRefIds];

  const {data: ledger, error: lErr} = await supabase
    .from('wallet_ledger')
    .select('id, retailer_id, transaction_type, amount, credit, debit, reference_id, status, description, created_at')
    .in('reference_id', allRefIds);

  if (lErr) {
    console.log('Error:', lErr.message);
  } else {
    console.log(`Found ${ledger.length} refund ledger entries\n`);
    if (ledger.length > 0) {
      ledger.forEach(l => {
        console.log(`ref:${l.reference_id} | type:${l.transaction_type} | credit:${l.credit} | debit:${l.debit} | status:${l.status} | retailer:${l.retailer_id}`);
      });
    } else {
      console.log('*** NO REFUNDS FOUND IN LEDGER — wallets were NOT credited back ***');
    }
  }

  // Also check partner_wallet_ledger
  const {data: pLedger, error: plErr} = await supabase
    .from('partner_wallet_ledger')
    .select('id, partner_id, transaction_type, amount, credit, debit, reference_id, status, description, created_at')
    .in('reference_id', allRefIds);

  if (plErr) {
    console.log('Partner ledger error:', plErr.message);
  } else if (pLedger && pLedger.length > 0) {
    console.log(`\nFound ${pLedger.length} partner refund ledger entries:`);
    pLedger.forEach(l => {
      console.log(`ref:${l.reference_id} | type:${l.transaction_type} | credit:${l.credit} | status:${l.status} | partner:${l.partner_id}`);
    });
  } else {
    console.log('No partner wallet refunds found either.');
  }

  // Step 3: Check wallet balances for affected retailers
  console.log('\n========== STEP 3: WALLET BALANCES FOR AFFECTED RETAILERS ==========');
  const retailerIds = [...new Set(txns.map(t => t.retailer_id))];
  console.log(`Unique retailers: ${retailerIds.length} — ${retailerIds.join(', ')}\n`);

  const {data: wallets, error: wErr} = await supabase
    .from('wallets')
    .select('user_id, wallet_type, balance, is_frozen')
    .in('user_id', retailerIds)
    .eq('wallet_type', 'primary');

  if (wErr) {
    console.log('Wallet error:', wErr.message);
  } else {
    wallets.forEach(w => {
      const txnsForUser = txns.filter(t => t.retailer_id === w.user_id);
      const totalStuck = txnsForUser.reduce((s, t) => s + Number(t.actual_wallet_debit || t.total_debit || t.amount), 0);
      console.log(`Retailer: ${w.user_id} | Balance: ₹${w.balance} | Frozen: ${w.is_frozen} | Stuck amount: ₹${totalStuck.toFixed(2)} (${txnsForUser.length} txns)`);
    });

    const missingWallets = retailerIds.filter(r => !wallets.find(w => w.user_id === r));
    if (missingWallets.length > 0) {
      console.log(`\nRetailers with NO primary wallet found: ${missingWallets.join(', ')}`);
      // Check partner_wallets
      const {data: pw} = await supabase
        .from('partner_wallets')
        .select('partner_id, balance, is_frozen')
        .in('partner_id', missingWallets);
      if (pw && pw.length > 0) {
        pw.forEach(p => {
          const txnsForP = txns.filter(t => t.retailer_id === p.partner_id);
          const totalStuck = txnsForP.reduce((s, t) => s + Number(t.actual_wallet_debit || t.total_debit || t.amount), 0);
          console.log(`Partner: ${p.partner_id} | Balance: ₹${p.balance} | Frozen: ${p.is_frozen} | Stuck amount: ₹${totalStuck.toFixed(2)} (${txnsForP.length} txns)`);
        });
      }
    }
  }

  // Step 4: Summary — what needs refunding
  console.log('\n========== STEP 4: REFUND NEEDED SUMMARY ==========');
  const refundedRefs = new Set((ledger || []).map(l => l.reference_id).concat((pLedger || []).map(l => l.reference_id)));
  
  let totalRefundNeeded = 0;
  const needsRefund = [];
  txns.forEach(t => {
    const refKey = `REFUND_${t.reference_id}`;
    const timeoutKey = `REFUND_TIMEOUT_${t.reference_id}`;
    const alreadyRefunded = refundedRefs.has(refKey) || refundedRefs.has(timeoutKey);
    const refundAmt = Number(t.actual_wallet_debit || t.total_debit || (Number(t.amount) + Number(t.charges)));
    if (!alreadyRefunded) {
      totalRefundNeeded += refundAmt;
      needsRefund.push(t);
      console.log(`NEEDS REFUND: ${t.order_id} | ₹${refundAmt} | retailer:${t.retailer_id} | ref:${t.reference_id}`);
    } else {
      console.log(`ALREADY REFUNDED: ${t.order_id} | ₹${refundAmt} | retailer:${t.retailer_id}`);
    }
  });

  console.log(`\nTotal transactions needing refund: ${needsRefund.length}`);
  console.log(`Total refund amount: ₹${totalRefundNeeded.toFixed(2)}`);
})();
