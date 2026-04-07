'use strict';

const db = require('../config/database');
const logger = require('../utils/logger');

const CALLBACK_TIMEOUT_MS = 10000;

/**
 * Forward a processed POS transaction to the partner's configured webhook_url.
 * Fire-and-forget: failures are logged but never block the main webhook flow.
 */
async function notifyPartner(partnerId, transactionData) {
  if (!partnerId) return;

  try {
    const { rows } = await db.query(
      `SELECT webhook_url FROM partners WHERE id = $1 AND status = 'active'`,
      [partnerId]
    );

    const webhookUrl = rows[0]?.webhook_url;
    if (!webhookUrl) return;

    const payload = {
      event: 'pos.transaction',
      timestamp: new Date().toISOString(),
      data: {
        txnId: transactionData.txnId || transactionData.razorpay_txn_id,
        tid: transactionData.tid || transactionData.terminal_id,
        amount: transactionData.amount,
        status: transactionData.status,
        rrn: transactionData.rrNumber || transactionData.rrn || null,
        paymentMode: transactionData.paymentMode || transactionData.payment_mode || null,
        paymentCardType: transactionData.paymentCardType || transactionData.card_type || null,
        paymentCardBrand: transactionData.paymentCardBrand || transactionData.card_brand || null,
        externalRefNumber: transactionData.externalRefNumber || transactionData.external_ref || null,
        deviceSerial: transactionData.deviceSerial || transactionData.device_serial || null,
        postingDate: transactionData.postingDate || transactionData.posting_date || null,
        settlementStatus: transactionData.settlementStatus || transactionData.settlement_status || null,
        customerName: transactionData.customerName || transactionData.customer_name || null,
        txnType: transactionData.txnType || transactionData.txn_type || 'CHARGE',
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      logger.info('Partner callback sent', {
        partnerId,
        webhookUrl,
        txnId: payload.data.txnId,
        responseStatus: res.status,
      });
    } catch (fetchErr) {
      logger.error('Partner callback failed', {
        partnerId,
        webhookUrl,
        txnId: payload.data.txnId,
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
