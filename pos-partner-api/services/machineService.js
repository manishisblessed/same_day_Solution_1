'use strict';

const db = require('../config/database');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Fetch POS machines assigned to a partner with filters and pagination.
 * Always filters by validated partner_id from auth middleware.
 */
async function getMachines({
  partnerId,
  status,
  machineType,
  search,
  page = 1,
  limit = 50,
}) {
  // Enforce max page size
  limit = Math.min(limit, config.security.maxPageSize);

  const conditions = ['pm.partner_id = $1'];
  const params = [partnerId];
  let paramIndex = 2;

  // Status filter
  if (status) {
    conditions.push(`pm.status = $${paramIndex}`);
    params.push(status.toLowerCase());
    paramIndex++;
  }

  // Machine model / type filter
  if (machineType) {
    conditions.push(`pm.machine_model ILIKE $${paramIndex}`);
    params.push(`%${machineType}%`);
    paramIndex++;
  }

  // Search across multiple fields
  if (search) {
    conditions.push(
      `(pm.terminal_id ILIKE $${paramIndex} OR pm.device_serial ILIKE $${paramIndex} OR pm.machine_model ILIKE $${paramIndex})`
    );
    params.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');
  const offset = (page - 1) * limit;

  // Count query
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM partner_pos_machines pm
    WHERE ${whereClause}
  `;

  // Data query with pagination
  const dataQuery = `
    SELECT 
      pm.id,
      pm.terminal_id,
      pm.device_serial,
      pm.machine_model,
      pm.status,
      pm.activated_at,
      pm.last_txn_at,
      pm.metadata,
      pm.created_at,
      pm.updated_at,
      pr.retailer_code,
      pr.name AS retailer_name,
      pr.business_name AS retailer_business_name,
      pr.city AS retailer_city,
      pr.state AS retailer_state
    FROM partner_pos_machines pm
    LEFT JOIN partner_retailers pr ON pr.id = pm.retailer_id
    WHERE ${whereClause}
    ORDER BY pm.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  // Execute both queries in parallel
  const [countResult, dataResult] = await Promise.all([
    db.query(countQuery, params),
    db.query(dataQuery, [...params, limit, offset]),
  ]);

  const total = parseInt(countResult.rows[0].total, 10);

  return {
    machines: dataResult.rows,
    total,
    page,
    limit,
  };
}

module.exports = {
  getMachines,
};

