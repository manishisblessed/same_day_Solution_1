'use strict';

const exportService = require('../services/exportService');
const { BadRequestError } = require('../utils/errors');
const { success } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * POST /api/partner/pos-transactions/export
 * 
 * Create an async export job.
 * Validates daily export limit before creating.
 * 
 * Body:
 *   format      - csv | excel | pdf | zip (default: csv)
 *   date_from   - ISO date string (required)
 *   date_to     - ISO date string (required)
 *   status      - Optional filter
 *   terminal_id - Optional filter
 */
async function createExport(req, res, next) {
  try {
    const partnerId = req.partner.id;

    const {
      format = 'csv',
      date_from,
      date_to,
      status,
      terminal_id,
      payment_mode,
    } = req.body;

    // Validate dates
    if (!date_from || !date_to) {
      throw new BadRequestError('date_from and date_to are required');
    }

    const dateFrom = new Date(date_from);
    const dateTo = new Date(date_to);
    if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
      throw new BadRequestError('Invalid date format');
    }

    const daysDiff = (dateTo - dateFrom) / (1000 * 60 * 60 * 24);
    if (daysDiff > 90) {
      throw new BadRequestError('Export date range cannot exceed 90 days');
    }

    // Validate format
    const allowedFormats = ['csv', 'excel', 'pdf', 'zip'];
    if (!allowedFormats.includes(format)) {
      throw new BadRequestError(`Invalid format. Allowed: ${allowedFormats.join(', ')}`);
    }

    // Build filters object
    const filters = {
      partner_id: partnerId,
      date_from: dateFrom.toISOString(),
      date_to: dateTo.toISOString(),
    };
    if (status) filters.status = status.toUpperCase();
    if (terminal_id) filters.terminal_id = terminal_id;
    if (payment_mode) filters.payment_mode = payment_mode.toUpperCase();

    const result = await exportService.createExportJob({
      partnerId,
      format,
      filters,
    });

    return success(res, {
      message: 'Export job created. Use the job_id to check status.',
      ...result,
    }, 202);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/partner/export-status/:job_id
 * 
 * Get export job status and download URL.
 */
async function getExportStatus(req, res, next) {
  try {
    const partnerId = req.partner.id;
    const { job_id } = req.params;

    if (!job_id) {
      throw new BadRequestError('job_id is required');
    }

    // UUID validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(job_id)) {
      throw new BadRequestError('Invalid job_id format');
    }

    const result = await exportService.getExportJobStatus(job_id, partnerId);

    return success(res, { job: result });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createExport,
  getExportStatus,
};


