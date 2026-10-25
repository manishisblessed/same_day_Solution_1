/**
 * Fix the two stuck Knteer transactions:
 * 
 * 9995331665 — FAILED, refund silently failed (constraint bug), admin manually compensated
 *   → Mark status_message correctly, add admin-compensated note to remarks
 *   → Do NOT issue refund (admin already credited ₹16,000 manually)
 * 
 * 1640372527 — PENDING, admin manually compensated
 *   → Check live status at Knteer
 *   → Report result
 */

const { Client } = require('pg');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const envContent = fs.readFileSync('/home/ubuntu/sameday-backend/.env.local', 'utf8');

function getEnv(key) {
  const line = envContent.split('\n').find(l => l.startsWith(key + '='));
  if (!line) return null;
  return line.split('=').slice(1).join('=').trim();
}

const dbUrl = getEnv('DATABASE_URL');
const knteerPartnerId = getEnv('KNTEER_PARTNER_ID');
const knteerSecret = getEnv('KNTEER_JWT_TOKEN');  // HS256 signing secret
const knteerBaseUrl = (getEnv('KNTEER_API_BASE_URL') || 'https://api.knteersolution.com/Prod').replace(/\/$/, '');

// Generate Knteer JWT (matches auth.ts format)
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function makeKnteerJwt(refId) {
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64url(Buffer.from(JSON.stringify({
    exp: String(Math.floor(Date.now() / 1000) + 270),  // string, matches auth.ts
    partnerId: knteerPartnerId,
    refId,
  })));
  const sig = base64url(crypto.createHmac('sha256', knteerSecret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

async function knteerStatusEnquiry(partnerTransId) {
  const ts = Date.now().toString().slice(-6);
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const refId = `${ts}${rand}`;
  // ⚠️ Knteer uses partnerTranId (no 's') in status enquiry body
  const body = JSON.stringify({ partnerTranId: partnerTransId });
  const url = new URL(`${knteerBaseUrl}/payout/statusenquiry`);
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${makeKnteerJwt(refId)}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

client.connect().then(async () => {
  console.log('=== Checking Knteer status for 1640372527 ===');
  const knteerStatus = await knteerStatusEnquiry('1640372527');
  console.log('Knteer response:', JSON.stringify(knteerStatus.body, null, 2));

  console.log('\n=== Updating 9995331665 status_message ===');
  // Mark 9995331665 as manually refunded via admin (DO NOT credit wallet again)
  const r1 = await client.query(`
    UPDATE knteer_payout_transactions
    SET 
      status_message = 'Transfer failed — wallet refund failed (constraint bug, now fixed). Admin manually compensated ₹16000 on 25-Oct-2026.',
      remarks = 'Auto-refund failed due to wallet_ledger constraint. Admin push ADMIN_PUSH_1792925130985 (₹16000) covered this on 25-Oct-2026 04:15pm IST.',
      updated_at = NOW()
    WHERE partner_trans_id = '9995331665' AND status = 'FAILED'
    RETURNING id, status, status_message
  `);
  console.log('Updated 9995331665:', JSON.stringify(r1.rows, null, 2));

  console.log('\n=== Checking 1640372527 in DB ===');
  const r2 = await client.query(`
    SELECT id, status, status_message, created_at, updated_at
    FROM knteer_payout_transactions
    WHERE partner_trans_id = '1640372527'
  `);
  console.log(JSON.stringify(r2.rows, null, 2));

  // If Knteer says FAILED for 1640372527, note it (but don't refund since admin already compensated)
  const body = knteerStatus.body;
  const knteerFailed = body?.statusId === 6 || body?.status === 'FAILED' || 
                       (body?.data?.statusId === 6) || body?.data?.status === 'FAILED';
  const knteerSuccess = body?.statusId === 4 || 
                        (body?.data?.statusId === 4 && body?.data?.utr);
  
  if (knteerFailed) {
    console.log('\n✅ Knteer confirmed FAILED — updating DB status');
    const r3 = await client.query(`
      UPDATE knteer_payout_transactions
      SET 
        status = 'FAILED',
        status_message = 'Knteer confirmed FAILED. Admin manually compensated ₹16000 on 25-Oct-2026. No system refund issued (would double-credit).',
        remarks = 'Admin push ADMIN_PUSH_1792924018882 (₹16000) covered this on 25-Oct-2026 04:21pm IST.',
        updated_at = NOW()
      WHERE partner_trans_id = '1640372527' AND status = 'PENDING'
      RETURNING id, status, status_message
    `);
    console.log('Updated:', JSON.stringify(r3.rows, null, 2));
  } else if (knteerSuccess) {
    console.log('\n⚠️  CRITICAL: Knteer shows SUCCESS! Money sent to bank AND admin credited ₹16k manually. DOUBLE-MONEY RISK!');
    console.log('UTR:', body?.utr || body?.data?.utr || 'unknown');
    console.log('Action needed: Contact admin to reverse the ₹16,000 adjustment or recover from retailer');
    const r3 = await client.query(`
      UPDATE knteer_payout_transactions
      SET 
        status = 'SUCCESS',
        utr = $1,
        status_message = 'SUCCESS at Knteer. WARNING: Admin also manually compensated ₹16000 — potential double-credit. ADMIN ACTION REQUIRED.',
        updated_at = NOW()
      WHERE partner_trans_id = '1640372527' AND status = 'PENDING'
      RETURNING id, status, utr, status_message
    `,  [body?.utr || body?.data?.utr || null]);
    console.log('Updated:', JSON.stringify(r3.rows, null, 2));
  } else {
    console.log('\n⏳ Knteer still PENDING for 1640372527 — no DB change');
    // Update remarks to note admin compensation
    await client.query(`
      UPDATE knteer_payout_transactions
      SET 
        remarks = 'Admin push ADMIN_PUSH_1792924018882 (₹16000) covers this if it fails. Monitor Knteer for final status.',
        updated_at = NOW()
      WHERE partner_trans_id = '1640372527' AND status = 'PENDING'
    `);
  }

  await client.end();
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
