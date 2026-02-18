'use strict';

const logger = require('../utils/logger');

/**
 * Request/Response logging middleware
 * Logs method, path, status, and duration
 */
function requestLogger(req, res, next) {
  const start = Date.now();

  // Capture response finish event
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      partnerId: req.partner?.id || 'unauthenticated',
      userAgent: req.get('User-Agent')?.substring(0, 100),
    };

    if (res.statusCode >= 500) {
      logger.error('Request completed with server error', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Request completed with client error', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });

  next();
}

module.exports = requestLogger;


