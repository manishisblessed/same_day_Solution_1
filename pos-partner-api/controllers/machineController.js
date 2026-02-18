'use strict';

const machineService = require('../services/machineService');
const { BadRequestError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * GET /api/partner/pos-machines
 * 
 * Fetch POS machines assigned to the authenticated partner.
 * Always filters by validated partner_id from auth middleware.
 * 
 * Query params:
 *   page         - Page number (default 1)
 *   limit        - Records per page (default 50, max 100)
 *   status       - Filter: active, inactive, maintenance, decommissioned
 *   machine_type - Filter by machine model/type
 *   search       - Search by terminal_id, device_serial, machine_model
 */
async function getMachines(req, res, next) {
  try {
    const partnerId = req.partner.id; // From auth middleware - TRUSTED

    const {
      page = '1',
      limit = '50',
      status,
      machine_type,
      search,
    } = req.query;

    // Validate status if provided
    const validStatuses = ['active', 'inactive', 'maintenance', 'decommissioned'];
    if (status && !validStatuses.includes(status.toLowerCase())) {
      throw new BadRequestError(
        `Invalid status. Allowed: ${validStatuses.join(', ')}`
      );
    }

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    const result = await machineService.getMachines({
      partnerId,
      status: status || null,
      machineType: machine_type || null,
      search: search || null,
      page: pageNum,
      limit: limitNum,
    });

    const totalPages = Math.ceil(result.total / result.limit);

    return res.status(200).json({
      success: true,
      data: result.machines,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        total_pages: totalPages,
        has_next_page: result.page < totalPages,
        has_prev_page: result.page > 1,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getMachines,
};

