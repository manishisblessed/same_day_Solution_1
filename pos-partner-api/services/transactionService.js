'use strict';

const db = require('../config/database');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Fetch POS transactions for a partner with filters and pagination.
 * CRITICAL: Always filters by validated partner_id from auth middleware.
 * Never trusts terminal_id from request without partner validation.
 */
async function getTransactions({
  partnerId,
  dateFrom,
  dateTo,
  status,
  terminalId,
  paymentMode,
  settlementStatus,
  page = 1,
  pageSize = 50,
}) {
  // Enforce max page size
  pageSize = Math.min(pageSize, config.security.maxPageSize);

  const conditions = ['pt.partner_id = $1'];
  const params = [partnerId];
  let paramIndex = 2;

  // Date range filter
  if (dateFrom) {
    conditions.push(`pt.txn_time >= $${paramIndex}`);
    params.push(dateFrom);
    paramIndex++;
  }
  if (dateTo) {
    conditions.push(`pt.txn_time <= $${paramIndex}`);
    params.push(dateTo);
    paramIndex++;
  }

  // Status filter
  if (status) {
    conditions.push(`pt.status = $${paramIndex}`);
    params.push(status.toUpperCase());
    paramIndex++;
  }

  // Terminal filter (validated against partner ownership)
  if (terminalId) {
    conditions.push(`pt.terminal_id = $${paramIndex}`);
    params.push(terminalId);
    paramIndex++;
  }

  // Payment mode filter
  if (paymentMode) {
    conditions.push(`pt.payment_mode = $${paramIndex}`);
    params.push(paymentMode.toUpperCase());
    paramIndex++;
  }

  // Settlement status filter
  if (settlementStatus) {
    conditions.push(`pt.settlement_status = $${paramIndex}`);
    params.push(settlementStatus.toUpperCase());
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;

  // Count query (for pagination)
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM pos_transactions pt
    WHERE ${whereClause}
  `;

  // Summary query (aggregates)
  const summaryQuery = `
    SELECT 
      COUNT(*) AS total_transactions,
      COALESCE(SUM(pt.amount), 0) AS total_amount,
      COUNT(*) FILTER (WHERE pt.status = 'AUTHORIZED') AS authorized_count,
      COUNT(*) FILTER (WHERE pt.status = 'CAPTURED') AS captured_count,
      COUNT(*) FILTER (WHERE pt.status = 'FAILED') AS failed_count,
      COUNT(*) FILTER (WHERE pt.status = 'REFUNDED') AS refunded_count,
      COALESCE(SUM(pt.amount) FILTER (WHERE pt.status = 'CAPTURED'), 0) AS captured_amount,
      COUNT(DISTINCT pt.terminal_id) AS terminal_count
    FROM pos_transactions pt
    WHERE ${whereClause}
  `;

  // Data query with pagination
  const dataQuery = `
    SELECT 
      pt.id,
      pt.razorpay_txn_id,
      pt.external_ref,
      pt.terminal_id,
      pt.amount,
      pt.status,
      pt.rrn,
      pt.card_brand,
      pt.card_type,
      pt.payment_mode,
      pt.settlement_status,
      pt.device_serial,
      pt.txn_time,
      pt.created_at,
      pr.retailer_code,
      pr.name AS retailer_name
    FROM pos_transactions pt
    LEFT JOIN partner_retailers pr ON pr.id = pt.retailer_id
    WHERE ${whereClause}
    ORDER BY pt.txn_time DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  // Execute all queries in parallel
  const [countResult, summaryResult, dataResult] = await Promise.all([
    db.query(countQuery, params),
    db.query(summaryQuery, params),
    db.query(dataQuery, [...params, pageSize, offset]),
  ]);

  const total = parseInt(countResult.rows[0].total, 10);
  const summary = summaryResult.rows[0];

  // Convert amounts from paisa to rupees in summary
  const formattedSummary = {
    total_transactions: parseInt(summary.total_transactions, 10),
    total_amount_paisa: parseInt(summary.total_amount, 10),
    total_amount_rupees: (parseInt(summary.total_amount, 10) / 100).toFixed(2),
    authorized_count: parseInt(summary.authorized_count, 10),
    captured_count: parseInt(summary.captured_count, 10),
    failed_count: parseInt(summary.failed_count, 10),
    refunded_count: parseInt(summary.refunded_count, 10),
    captured_amount_paisa: parseInt(summary.captured_amount, 10),
    captured_amount_rupees: (parseInt(summary.captured_amount, 10) / 100).toFixed(2),
    terminal_count: parseInt(summary.terminal_count, 10),
  };

  return {
    transactions: dataResult.rows,
    total,
    page,
    pageSize,
    summary: formattedSummary,
  };
}

/**
 * Process incoming Razorpay POS webhook payload.
 * 
 * - Extracts terminal_id (tid)
 * - Matches with partner_pos_machines
 * - Gets partner_id and retailer_id
 * - Inserts/updates pos_transactions
 * - Prevents duplicate txnId insertion
 * - Supports status progression (AUTHORIZED → CAPTURED)
 */
async function processWebhookTransaction(payload) {
  const {
    txnId,
    tid,
    amount,
    status,
    rrNumber,
    paymentMode,
    paymentCardType,
    paymentCardBrand,
    postingDate,
    settlementStatus,
    externalRefNumber,
    deviceSerial,
  } = payload;

  // Validate required fields
  if (!txnId || !tid) {
    logger.warn('Webhook missing txnId or tid', { txnId, tid });
    return { success: false, error: 'Missing txnId or tid', action: 'rejected' };
  }

  // Look up terminal in pos_machines
  const machineResult = await db.query(
    `SELECT pm.id, pm.partner_id, pm.retailer_id, pm.status
     FROM partner_pos_machines pm
     WHERE pm.terminal_id = $1`,
    [tid]
  );

  if (machineResult.rows.length === 0) {
    logger.warn('Unknown terminal ID from webhook', { tid, txnId });
    return { success: false, error: `Unknown terminal_id: ${tid}`, action: 'unmatched' };
  }

  const machine = machineResult.rows[0];

  if (machine.status !== 'active') {
    logger.warn('Webhook for inactive terminal', { tid, status: machine.status });
    return { success: false, error: 'Terminal is not active', action: 'rejected' };
  }

  const txnTime = postingDate ? new Date(postingDate) : new Date();

  // Check for existing transaction (dedup)
  const existingResult = await db.query(
    `SELECT id, status FROM pos_transactions
     WHERE razorpay_txn_id = $1 AND txn_time >= ($2::timestamptz - interval '1 day') AND txn_time <= ($2::timestamptz + interval '1 day')`,
    [txnId, txnTime]
  );

  if (existingResult.rows.length > 0) {
    const existing = existingResult.rows[0];
    
    // Allow status progression: AUTHORIZED → CAPTURED
    const statusOrder = { AUTHORIZED: 1, CAPTURED: 2, FAILED: 3, REFUNDED: 4, VOIDED: 5 };
    const newStatusRank = statusOrder[status] || 0;
    const existingStatusRank = statusOrder[existing.status] || 0;

    if (newStatusRank > existingStatusRank) {
      // Update status
      await db.query(
        `UPDATE pos_transactions 
         SET status = $1, settlement_status = $2, updated_at = NOW()
         WHERE id = $3 AND txn_time >= ($4::timestamptz - interval '1 day') AND txn_time <= ($4::timestamptz + interval '1 day')`,
        [status, settlementStatus || 'PENDING', existing.id, txnTime]
      );
      logger.info('Transaction status updated', {
        txnId,
        oldStatus: existing.status,
        newStatus: status,
      });
      return { success: true, action: 'updated', transactionId: existing.id };
    }

    logger.info('Duplicate webhook ignored', { txnId, existingStatus: existing.status });
    return { success: true, action: 'duplicate', transactionId: existing.id };
  }

  // Insert new transaction
  const insertResult = await db.query(
    `INSERT INTO pos_transactions (
      partner_id, retailer_id, terminal_id,
      razorpay_txn_id, external_ref, amount, status,
      rrn, card_brand, card_type, payment_mode,
      settlement_status, device_serial, txn_time, raw_payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING id`,
    [
      machine.partner_id,
      machine.retailer_id,
      tid,
      txnId,
      externalRefNumber || null,
      amount,
      status || 'AUTHORIZED',
      rrNumber || null,
      paymentCardBrand || null,
      paymentCardType || null,
      paymentMode || null,
      settlementStatus || 'PENDING',
      deviceSerial || null,
      txnTime,
      JSON.stringify(payload),
    ]
  );

  const transactionId = insertResult.rows[0].id;

  // Update last_txn_at on pos machine
  db.query(
    'UPDATE partner_pos_machines SET last_txn_at = NOW() WHERE terminal_id = $1',
    [tid]
  ).catch(err => logger.error('Failed to update last_txn_at', { error: err.message }));

  logger.info('New transaction inserted', {
    transactionId,
    txnId,
    tid,
    amount,
    status,
    partnerId: machine.partner_id,
  });

  return { success: true, action: 'inserted', transactionId };
}

module.exports = {
  getTransactions,
  processWebhookTransaction,
};


