'use strict';

const transactionService = require('../services/transactionService');
const { verifyRazorpaySignature } = require('../utils/crypto');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * POST /api/webhook/razorpay-pos
 * 
 * Handles incoming Razorpay POS webhook notifications.
 * 
 * Webhook payload example:
 * {
 *   "txnId": "260216093324974E883523117",
 *   "tid": "96192813",
 *   "amount": 100,
 *   "status": "AUTHORIZED",
 *   "rrNumber": "000000000012",
 *   "paymentMode": "CARD",
 *   "paymentCardType": "CREDIT",
 *   "paymentCardBrand": "VISA",
 *   "postingDate": "2026-02-16T09:33:26.000+0000",
 *   "settlementStatus": "PENDING",
 *   "externalRefNumber": "EZ202602161503118508",
 *   "deviceSerial": "2841157353"
 * }
 * 
 * CRITICAL: Always return 200 OK to prevent Razorpay retries
 */
async function handleRazorpayPosWebhook(req, res) {
  const startTime = Date.now();

  try {
    const payload = req.body;

    // Log incoming webhook
    logger.info('Razorpay POS webhook received', {
      txnId: payload.txnId,
      tid: payload.tid,
      status: payload.status,
      amount: payload.amount,
    });

    // Verify Razorpay signature if present and secret is configured
    const signature = req.headers['x-razorpay-signature'];
    if (signature && config.razorpay.webhookSecret) {
      // For signature verification we need the raw body
      const rawBody = req.rawBody || JSON.stringify(payload);
      const isValid = verifyRazorpaySignature(
        rawBody,
        signature,
        config.razorpay.webhookSecret
      );

      if (!isValid) {
        logger.error('Invalid Razorpay webhook signature', {
          txnId: payload.txnId,
          tid: payload.tid,
        });
        // Still return 200 to prevent retries, but log for investigation
        return res.status(200).json({
          success: false,
          data: {
            message: 'Invalid signature',
            txnId: payload.txnId || null,
            action: 'rejected',
          },
        });
      }
    }

    // Validate minimum required fields
    if (!payload.txnId || !payload.tid) {
      logger.warn('Webhook missing required fields', { payload });
      return res.status(200).json({
        success: false,
        data: {
          message: 'Missing required fields: txnId, tid',
          txnId: payload.txnId || null,
          action: 'rejected',
        },
      });
    }

    // Process the transaction
    const result = await transactionService.processWebhookTransaction(payload);

    const duration = Date.now() - startTime;
    logger.info('Webhook processed', {
      txnId: payload.txnId,
      action: result.action,
      success: result.success,
      duration: `${duration}ms`,
    });

    return res.status(200).json({
      success: result.success,
      data: {
        message: 'Transaction processed',
        txnId: payload.txnId,
        action: result.action,
        transaction_id: result.transactionId || null,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Webhook processing error', {
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`,
    });

    // ALWAYS return 200 to prevent Razorpay retries
    return res.status(200).json({
      success: false,
      data: {
        message: 'Internal processing error',
        action: 'error',
      },
    });
  }
}

module.exports = {
  handleRazorpayPosWebhook,
};


