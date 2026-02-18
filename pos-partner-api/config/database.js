'use strict';

const { Pool } = require('pg');
const config = require('./index');
const logger = require('../utils/logger');

// Create connection pool
const pool = new Pool({
  connectionString: config.db.connectionString,
  min: config.db.pool.min,
  max: config.db.pool.max,
  idleTimeoutMillis: config.db.pool.idleTimeoutMillis,
  connectionTimeoutMillis: config.db.pool.connectionTimeoutMillis,
  ssl: config.db.ssl,
});

// Pool event handlers
pool.on('connect', () => {
  logger.debug('New database connection established');
});

pool.on('error', (err) => {
  logger.error('Unexpected database pool error:', err);
});

/**
 * Execute a parameterized query
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Query executed', {
      query: text.substring(0, 100),
      duration: `${duration}ms`,
      rows: result.rowCount,
    });
    return result;
  } catch (error) {
    logger.error('Query error', {
      query: text.substring(0, 200),
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get a client from the pool (for transactions or cursors)
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
  const client = await pool.connect();
  return client;
}

/**
 * Execute queries within a transaction
 * @param {Function} callback - async function receiving client
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Health check - verify database connectivity
 */
async function healthCheck() {
  try {
    const result = await pool.query('SELECT NOW() AS time, current_database() AS db');
    return {
      status: 'healthy',
      time: result.rows[0].time,
      database: result.rows[0].db,
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingConnections: pool.waitingCount,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
    };
  }
}

/**
 * Gracefully shut down the pool
 */
async function shutdown() {
  logger.info('Shutting down database pool...');
  await pool.end();
  logger.info('Database pool closed');
}

module.exports = {
  pool,
  query,
  getClient,
  withTransaction,
  healthCheck,
  shutdown,
};


