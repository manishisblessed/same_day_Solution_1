'use strict';

const express = require('express');
const router = express.Router();
const db = require('../config/database');

/**
 * GET /pos-health  (external — documented in Postman collection)
 * GET /health      (internal — for load balancer / monitoring)
 * Basic health check - no auth required
 */
router.get('/', async (req, res) => {
  try {
    const dbHealth = await db.healthCheck();
    const isHealthy = dbHealth.status === 'healthy';

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'degraded',
      service: 'pos-partner-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      database: {
        status: dbHealth.status,
        latency_ms: dbHealth.latency_ms || null,
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
});

module.exports = router;


