'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./config/database');

// Route imports
const partnerRoutes = require('./routes/partnerRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const healthRoutes = require('./routes/healthRoutes');

// Middleware imports
const requestLogger = require('./middleware/requestLogger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// ============================================================================
// Express App Setup
// ============================================================================
const app = express();

// ============================================================================
// Security Middleware
// ============================================================================
app.use(helmet({
  contentSecurityPolicy: false, // API server, no HTML
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: config.cors.allowedOrigins,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'x-signature', 'x-timestamp'],
  maxAge: 86400, // 24h preflight cache
}));

// ============================================================================
// Body Parsing
// ============================================================================
// Capture raw body for webhook signature verification
app.use('/api/webhook', express.json({
  limit: '1mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));

// Standard JSON parser for partner routes
app.use(express.json({ limit: '512kb' }));

// ============================================================================
// Compression
// ============================================================================
app.use(compression());

// ============================================================================
// Request Logging
// ============================================================================
app.use(requestLogger);

// ============================================================================
// Trust proxy (behind nginx/ALB)
// ============================================================================
app.set('trust proxy', 1);

// ============================================================================
// Routes
// ============================================================================

// Health check (no auth) — /pos-health for external partners, /health for internal monitoring
app.use('/pos-health', healthRoutes);
app.use('/health', healthRoutes);

// Webhook routes (Razorpay signature auth, not partner HMAC)
app.use('/api/webhook', webhookRoutes);

// Partner API routes (HMAC auth)
app.use(config.apiPrefix, partnerRoutes);

// ============================================================================
// Error Handling
// ============================================================================
app.use(notFoundHandler);
app.use(errorHandler);

// ============================================================================
// Server Startup
// ============================================================================
const PORT = config.port;

async function startServer() {
  try {
    // Verify database connectivity
    const dbHealth = await db.healthCheck();
    if (dbHealth.status !== 'healthy') {
      throw new Error(`Database health check failed: ${JSON.stringify(dbHealth)}`);
    }
    logger.info('Database connection verified', {
      database: dbHealth.database,
      connections: dbHealth.totalConnections,
    });

    // Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info(`POS Partner API started`, {
        port: PORT,
        env: config.env,
        apiPrefix: config.apiPrefix,
        pid: process.pid,
      });
      console.log(`
╔═══════════════════════════════════════════════════════╗
║          POS Partner API - Same Day Solution          ║
╠═══════════════════════════════════════════════════════╣
║  Status  : RUNNING                                    ║
║  Port    : ${String(PORT).padEnd(42)}║
║  Env     : ${String(config.env).padEnd(42)}║
║  API     : ${String(config.apiPrefix).padEnd(42)}║
║  Webhook : /api/webhook/razorpay-pos                  ║
║  Health  : /pos-health (public) | /health (internal)  ║
╚═══════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}. Graceful shutdown...`);
      server.close(async () => {
        await db.shutdown();
        logger.info('Server shut down gracefully');
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Unhandled rejection / exception handlers
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection', { reason: reason?.message || reason });
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
      process.exit(1);
    });

    return server;
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

startServer();

module.exports = app; // For testing


