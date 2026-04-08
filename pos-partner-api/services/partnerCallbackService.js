'use strict';

const db = require('../config/database');
const logger = require('../utils/logger');

const CALLBACK_TIMEOUT_MS = 10000;

/**
 * Forward a processed POS transaction to the partner's configured webhook_url.
 * Sends the ORIGINAL Razorpay POS payload as-is (no wrapping/transformation).
 * Fire-and-forget: failures are logged but never block the main webhook flow.
 */
async function notifyPartner(partnerId, rawPayload) {
  if (!partnerId) return;

  try {
    const { rows } = await db.query(
      `SELECT webhook_url FROM partners WHERE id = $1 AND status = 'active'`,
      [partnerId]
    );

    const webhookUrl = rows[0]?.webhook_url;
    if (!webhookUrl) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rawPayload),
        signal: controller.signal,
      });

      logger.info('Partner callback sent', {
        partnerId,
        webhookUrl,
        txnId: rawPayload.txnId,
        responseStatus: res.status,
      });
    } catch (fetchErr) {
      logger.error('Partner callback failed', {
        partnerId,
        webhookUrl,
        txnId: rawPayload.txnId,
        error: fetchErr.message,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    logger.error('Partner callback lookup error', {
      partnerId,
      error: err.message,
    });
  }
}

module.exports = { notifyPartner };
