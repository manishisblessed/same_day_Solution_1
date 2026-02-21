'use strict';

const db = require('../config/database');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Fetch POS transactions for a partner with filters and pagination.
 * 
 * CRITICAL: Always filters by validated partner_id from auth middleware.
 * Never trusts terminal_id from request without partner validation.
 * 
 * Queries razorpay_pos_transactions (the actual data source populated by webhooks)
 * and maps terminals via partner_pos_machines + pos_machines to filter by partner.
 */
async function getTransactions({
  partnerId,
  dateFrom,
  dateTo,
  status,
  terminalId,
  paymentMode,
  page = 1,
  pageSize = 50,
}) {
  // Enforce max page size
  pageSize = Math.min(pageSize, config.security.maxPageSize);

  // =========================================================================
  // Step 1: Get all TIDs and device serials belonging to this partner
  // =========================================================================
  const machineQuery = `
    SELECT terminal_id AS tid, device_serial AS serial
    FROM partner_pos_machines
    WHERE partner_id = $1 AND status = 'active'
    UNION
    SELECT tid, serial_number AS serial
    FROM pos_machines
    WHERE partner_id = $1 AND status IN ('active', 'inactive')
  `;

  const machineResult = await db.query(machineQuery, [partnerId]);
  const tids = [];
  const serials = [];

  for (const row of machineResult.rows) {
    if (row.tid) tids.push(row.tid);
    if (row.serial) serials.push(row.serial);
  }

  // Deduplicate
  const uniqueTids = [...new Set(tids)];
  const uniqueSerials = [...new Set(serials)];

  logger.info('Partner transaction query - machines found', {
    partnerId,
    tids: uniqueTids,
    serials: uniqueSerials,
  });

  if (uniqueTids.length === 0 && uniqueSerials.length === 0) {
    return {
      transactions: [],
      total: 0,
      page,
      pageSize,
      summary: {
        total_transactions: 0,
        total_amount: '0.00',
        authorized_count: 0,
        captured_count: 0,
        failed_count: 0,
        refunded_count: 0,
        captured_amount: '0.00',
        terminal_count: 0,
      },
    };
  }

  // =========================================================================
  // Step 2: Build WHERE conditions for razorpay_pos_transactions
  // =========================================================================
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  // Machine ownership filter (TID or device serial must match)
  const ownershipParts = [];
  if (uniqueTids.length > 0) {
    ownershipParts.push(`rpt.tid = ANY($${paramIndex})`);
    params.push(uniqueTids);
    paramIndex++;
  }
  if (uniqueSerials.length > 0) {
    ownershipParts.push(`rpt.device_serial = ANY($${paramIndex})`);
    params.push(uniqueSerials);
    paramIndex++;
  }
  conditions.push(`(${ownershipParts.join(' OR ')})`);

  // Date range filter
  if (dateFrom) {
    conditions.push(`rpt.transaction_time >= $${paramIndex}`);
    params.push(dateFrom);
    paramIndex++;
  }
  if (dateTo) {
    conditions.push(`rpt.transaction_time <= $${paramIndex}`);
    params.push(dateTo);
    paramIndex++;
  }

  // Status filter (map CAPTURED to SUCCESS for display_status column)
  if (status) {
    const displayStatus = status.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : status.toUpperCase();
    conditions.push(`rpt.display_status = $${paramIndex}`);
    params.push(displayStatus);
    paramIndex++;
  }

  // Terminal filter (validated against partner ownership)
  if (terminalId) {
    if (!uniqueTids.includes(terminalId)) {
      return {
        transactions: [],
        total: 0,
        page,
        pageSize,
        summary: {
          total_transactions: 0,
          total_amount: '0.00',
          authorized_count: 0,
          captured_count: 0,
          failed_count: 0,
          refunded_count: 0,
          captured_amount: '0.00',
          terminal_count: 0,
        },
      };
    }
    conditions.push(`rpt.tid = $${paramIndex}`);
    params.push(terminalId);
    paramIndex++;
  }

  // Payment mode filter
  if (paymentMode) {
    conditions.push(`rpt.payment_mode = $${paramIndex}`);
    params.push(paymentMode.toUpperCase());
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;

  // =========================================================================
  // Step 3: Count, summary, and data queries on razorpay_pos_transactions
  // =========================================================================
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM razorpay_pos_transactions rpt
    WHERE ${whereClause}
  `;

  const summaryQuery = `
    SELECT 
      COUNT(*) AS total_transactions,
      COALESCE(SUM(rpt.amount), 0) AS total_amount,
      COUNT(*) FILTER (WHERE rpt.display_status = 'AUTHORIZED' OR rpt.status = 'AUTHORIZED') AS authorized_count,
      COUNT(*) FILTER (WHERE rpt.display_status = 'SUCCESS' OR rpt.status = 'CAPTURED') AS captured_count,
      COUNT(*) FILTER (WHERE rpt.display_status = 'FAILED' OR rpt.status = 'FAILED') AS failed_count,
      COUNT(*) FILTER (WHERE rpt.display_status = 'REFUNDED' OR rpt.status = 'REFUNDED') AS refunded_count,
      COALESCE(SUM(rpt.amount) FILTER (WHERE rpt.display_status = 'SUCCESS' OR rpt.status = 'CAPTURED'), 0) AS captured_amount,
      COUNT(DISTINCT rpt.tid) AS terminal_count
    FROM razorpay_pos_transactions rpt
    WHERE ${whereClause}
  `;

  const dataQuery = `
    SELECT 
      rpt.id,
      rpt.txn_id AS razorpay_txn_id,
      COALESCE(rpt.external_ref, rpt.raw_data->>'externalRefNumber') AS external_ref,
      rpt.tid AS terminal_id,
      TO_CHAR(rpt.amount, 'FM999999999990.00') AS amount,
      CASE 
        WHEN rpt.display_status = 'SUCCESS' THEN 'CAPTURED'
        ELSE COALESCE(rpt.display_status, rpt.status, 'PENDING')
      END AS status,
      COALESCE(rpt.rrn, rpt.raw_data->>'rrNumber') AS rrn,
      COALESCE(rpt.card_brand, rpt.raw_data->>'paymentCardBrand', rpt.raw_data->>'cardBrand') AS card_brand,
      COALESCE(rpt.card_type, rpt.raw_data->>'paymentCardType', rpt.raw_data->>'cardType') AS card_type,
      rpt.payment_mode,
      rpt.device_serial,
      rpt.transaction_time AS txn_time,
      rpt.created_at,
      COALESCE(rpt.customer_name, rpt.raw_data->>'customerName', rpt.raw_data->>'payerName') AS customer_name,
      COALESCE(rpt.payer_name, rpt.raw_data->>'payerName') AS payer_name,
      COALESCE(rpt.username, rpt.raw_data->>'username') AS username,
      COALESCE(rpt.txn_type, rpt.raw_data->>'txnType', 'CHARGE') AS txn_type,
      COALESCE(rpt.auth_code, rpt.raw_data->>'authCode') AS auth_code,
      COALESCE(rpt.card_number, rpt.raw_data->>'cardNumber', rpt.raw_data->>'maskedCardNumber') AS card_number,
      COALESCE(rpt.issuing_bank, rpt.raw_data->>'issuingBankName', rpt.raw_data->>'bankName', rpt.raw_data->>'issuingBank') AS issuing_bank,
      COALESCE(rpt.card_classification, rpt.raw_data->>'cardClassification', rpt.raw_data->>'cardCategory') AS card_classification,
      COALESCE(rpt.card_txn_type, rpt.raw_data->>'cardTxnType', rpt.raw_data->>'cardTransactionType', rpt.raw_data->>'entryMode') AS card_txn_type,
      COALESCE(rpt.acquiring_bank, rpt.raw_data->>'acquiringBank', rpt.raw_data->>'acquiringBankName', rpt.raw_data->>'acquirerCode') AS acquiring_bank,
      COALESCE(rpt.mid_code, rpt.raw_data->>'mid', rpt.raw_data->>'merchantId') AS mid,
      COALESCE(rpt.currency, rpt.raw_data->>'currencyCode', 'INR') AS currency,
      COALESCE(rpt.receipt_url, rpt.raw_data->>'customerReceiptUrl', rpt.raw_data->>'receiptUrl') AS receipt_url,
      rpt.posting_date
    FROM razorpay_pos_transactions rpt
    WHERE ${whereClause}
    ORDER BY rpt.transaction_time DESC
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

  const formattedSummary = {
    total_transactions: parseInt(summary.total_transactions, 10),
    total_amount: parseFloat(summary.total_amount).toFixed(2),
    authorized_count: parseInt(summary.authorized_count, 10),
    captured_count: parseInt(summary.captured_count, 10),
    failed_count: parseInt(summary.failed_count, 10),
    refunded_count: parseInt(summary.refunded_count, 10),
    captured_amount: parseFloat(summary.captured_amount).toFixed(2),
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

  // Extract additional detail fields from payload
  const customerName = payload.customerName || payload.payerName || null;
  const payerName = payload.payerName || null;
  const username = payload.username || null;
  const txnType = payload.txnType || 'CHARGE';
  const authCode = payload.authCode || null;
  const cardNumber = payload.cardNumber || payload.maskedCardNumber || payload.cardLastFourDigit || null;
  const issuingBank = payload.issuingBankName || payload.bankName || payload.issuingBank || null;
  const cardClassification = payload.cardClassification || payload.cardCategory || null;
  const mid = payload.mid || payload.merchantId || null;
  const currency = payload.currencyCode || payload.currency || 'INR';
  const receiptUrl = payload.customerReceiptUrl || payload.receiptUrl || null;
  const postingDateVal = postingDate ? new Date(postingDate) : null;
  const cardTxnType = payload.cardTxnType || payload.cardTransactionType || payload.entryMode || null;
  const acquiringBank = payload.acquiringBank || payload.acquiringBankName || payload.acquirerCode || null;
  const merchantName = payload.merchantName || null;

  // Insert new transaction
  const insertResult = await db.query(
    `INSERT INTO pos_transactions (
      partner_id, retailer_id, terminal_id,
      razorpay_txn_id, external_ref, amount, status,
      rrn, card_brand, card_type, payment_mode,
      settlement_status, device_serial, txn_time, raw_payload,
      customer_name, payer_name, username, txn_type, auth_code,
      card_number, issuing_bank, card_classification, mid, currency,
      receipt_url, posting_date, card_txn_type, acquiring_bank, merchant_name
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
              $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
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
      customerName,
      payerName,
      username,
      txnType,
      authCode,
      cardNumber,
      issuingBank,
      cardClassification,
      mid,
      currency,
      receiptUrl,
      postingDateVal,
      cardTxnType,
      acquiringBank,
      merchantName,
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

