'use strict';

const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../utils/logger');
const { generateHmacSignature } = require('../utils/crypto');

const CALLBACK_TIMEOUT_MS = 10000;
// 3 attempts total: immediate, +2s, +5s. Signature/timestamp computed once so
// they remain valid across retries.
const RETRY_DELAYS_MS = [0, 2000, 5000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST a signed payload to the partner URL with bounded retries.
 *
 * Headers (what the partner verifies):
 *   X-Sameday-Signature : HMAC-SHA256(webhook_secret, `${timestamp}.${rawBody}`) hex
 *   X-Sameday-Timestamp : unix seconds when signed
 *   X-Sameday-Delivery  : per-delivery UUID, stable across retries (idempotency key)
 *   X-Sameday-Event     : "pos.transaction"
 */
async function deliver(webhookUrl, secret, rawPayload) {
  const body = JSON.stringify(rawPayload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const deliveryId = crypto.randomUUID();

  const headers = {
    'Content-Type': 'application/json',
    'X-Sameday-Event': 'pos.transaction',
    'X-Sameday-Timestamp': timestamp,
    'X-Sameday-Delivery': deliveryId,
  };
  if (secret) {
    headers['X-Sameday-Signature'] = generateHmacSignature(secret, `${timestamp}.${body}`);
  }

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) await sleep(RETRY_DELAYS_MS[attempt]);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      if (res.ok) {
        logger.info('Partner callback delivered', {
          webhookUrl,
          txnId: rawPayload.txnId,
          delivery: deliveryId,
          attempt: attempt + 1,
          signed: !!secret,
          status: res.status,
        });
        return;
      }
      logger.warn('Partner callback non-2xx', {
        webhookUrl,
        txnId: rawPayload.txnId,
        delivery: deliveryId,
        attempt: attempt + 1,
        status: res.status,
      });
    } catch (fetchErr) {
      logger.warn('Partner callback attempt failed', {
        webhookUrl,
        txnId: rawPayload.txnId,
        delivery: deliveryId,
        attempt: attempt + 1,
        error: fetchErr.message,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  logger.error('Partner callback gave up', {
    webhookUrl,
    txnId: rawPayload.txnId,
    delivery: deliveryId,
    attempts: RETRY_DELAYS_MS.length,
  });
}

/**
 * Forward a processed POS transaction to the partner's configured webhook_url.
 * Sends the ORIGINAL Razorpay POS payload as-is (no wrapping/transformation),
 * now HMAC-SHA256 signed. Backward compatible: partners without a
 * webhook_secret still receive the callback, just unsigned.
 * Fire-and-forget: failures are logged but never block the main webhook flow.
 */
async function notifyPartner(partnerId, rawPayload) {
  if (!partnerId) return;

  try {
    const { rows } = await db.query(
      `SELECT webhook_url, webhook_secret FROM partners WHERE id = $1 AND status = 'active'`,
      [partnerId]
    );

    const webhookUrl = rows[0]?.webhook_url;
    const secret = rows[0]?.webhook_secret || null;
    if (!webhookUrl) return;

    await deliver(webhookUrl, secret, rawPayload);
  } catch (err) {
    logger.error('Partner callback lookup error', {
      partnerId,
      error: err.message,
    });
  }
}

module.exports = { notifyPartner };
