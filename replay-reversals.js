/* eslint-disable */
/**
 * One-off: replay `pos.transaction.reversed` webhooks for the Pine Labs txns that
 * were corrected by the one-time reconciliation script (which did NOT emit
 * webhooks). Mirrors lib/partner-webhook/deliver.ts exactly:
 *   - resolve partner via serial -> pos_machines.tid -> partner_pos_machines
 *   - resolve active 'pos' endpoints (partner_webhooks) or legacy webhook_url
 *   - sign HMAC-SHA256(secret, `${ts}.${rawBody}`) hex
 *   - retry [0, 2s, 5s], log to partner_webhook_deliveries
 *
 * Usage:  node replay-reversals.js --dry     (resolve + preview, no POST)
 *         node replay-reversals.js           (live send)
 */
require('dotenv').config({ path: '.env.local' });
const crypto = require('crypto');
const { Client } = require('pg');

const DRY = process.argv.includes('--dry');
const TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [0, 2_000, 5_000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sign(secret, ts, body) {
  return crypto.createHmac('sha256', secret).update(`${ts}.${body}`, 'utf8').digest('hex');
}

async function resolvePartnerId(c, serial, tid) {
  if (serial) {
    const r = await c.query('SELECT partner_id FROM pos_machines WHERE serial_number=$1 AND partner_id IS NOT NULL LIMIT 1', [serial]);
    if (r.rows[0]?.partner_id) return r.rows[0].partner_id;
  }
  if (tid) {
    const r = await c.query('SELECT partner_id FROM pos_machines WHERE tid=$1 AND partner_id IS NOT NULL LIMIT 1', [tid]);
    if (r.rows[0]?.partner_id) return r.rows[0].partner_id;
    const r2 = await c.query("SELECT partner_id FROM partner_pos_machines WHERE terminal_id=$1 AND status='active' LIMIT 1", [tid]);
    if (r2.rows[0]?.partner_id) return r2.rows[0].partner_id;
  }
  return null;
}

async function resolveEndpoints(c, partnerId) {
  const p = await c.query("SELECT name, webhook_secret, webhook_url, status FROM partners WHERE id=$1 AND status='active'", [partnerId]);
  if (!p.rows[0]) return { name: null, endpoints: [] };
  const secret = p.rows[0].webhook_secret ?? null;
  const name = p.rows[0].name;
  const rows = await c.query('SELECT id, url, events, is_active FROM partner_webhooks WHERE partner_id=$1 AND is_active=true', [partnerId]);
  const endpoints = [];
  if (rows.rows.length > 0) {
    const seen = new Set();
    for (const r of rows.rows) {
      if (!r.url || seen.has(r.url)) continue;
      if (!Array.isArray(r.events) || !r.events.includes('pos')) continue;
      seen.add(r.url);
      endpoints.push({ id: r.id ?? null, url: String(r.url), secret });
    }
    return { name, endpoints };
  }
  const legacy = p.rows[0].webhook_url;
  if (legacy && String(legacy).trim()) endpoints.push({ id: null, url: String(legacy).trim(), secret });
  return { name, endpoints };
}

async function send(c, ep, payload, txnId, partnerId) {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const deliveryId = crypto.randomUUID();
  const headers = {
    'Content-Type': 'application/json',
    'X-Sameday-Event': 'pos.transaction.reversed',
    'X-Sameday-Timestamp': ts,
    'X-Sameday-Delivery': deliveryId,
  };
  if (ep.secret) headers['X-Sameday-Signature'] = sign(ep.secret, ts, body);

  let lastStatus = null, lastError = null;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) await sleep(RETRY_DELAYS_MS[attempt]);
    try {
      const res = await fetch(ep.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      lastStatus = res.status;
      if (res.ok) {
        console.log(`    OK  ${txnId} -> ${ep.url} HTTP ${res.status} (attempt ${attempt + 1}, signed=${!!ep.secret})`);
        await logDelivery(c, { deliveryId, partnerId, webhookId: ep.id, txnId, url: ep.url, status: res.status, success: true, attempts: attempt + 1, error: null, payload });
        return true;
      }
      lastError = `HTTP ${res.status}`;
      console.warn(`    non-2xx ${txnId} -> ${ep.url} HTTP ${res.status} (attempt ${attempt + 1})`);
    } catch (e) {
      lastError = e?.message || String(e);
      console.warn(`    fail ${txnId} -> ${ep.url}: ${lastError} (attempt ${attempt + 1})`);
    }
  }
  console.error(`    GAVE UP ${txnId} -> ${ep.url} after ${RETRY_DELAYS_MS.length} attempts`);
  await logDelivery(c, { deliveryId, partnerId, webhookId: ep.id, txnId, url: ep.url, status: lastStatus, success: false, attempts: RETRY_DELAYS_MS.length, error: lastError, payload });
  return false;
}

