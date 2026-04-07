'use strict';

const logger = require('../utils/logger');

/**
 * In-memory store for received test callbacks.
 * Keeps the last 50 callbacks for inspection via GET.
 */
const receivedCallbacks = [];
const MAX_STORED = 50;

/**
 * POST /api/test-callback/receive
 *
 * Test endpoint that mimics what a partner's webhook would do.
 * Receives the callback payload, logs it, stores it in memory,
 * and returns 200 OK — exactly like a real partner endpoint should.
 *
 * Use this to verify the callback flow before telling the partner.
 */
async function receiveCallback(req, res) {
  const startTime = Date.now();

  try {
    const payload = req.body;

    const entry = {
      received_at: new Date().toISOString(),
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
        'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
      },
      body: payload,
    };

    receivedCallbacks.unshift(entry);
    if (receivedCallbacks.length > MAX_STORED) {
      receivedCallbacks.length = MAX_STORED;
    }

    const duration = Date.now() - startTime;
    logger.info('Test callback received', {
      event: payload.event,
      txnId: payload.data?.txnId,
      status: payload.data?.status,
      amount: payload.data?.amount,
      duration: `${duration}ms`,
      totalStored: receivedCallbacks.length,
    });

    return res.status(200).json({
      status: 'success',
      message: 'Transaction received',
    });
  } catch (error) {
    logger.error('Test callback error', { error: error.message });
    return res.status(200).json({
      status: 'error',
      message: error.message,
    });
  }
}

/**
 * GET /api/test-callback/list
 *
 * View all received test callbacks (most recent first).
 * Useful for verifying what data the partner would receive.
 */
async function listCallbacks(req, res) {
  return res.status(200).json({
    success: true,
    total: receivedCallbacks.length,
    message: `Last ${receivedCallbacks.length} callbacks (max ${MAX_STORED})`,
    callbacks: receivedCallbacks,
  });
}

/**
 * DELETE /api/test-callback/clear
 *
 * Clear all stored test callbacks.
 */
async function clearCallbacks(req, res) {
  const count = receivedCallbacks.length;
  receivedCallbacks.length = 0;
  logger.info('Test callbacks cleared', { count });
  return res.status(200).json({
    success: true,
    message: `Cleared ${count} callbacks`,
  });
}

module.exports = {
  receiveCallback,
  listCallbacks,
  clearCallbacks,
};
