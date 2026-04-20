'use strict';

const db = require('../config/database');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Auto-sync machines from pos_machines (source of truth) to partner_pos_machines (cache).
 * Inserts any machine assigned to the partner that's missing from partner_pos_machines.
 * This ensures the partner API always returns the latest count without manual sync.
 */
async function autoSyncPartnerMachines(partnerId) {
  try {
    // Step 1: Get or create default retailer for this partner
    let retailerId = null;
    const retailerResult = await db.query(
      `SELECT id FROM partner_retailers WHERE partner_id = $1 LIMIT 1`,
      [partnerId]
    );

    if (retailerResult.rows.length > 0) {
      retailerId = retailerResult.rows[0].id;
    } else {
      // Get partner info to create default retailer
      const partnerResult = await db.query(
        `SELECT name, business_name FROM partners WHERE id = $1 LIMIT 1`,
        [partnerId]
      );
      if (partnerResult.rows.length > 0) {
        const partner = partnerResult.rows[0];
        const retailerCode = `RET-${partner.name.toUpperCase().replace(/\s+/g, '-')}-001`;
        const newRetailer = await db.query(
          `INSERT INTO partner_retailers (partner_id, retailer_code, name, business_name, status)
           VALUES ($1, $2, $3, $4, 'active')
           RETURNING id`,
          [partnerId, retailerCode, `${partner.name} Default Retailer`, partner.business_name || partner.name]
        );
        if (newRetailer.rows.length > 0) {
          retailerId = newRetailer.rows[0].id;
        }
      }
    }

    // Step 2: Find machines in pos_machines that are missing from partner_pos_machines
    // Insert missing ones with proper field mapping
    const syncQuery = `
      INSERT INTO partner_pos_machines (
        partner_id, retailer_id, terminal_id, device_serial,
        machine_model, status, activated_at, metadata
      )
      SELECT 
        $1::uuid AS partner_id,
        $2::uuid AS retailer_id,
        pm.tid AS terminal_id,
        pm.serial_number AS device_serial,
        CASE 
          WHEN pm.brand = 'RAZORPAY' THEN 'Razorpay POS'
          ELSE COALESCE(pm.brand, 'POS')
        END AS machine_model,
        CASE WHEN pm.status = 'active' THEN 'active' ELSE 'inactive' END AS status,
        COALESCE(pm.installation_date, NOW()) AS activated_at,
        CASE WHEN pm.mid IS NOT NULL THEN jsonb_build_object('mid', pm.mid) ELSE '{}'::jsonb END AS metadata
      FROM pos_machines pm
      WHERE pm.partner_id = $1
        AND pm.inventory_status = 'assigned_to_partner'
        AND pm.tid IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM partner_pos_machines ppm 
          WHERE ppm.terminal_id = pm.tid
        )
    `;

    const result = await db.query(syncQuery, [partnerId, retailerId]);
    if (result.rowCount > 0) {
      logger.info(`Auto-synced ${result.rowCount} missing machines for partner ${partnerId}`);
    }
  } catch (error) {
    // Log but don't fail the request - sync errors shouldn't block listing
    logger.error('Auto-sync error (non-fatal):', error.message);
  }
}

/**
 * Fetch POS machines assigned to a partner with filters and pagination.
 * Always filters by validated partner_id from auth middleware.
 * Auto-syncs missing machines from pos_machines before querying.
 */
async function getMachines({
  partnerId,
  status,
  machineType,
  search,
  page = 1,
  limit = 50,
}) {
  // Auto-sync any missing machines first
  await autoSyncPartnerMachines(partnerId);

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

