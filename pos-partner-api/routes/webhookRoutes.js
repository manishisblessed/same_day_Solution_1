'use strict';

const express = require('express');
const router = express.Router();

const { webhookRateLimiter } = require('../middleware/rateLimiter');
const webhookController = require('../controllers/webhookController');

// ============================================================================
// POST /api/webhook/razorpay-pos
// Razorpay POS webhook endpoint (no partner auth - uses Razorpay signature)
// ============================================================================
router.post(
  '/razorpay-pos',
  webhookRateLimiter,
  webhookController.handleRazorpayPosWebhook
);

module.exports = router;


