'use strict';

const db = require('../config/database');
const logger = require('../utils/logger');
const { ExportLimitError, NotFoundError } = require('../utils/errors');

/**
 * Create a new export job after validating daily limit.
 */
async function createExportJob({ partnerId, format, filters }) {
  // 1. Get partner's daily limit
  const limitResult = await db.query(
    `SELECT daily_limit, max_records_per_export
     FROM partner_export_limits
     WHERE partner_id = $1`,
    [partnerId]
  );

  const dailyLimit = limitResult.rows.length > 0
    ? limitResult.rows[0].daily_limit
    : 10; // default
  const maxRecords = limitResult.rows.length > 0
    ? limitResult.rows[0].max_records_per_export
    : 500000;

  // 2. Check today's usage
  const usageResult = await db.query(
    `SELECT COUNT(*)::int AS today_count
     FROM export_jobs
     WHERE partner_id = $1
       AND created_at::date = CURRENT_DATE`,
    [partnerId]
  );

  const todayCount = usageResult.rows[0].today_count;

  if (todayCount >= dailyLimit) {
    throw new ExportLimitError(
      `Daily export limit reached (${todayCount}/${dailyLimit}). Try again tomorrow.`
    );
  }

  // 3. Validate format
  const allowedFormats = ['csv', 'excel', 'pdf', 'zip'];
  if (!allowedFormats.includes(format)) {
    format = 'csv';
  }

  // 4. Create the export job
  const insertResult = await db.query(
    `INSERT INTO export_jobs (partner_id, status, format, filters, started_at)
     VALUES ($1, 'PROCESSING', $2, $3, NOW())
     RETURNING id, status, format, created_at`,
    [partnerId, format, JSON.stringify(filters)]
  );

  const job = insertResult.rows[0];

  logger.info('Export job created', {
    jobId: job.id,
    partnerId,
    format,
    todayCount: todayCount + 1,
    dailyLimit,
  });

  return {
    job_id: job.id,
    status: job.status,
    format: job.format,
    created_at: job.created_at,
    exports_today: todayCount + 1,
    daily_limit: dailyLimit,
  };
}

/**
 * Get export job status. Only returns jobs belonging to the partner.
 */
async function getExportJobStatus(jobId, partnerId) {
  const result = await db.query(
    `SELECT 
      id AS job_id,
      status,
      format,
      file_url,
      file_size_bytes,
      total_records,
      error_message,
      started_at,
      completed_at,
      expires_at,
      created_at
     FROM export_jobs
     WHERE id = $1 AND partner_id = $2`,
    [jobId, partnerId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Export job not found');
  }

  const job = result.rows[0];

  // Check if signed URL has expired
  if (job.status === 'COMPLETED' && job.expires_at) {
    const expiresAt = new Date(job.expires_at);
    if (expiresAt < new Date()) {
      job.file_url = null;
      job.status = 'EXPIRED';
    }
  }

  return job;
}

module.exports = {
  createExportJob,
  getExportJobStatus,
};


