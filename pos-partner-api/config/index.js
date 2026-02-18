'use strict';

require('dotenv').config();

const config = {
  // Server
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 4000,
  apiPrefix: process.env.API_PREFIX || '/api/partner',

  // Database
  db: {
    connectionString: process.env.DATABASE_URL,
    pool: {
      min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
      max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) || 5000,
    },
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  },

  // AWS S3
  aws: {
    region: process.env.AWS_REGION || 'ap-south-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.S3_BUCKET_NAME || 'sameday-pos-exports',
    signedUrlExpiry: parseInt(process.env.S3_SIGNED_URL_EXPIRY, 10) || 3600,
  },

  // Razorpay
  razorpay: {
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },

  // Security
  security: {
    hmacTimestampToleranceMs: parseInt(process.env.HMAC_TIMESTAMP_TOLERANCE_MS, 10) || 300000, // 5 min
    maxPageSize: parseInt(process.env.MAX_PAGE_SIZE, 10) || 100,
    defaultPageSize: parseInt(process.env.DEFAULT_PAGE_SIZE, 10) || 50,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },

  // Export Worker
  exportWorker: {
    pollIntervalMs: parseInt(process.env.EXPORT_WORKER_POLL_INTERVAL_MS, 10) || 5000,
    batchSize: parseInt(process.env.EXPORT_WORKER_BATCH_SIZE, 10) || 5000,
    streamHighWaterMark: parseInt(process.env.EXPORT_STREAM_HIGH_WATER_MARK, 10) || 1000,
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/api.log',
  },

  // CORS
  cors: {
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
      : ['*'],
  },
};

// Validate critical config
const requiredVars = ['DATABASE_URL'];
for (const varName of requiredVars) {
  if (!process.env[varName]) {
    console.error(`FATAL: Missing required environment variable: ${varName}`);
    process.exit(1);
  }
}

module.exports = config;