async function logDelivery(c, r) {
  try {
    await c.query(
      `INSERT INTO partner_webhook_deliveries (delivery_id, partner_id, webhook_id, txn_id, event, webhook_url, status_code, success, attempts, error, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [r.deliveryId, r.partnerId, r.webhookId, r.txnId, 'pos.transaction.reversed', r.url, r.status, r.success, r.attempts, r.error, JSON.stringify(r.payload)]
    );
  } catch (e) { console.warn(`    (delivery log failed ${r.txnId}: ${e.message})`); }
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const { rows: txns } = await c.query(`
      SELECT txn_id, tid, device_serial, mid_code, rrn, amount, display_status, reversal_reason, reversed_at,
             (wallet_credited OR partner_wallet_credited) AS was_settled
      FROM razorpay_pos_transactions
      WHERE txn_id LIKE 'PL\\_%' AND reversed_at IS NOT NULL
      ORDER BY amount DESC`);

    console.log(`${DRY ? '[DRY RUN] ' : ''}Replaying ${txns.length} reversal webhook(s)\n`);
    let sent = 0, failed = 0, skipped = 0, noEndpoint = 0;

    for (const t of txns) {
      const partnerId = await resolvePartnerId(c, t.device_serial, t.tid);
      if (!partnerId) { console.log(`  SKIP ${t.txn_id} (Rs.${Number(t.amount).toLocaleString('en-IN')}): no owning partner`); skipped++; continue; }
      const { name, endpoints } = await resolveEndpoints(c, partnerId);
      if (endpoints.length === 0) { console.log(`  SKIP ${t.txn_id} -> ${name}: no active POS endpoints`); noEndpoint++; continue; }

      const payload = {
        event: 'pos.transaction.reversed',
        action: 'remove',
        txn_id: t.txn_id,
        rrn: t.rrn,
        terminal_id: t.tid,
        tid: t.tid,
        device_serial: t.device_serial,
        mid: t.mid_code,
        amount: Number(t.amount) || 0,
        previous_status: 'CAPTURED',
        status: t.display_status,
        reversed_at: new Date(t.reversed_at).toISOString(),
        reason: t.reversal_reason,
        was_settled: !!t.was_settled,
        _brand: 'PINELAB',
      };

      console.log(`  ${t.txn_id} (Rs.${Number(t.amount).toLocaleString('en-IN')}) -> ${name} [${endpoints.length} endpoint(s)]`);
      if (DRY) { endpoints.forEach(e => console.log(`      would POST -> ${e.url} (signed=${!!e.secret})`)); continue; }
      for (const ep of endpoints) {
        const ok = await send(c, ep, payload, t.txn_id, partnerId);
        if (ok) sent++; else failed++;
      }
    }

    console.log(`\n${DRY ? '[DRY RUN] ' : ''}Done. delivered=${sent} failed=${failed} skipped(no partner)=${skipped} skipped(no endpoint)=${noEndpoint}`);
  } finally { await c.end(); }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
