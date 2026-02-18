'use strict';

const { ApiError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Global error handler middleware
 * Must be registered last in middleware chain
 */
function errorHandler(err, req, res, _next) {
  // Log the error
  if (err instanceof ApiError) {
    logger.warn('API Error', {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      path: req.path,
      partnerId: req.partner?.id,
    });
  } else {
    logger.error('Unhandled Error', {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      partnerId: req.partner?.id,
    });
  }

  // Handle known API errors
  if (err instanceof ApiError) {
    const response = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    };
    if (err.details) {
      response.error.details = err.details;
    }
    return res.status(err.statusCode).json(response);
  }

  // Handle JSON parse errors
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Request body contains invalid JSON',
      },
    });
  }

  // Handle payload too large
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds maximum size',
      },
    });
  }

  // Generic 500 error (never leak stack traces in production)
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message:
        process.env.NODE_ENV === 'production'
          ? 'An internal server error occurred'
          : err.message,
    },
  });
}

/**
 * 404 handler for unmatched routes
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
  });
}

module.exports = { errorHandler, notFoundHandler };


