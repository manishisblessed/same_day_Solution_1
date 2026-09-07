/**
 * READ-ONLY Pine Labs reconciliation.
 * Re-fetches every transaction in a window from Pine Labs' live summary API and
 * compares each one's CURRENT status/settlement against what our DB shows.
 *
 * Categorises every DB "captured/SUCCESS" Pine Labs txn as:
 *   - REVERSED      : Pine Labs now reports VOID/REFUND/REVERSAL or non-SUCCESS
 *   - DROPPED       : Pine Labs no longer returns this txn id at all (voided pre-settlement)
 *   - UNSETTLED_OLD : still SUCCESS, no settlementDate, older than the cutoff
 *   - RECENT_OPEN   : still SUCCESS, unsettled, but younger than cutoff (normal)
 *   - SETTLED_OK    : has settlementDate / CLOSED batch
 *
 * Writes recon-pinelab-report.csv. Makes NO writes to the DB or Pine Labs.
 *
 * Usage: node recon-pinelab.js [fromDate=YYYY-MM-DD] [toDate=YYYY-MM-DD] [cutoffDays=2]
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ---- load env (Supabase) ----
require('dotenv').config({ path: '.env.local' });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ---- merge ALL PINELAB_MERCHANTS_CONFIG lines from .env.local (dotenv keeps only the last) ----
function loadPinelabConfig() {
  const merged = {};
  const envPath = path.join(process.cwd(), '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^PINELAB_MERCHANTS_CONFIG=(.+)$/);
    if (!m) continue;
    try { Object.assign(merged, JSON.parse(m[1])); } catch (e) { console.error('bad config line', e.message); }
  }
  return merged;
}

const PROD = 'https://api-c.pinelabs.com';
const TEST = 'https://api-ct.pinelabs.com';
const authHeader = (id, sec) => 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64');
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function fetchPage(base, auth, fromDate, toDate, page, size, paymentMode) {
  const url = `${base}/transactions/summary?page=${page}&size=${size}`;
  const body = { fromDate, toDate };
  if (paymentMode) body.paymentMode = paymentMode;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 2000 * attempt));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const d = await res.json();
        return { transactions: d.transactions || [], totalPages: parseInt(d.totalPages || '0', 10) };
      }
      const t = await res.text().catch(() => '');
      if (res.status !== 500) throw new Error(`HTTP ${res.status}: ${t}`);
      var last = new Error(`HTTP 500: ${t}`);
    } catch (e) { var last = e; }
  }
  throw last;
}

// IST wall-clock strings, matching lib/pinelab/sync.ts
const IST = 5.5 * 3600 * 1000;
const toIst = (d) => new Date(d.getTime() + IST).toISOString().replace('Z', '').split('.')[0];

async function fetchWindow(cfg, fromISO, toISO) {
  const base = cfg.env === 'production' ? PROD : TEST;
  const auth = authHeader(cfg.clientId, cfg.clientSecret);
  const modes = ['CARD', 'UPI', undefined];
  const map = new Map();
  for (const mode of modes) {
    let page = 0, totalPages = 1;
    while (page < totalPages) {
      const { transactions, totalPages: tp } = await fetchPage(base, auth, fromISO, toISO, page, 500, mode);
      totalPages = tp || 1;
      for (const t of transactions) {
        if (t.transactionId && !map.has(t.transactionId)) map.set(t.transactionId, t);
      }
      page++;
    }
  }
  return map;
}

// weekly chunks so we never hit API window limits
function* weeks(from, to) {
  let s = new Date(from);
  const end = new Date(to);
  while (s < end) {
    const e = new Date(Math.min(s.getTime() + 7 * 86400000, end.getTime()));
    yield [new Date(s), e];
    s = e;
  }
}

async function fetchAllDbSuccess() {
  let out = [], from = 0;
  while (true) {
    const { data, error } = await sb.from('razorpay_pos_transactions')
      .select('txn_id, amount, tid, merchant_slug, transaction_time, wallet_credited, partner_wallet_credited, raw_data')
      .eq('display_status', 'SUCCESS').ilike('txn_id', 'PL\\_%')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    out = out.concat(data);
    if (data.length < 1000) break; from += 1000;
  }
  return out;
}

function isReversal(t) {
  const s = String(t?.txnStatus || '').toUpperCase();
  const ty = String(t?.txnType || '').toUpperCase();
  if (ty.includes('REFUND') || s.includes('REFUND')) return 'REFUND';
  if (ty.includes('VOID') || ty.includes('REVERS') || s.includes('VOID') || s.includes('REVERS')) return 'VOID';
  if (s && s !== 'SUCCESS') return `STATUS:${s}`;
  return null;
}
function isSettled(t) {
  const sd = t?.settlementDate;
  const bs = String(t?.batchStatus || '').toUpperCase();
  return (!!sd && String(sd).trim() && String(sd) !== 'null') || bs === 'CLOSED' || bs === 'SETTLED';
}

(async () => {
  const args = process.argv.slice(2);
  const fromDate = args[0] || '2026-07-01';
  const toDate = args[1] || toIst(new Date()).split('T')[0];
  const cutoffDays = parseFloat(args[2] || '2');
  const now = Date.now();

  console.log(`Reconciling Pine Labs ${fromDate} -> ${toDate} (cutoff ${cutoffDays}d)\n`);

  const cfgs = loadPinelabConfig();
  console.log('Merchants:', Object.keys(cfgs).join(', '));

  // 1) Build live Pine Labs map (all merchants)
  const live = new Map(); // transactionId -> pinelab txn
  for (const [slug, cfg] of Object.entries(cfgs)) {
    let fetched = 0;
    for (const [ws, we] of weeks(fromDate + 'T00:00:00', toDate + 'T23:59:59')) {
      const m = await fetchWindow(cfg, toIst(ws), toIst(we));
      for (const [id, t] of m) { if (!live.has(id)) { live.set(id, t); } }
      fetched += m.size;
      process.stdout.write(`  [${slug}] ${toIst(ws).slice(0,10)}..${toIst(we).slice(0,10)}: +${m.size} (live total ${live.size})\n`);
    }
  }
  console.log(`\nLive Pine Labs unique txns fetched: ${live.size}`);

  // 2) DB captured rows
  const db = await fetchAllDbSuccess();
  console.log(`DB captured (SUCCESS) rows: ${db.length}\n`);

  // 3) Categorise
  const cat = {
    REVERSED: [], DROPPED: [], UNSETTLED_OLD: [], RECENT_OPEN: [], SETTLED_OK: [],
  };
  for (const row of db) {
    const rawId = row.txn_id.replace(/^PL_/, '');
    const t = live.get(rawId);
    const amt = Number(row.amount || 0);
    const ageDays = (now - new Date(row.transaction_time).getTime()) / 86400000;
    const rec = {
      txn_id: row.txn_id, amount: amt, tid: row.tid, merchant: row.merchant_slug,
      when: row.transaction_time,
      settled_to_wallet: !!(row.wallet_credited || row.partner_wallet_credited),
      live_txnStatus: t?.txnStatus ?? '(absent)', live_txnType: t?.txnType ?? '',
      live_batchStatus: t?.batchStatus ?? '', live_settlementDate: t?.settlementDate ?? '',
      reason: '',
    };
    if (!t) { rec.reason = 'not-returned-by-pinelab'; cat.DROPPED.push(rec); continue; }
    const rev = isReversal(t);
    if (rev) { rec.reason = `reversed:${rev}`; cat.REVERSED.push(rec); continue; }
    if (isSettled(t)) { rec.reason = 'settled'; cat.SETTLED_OK.push(rec); continue; }
    if (ageDays > cutoffDays) { rec.reason = `unsettled>${cutoffDays}d`; cat.UNSETTLED_OLD.push(rec); }
    else { rec.reason = 'recent-open'; cat.RECENT_OPEN.push(rec); }
  }

  const sum = (a) => a.reduce((s, r) => s + r.amount, 0);
  console.log('==================== RECONCILIATION SUMMARY ====================');
  for (const k of ['REVERSED', 'DROPPED', 'UNSETTLED_OLD', 'RECENT_OPEN', 'SETTLED_OK']) {
    console.log(`${k.padEnd(14)}: ${String(cat[k].length).padStart(6)} txns | ${inr(sum(cat[k]))}`);
  }
  const failed = [...cat.REVERSED, ...cat.DROPPED, ...cat.UNSETTLED_OLD];
  console.log('---------------------------------------------------------------');
  console.log(`FAILED-BUT-CAPTURED (REVERSED+DROPPED+UNSETTLED_OLD): ${failed.length} txns | ${inr(sum(failed))}`);
  const walletHit = failed.filter(r => r.settled_to_wallet);
  console.log(`  └ of which already credited to a wallet (real cash loss): ${walletHit.length} txns | ${inr(sum(walletHit))}`);
  console.log('===============================================================');

  // 4) CSV
  const header = ['txn_id','amount','tid','merchant','when','category','reason','settled_to_wallet','live_txnStatus','live_txnType','live_batchStatus','live_settlementDate'];
  const lines = [header.join(',')];
  const push = (arr, category) => arr.forEach(r => lines.push([
    r.txn_id, r.amount, r.tid, r.merchant, r.when, category, r.reason, r.settled_to_wallet,
    r.live_txnStatus, r.live_txnType, r.live_batchStatus, r.live_settlementDate
  ].map(v => JSON.stringify(v ?? '')).join(',')));
  push(cat.REVERSED, 'REVERSED');
  push(cat.DROPPED, 'DROPPED');
  push(cat.UNSETTLED_OLD, 'UNSETTLED_OLD');
  try {
    fs.writeFileSync('recon-pinelab-report.csv', lines.join('\n'));
    console.log(`\nWrote recon-pinelab-report.csv (${failed.length} problem rows)`);
  } catch (e) {
    const alt = `recon-pinelab-report-${Date.now()}.csv`;
    try { fs.writeFileSync(alt, lines.join('\n')); console.log(`\nrecon-pinelab-report.csv locked; wrote ${alt}`); }
    catch { console.log(`\nCould not write CSV (${e.message}); continuing.`); }
  }

  // 5) APPLY (only with --apply): flip Pine Labs-CONFIRMED failures to their
  //    terminal state, stamping reversed_at (failed-time) / reversal_reason so
  //    the Failed Transactions tab shows captured-time vs failed-time. Only
  //    REVERSED (live reports FAILED/VOID/REFUND) is auto-corrected — never the
  //    UNSETTLED_OLD bucket (Pine Labs still reports those as success).
  if (!process.argv.includes('--apply')) {
    console.log('\n(dry run — pass --apply to write the corrections for REVERSED rows)');
    return;
  }

  const parseIst = (raw) => {
    if (!raw || String(raw).trim() === '' || String(raw) === 'null') return null;
    const d = new Date(String(raw).trim().replace(' ', 'T') + '+05:30');
    return isNaN(d.getTime()) ? null : d;
  };
  const mapDisplay = (s, ty) => {
    s = String(s || '').toUpperCase(); ty = String(ty || '').toUpperCase();
    if (ty.includes('REFUND') || s.includes('REFUND')) return { status: 'REFUNDED', display: 'REFUNDED' };
    if (ty.includes('VOID') || ty.includes('REVERS') || s.includes('VOID') || s.includes('REVERS')) return { status: 'VOIDED', display: 'VOIDED' };
    if (s === 'CANCELLED') return { status: 'CANCELLED', display: 'CANCELLED' };
    return { status: 'FAILED', display: 'FAILED' };
  };

  console.log(`\nApplying corrections to ${cat.REVERSED.length} confirmed-failed rows...`);
  let ok = 0, err = 0;
  for (const r of cat.REVERSED) {
    const { status, display } = mapDisplay(r.live_txnStatus, r.live_txnType);
    const failTime = parseIst(r.live_settlementDate) || new Date();
    // NOTE: display_status is intentionally OMITTED. A DB trigger pins Pine Labs
    // display_status to 'SUCCESS' and silently rejects any UPDATE that changes it
    // (0 rows, no error), which would drop this whole update. reversed_at + status
    // are the failure signals the app now keys off. We attempt display_status in a
    // separate best-effort write (works once the guard trigger is dropped).
    const { data: upd, error } = await sb.from('razorpay_pos_transactions').update({
      status,
      settlement_status: 'FAILED',
      reversed_at: failTime.toISOString(),
      reversal_reason: `pinelab-recon:${r.live_txnStatus || display}`,
      updated_at: new Date().toISOString(),
    }).eq('txn_id', r.txn_id).select('txn_id');
    if (error) { err++; console.log(`  ERR ${r.txn_id}: ${error.message}`); continue; }
    if (!upd || upd.length === 0) { err++; console.log(`  ERR ${r.txn_id}: 0 rows updated`); continue; }
    await sb.from('razorpay_pos_transactions').update({ display_status: display }).eq('txn_id', r.txn_id);
    ok++; console.log(`  fixed ${r.txn_id} -> ${display} (failed ${failTime.toISOString()})`);
  }
  console.log(`\nApplied: ${ok} fixed, ${err} errors.`);
  if (cat.UNSETTLED_OLD.length) {
    console.log(`\n${cat.UNSETTLED_OLD.length} UNSETTLED_OLD rows left AS-IS for manual review (Pine Labs still reports success):`);
    cat.UNSETTLED_OLD.forEach(r => console.log(`  ${r.txn_id} | ${inr(r.amount)} | age>${cutoffDays}d`));
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
