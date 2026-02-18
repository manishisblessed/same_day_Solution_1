'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Global API rate limiter
 * Limits requests per IP within a time window
 */
const globalRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use partner_id if authenticated, otherwise IP
    return req.partner ? req.partner.id : req.ip;
  },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      partnerId: req.partner?.id,
      path: req.path,
    });
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        retry_after: Math.ceil(config.rateLimit.windowMs / 1000),
      },
    });
  },
});

/**
 * Stricter rate limiter for export endpoints
 */
const exportRateLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 5, // max 5 export requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.partner ? `export:${req.partner.id}` : `export:${req.ip}`;
  },
  handler: (req, res) => {
    logger.warn('Export rate limit exceeded', {
      ip: req.ip,
      partnerId: req.partner?.id,
    });
    res.status(429).json({
      success: false,
      error: {
        code: 'EXPORT_RATE_LIMIT',
        message: 'Export rate limit exceeded. Max 5 export requests per minute.',
        retry_after: 60,
      },
    });
  },
});

/**
 * Webhook rate limiter (generous, we don't want to drop webhooks)
 */
const webhookRateLimiter = rateLimit({
  windowMs: 60000,
  max: 500, // 500 webhooks per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.error('Webhook rate limit exceeded - possible attack', { ip: req.ip });
    res.status(429).json({ received: false, error: 'Rate limited' });
  },
});

module.exports = {
  globalRateLimiter,
  exportRateLimiter,
  webhookRateLimiter,
};


