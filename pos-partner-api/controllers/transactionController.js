'use strict';

const transactionService = require('../services/transactionService');
const { BadRequestError } = require('../utils/errors');
const { paginated } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * POST /api/partner/pos-transactions
 * 
 * Fetch POS transactions for the authenticated partner.
 * Always filters by validated partner_id from auth middleware.
 * 
 * Body:
 *   date_from       - ISO date string (required)
 *   date_to         - ISO date string (required)
 *   status          - AUTHORIZED | CAPTURED | FAILED | REFUNDED | VOIDED
 *   terminal_id     - Filter by terminal
 *   payment_mode    - CARD | UPI | NFC
 *   page            - Page number (default 1)
 *   page_size       - Records per page (default 50, max 100)
 */
async function getTransactions(req, res, next) {
  try {
    const partnerId = req.partner.id; // From auth middleware - TRUSTED

    const {
      date_from,
      date_to,
      status,
      terminal_id,
      payment_mode,
      page = 1,
      page_size = 50,
    } = req.body;

    // Validate required date filters
    if (!date_from || !date_to) {
      throw new BadRequestError('date_from and date_to are required');
    }

    // Validate date formats
    const dateFrom = new Date(date_from);
    const dateTo = new Date(date_to);
    if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
      throw new BadRequestError('Invalid date format. Use ISO 8601 (e.g., 2026-02-16)');
    }

    // Prevent excessively large date ranges (max 90 days)
    const daysDiff = (dateTo - dateFrom) / (1000 * 60 * 60 * 24);
    if (daysDiff > 90) {
      throw new BadRequestError('Date range cannot exceed 90 days');
    }
    if (daysDiff < 0) {
      throw new BadRequestError('date_from must be before date_to');
    }

    // Validate status
    const validStatuses = ['AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'VOIDED'];
    if (status && !validStatuses.includes(status.toUpperCase())) {
      throw new BadRequestError(`Invalid status. Allowed: ${validStatuses.join(', ')}`);
    }

    // Validate payment mode
    const validModes = ['CARD', 'UPI', 'NFC'];
    if (payment_mode && !validModes.includes(payment_mode.toUpperCase())) {
      throw new BadRequestError(`Invalid payment_mode. Allowed: ${validModes.join(', ')}`);
    }

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(page_size, 10) || 50));

    const result = await transactionService.getTransactions({
      partnerId,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      status: status || null,
      terminalId: terminal_id || null,
      paymentMode: payment_mode || null,
      page: pageNum,
      pageSize: pageSizeNum,
    });

    return paginated(res, {
      data: result.transactions,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      summary: result.summary,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getTransactions,
};


