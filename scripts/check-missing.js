const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const fs = require('fs');
  const text = fs.readFileSync('/home/ubuntu/bbps-uat/new_scenaric_may_09.txt', 'utf8');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
  const idIdx = headers.findIndex(h => h === 'id');
  const dateIdx = headers.findIndex(h => h === 'date');

  // Build map of txn_id -> report date
  const dateMap = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const id = (cols[idIdx] || '').trim().replace(/^'/, '');
    const date = (cols[dateIdx] || '').trim();
    if (id && date) dateMap[id] = date;
  }

  // Fix the 5 records with wrong transaction_time
  const idsToFix = [
    '260509164349254R01hIrUIXm',
    '260509164800380R01e9fWJCk',
    '260509165028686R01nrO38pc',
    '260509170954980R01pZXW0fX',
    '260509171047906R015hTY3bh'
  ];

  for (const txnId of idsToFix) {
    const reportDate = dateMap[txnId];
    if (!reportDate) {
      console.log(txnId, '- not found in report');
      continue;
    }
    // Parse: "2026-5-9 22:20" -> "2026-05-09T22:20:00+05:30"
    const parts = reportDate.split(' ');
    const dp = parts[0].split('-');
    const year = dp[0];
    const month = dp[1].padStart(2, '0');
    const day = dp[2].padStart(2, '0');
    const time = parts[1] ? parts[1] + ':00' : '00:00:00';
    const isoTime = year + '-' + month + '-' + day + 'T' + time + '+05:30';

    const { error } = await supabase
      .from('razorpay_pos_transactions')
      .update({ transaction_time: isoTime })
      .eq('txn_id', txnId);

    console.log(txnId, '->', isoTime, error ? 'ERROR: ' + error.message : 'OK');
  }

  console.log('\nDone! All 5 records fixed.');
})();
