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
 * Dual-source strategy:
 *   1. pos_transactions — has partner_id directly (populated by Express webhook
 *      and Next.js webhook sync). Amount in PAISA (BIGINT).
 *   2. razorpay_pos_transactions — matched by TID/device_serial (populated by
 *      Next.js webhook). Amount in RUPEES (DECIMAL). Catches un-synced rows.
 *   3. Results are merged and deduplicated by razorpay_txn_id / txn_id.
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
  pageSize = Math.min(pageSize, config.security.maxPageSize);

  const EMPTY_SUMMARY = {
    total_transactions: 0,
    total_amount: '0.00',
    authorized_count: 0,
    captured_count: 0,
    failed_count: 0,
    refunded_count: 0,
    captured_amount: '0.00',
    terminal_count: 0,
  };

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

  const uniqueTids = [...new Set(tids)];
  const uniqueSerials = [...new Set(serials)];

  logger.info('Partner transaction query - machines found', {
    partnerId,
    tids: uniqueTids,
    serials: uniqueSerials,
  });

  if (uniqueTids.length === 0 && uniqueSerials.length === 0) {
    return { transactions: [], total: 0, page, pageSize, summary: EMPTY_SUMMARY };
  }

  // Terminal filter validation
  if (terminalId && !uniqueTids.includes(terminalId)) {
    return { transactions: [], total: 0, page, pageSize, summary: EMPTY_SUMMARY };
  }

  // =========================================================================
  // Step 2: Query BOTH tables in parallel
  // =========================================================================

  // --- Source A: pos_transactions (partner_id direct, amount in PAISA) ---
  const ptConditions = ['pt.partner_id = $1'];
  const ptParams = [partnerId];
  let ptIdx = 2;

  if (dateFrom) {
    ptConditions.push(`pt.txn_time >= $${ptIdx}`);
    ptParams.push(dateFrom);
    ptIdx++;
  }
  if (dateTo) {
    ptConditions.push(`pt.txn_time <= $${ptIdx}`);
    ptParams.push(dateTo);
    ptIdx++;
  }
  if (status) {
    ptConditions.push(`pt.status = $${ptIdx}`);
    ptParams.push(status.toUpperCase());
    ptIdx++;
  }
  if (terminalId) {
    ptConditions.push(`pt.terminal_id = $${ptIdx}`);
    ptParams.push(terminalId);
    ptIdx++;
  }
  if (paymentMode) {
    ptConditions.push(`pt.payment_mode = $${ptIdx}`);
    ptParams.push(paymentMode.toUpperCase());
    ptIdx++;
  }

  const ptWhere = ptConditions.join(' AND ');

  const ptDataQuery = `
    SELECT
      pt.id,
      pt.razorpay_txn_id,
      pt.external_ref,
      pt.terminal_id,
      TO_CHAR(pt.amount / 100.0, 'FM999999999990.00') AS amount,
      pt.status,
      pt.rrn,
      pt.card_brand,
      pt.card_type,
      pt.payment_mode,
      pt.device_serial,
      pt.txn_time,
      pt.created_at,
      COALESCE(pt.customer_name, pt.raw_payload->>'customerName', pt.raw_payload->>'payerName') AS customer_name,
      COALESCE(pt.payer_name, pt.raw_payload->>'payerName') AS payer_name,
      COALESCE(pt.username, pt.raw_payload->>'username') AS username,
      COALESCE(pt.txn_type, pt.raw_payload->>'txnType', 'CHARGE') AS txn_type,
      COALESCE(pt.auth_code, pt.raw_payload->>'authCode') AS auth_code,
      COALESCE(pt.card_number, pt.raw_payload->>'formattedPan', pt.raw_payload->>'cardNumber') AS card_number,
      COALESCE(pt.issuing_bank, pt.raw_payload->>'issuingBankName', pt.raw_payload->>'bankName') AS issuing_bank,
      COALESCE(pt.card_classification, pt.raw_payload->>'cardClassification') AS card_classification,
      COALESCE(pt.card_txn_type, pt.raw_payload->>'cardTxnType', pt.raw_payload->>'entryMode') AS card_txn_type,
      COALESCE(pt.acquiring_bank, pt.raw_payload->>'acquiringBank', pt.raw_payload->>'acquirerCode') AS acquiring_bank,
      COALESCE(pt.mid, pt.raw_payload->>'mid') AS mid,
      COALESCE(pt.currency, pt.raw_payload->>'currencyCode', 'INR') AS currency,
      COALESCE(pt.receipt_url, pt.raw_payload->>'customerReceiptUrl') AS receipt_url,
      pt.posting_date,
      'pos_transactions' AS _source
    FROM pos_transactions pt
    WHERE ${ptWhere}
    ORDER BY pt.txn_time DESC
  `;

  // --- Source B: razorpay_pos_transactions (TID match, amount in RUPEES) ---
  const rptConditions = [];
  const rptParams = [];
  let rptIdx = 1;

  const ownershipParts = [];
  if (uniqueTids.length > 0) {
    ownershipParts.push(`rpt.tid = ANY($${rptIdx})`);
    rptParams.push(uniqueTids);
    rptIdx++;
  }
  if (uniqueSerials.length > 0) {
    ownershipParts.push(`rpt.device_serial = ANY($${rptIdx})`);
    rptParams.push(uniqueSerials);
    rptIdx++;
  }
  rptConditions.push(`(${ownershipParts.join(' OR ')})`);

  if (dateFrom) {
    rptConditions.push(`rpt.transaction_time >= $${rptIdx}`);
    rptParams.push(dateFrom);
    rptIdx++;
  }
  if (dateTo) {
    rptConditions.push(`rpt.transaction_time <= $${rptIdx}`);
    rptParams.push(dateTo);
    rptIdx++;
  }
  if (status) {
    const displayStatus = status.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : status.toUpperCase();
    rptConditions.push(`rpt.display_status = $${rptIdx}`);
    rptParams.push(displayStatus);
    rptIdx++;
  }
  if (terminalId) {
    rptConditions.push(`rpt.tid = $${rptIdx}`);
    rptParams.push(terminalId);
    rptIdx++;
  }
  if (paymentMode) {
    rptConditions.push(`rpt.payment_mode = $${rptIdx}`);
    rptParams.push(paymentMode.toUpperCase());
    rptIdx++;
  }

  const rptWhere = rptConditions.join(' AND ');

  const rptDataQuery = `
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
      COALESCE(rpt.card_number, rpt.raw_data->>'formattedPan', rpt.raw_data->>'cardNumber', rpt.raw_data->>'maskedCardNumber') AS card_number,
      COALESCE(rpt.issuing_bank, rpt.raw_data->>'issuingBankName', rpt.raw_data->>'bankName', rpt.raw_data->>'issuingBank') AS issuing_bank,
      COALESCE(rpt.card_classification, rpt.raw_data->>'cardClassification', rpt.raw_data->>'cardCategory') AS card_classification,
      COALESCE(rpt.card_txn_type, rpt.raw_data->>'cardTxnType', rpt.raw_data->>'cardTransactionType', rpt.raw_data->>'entryMode') AS card_txn_type,
      COALESCE(rpt.acquiring_bank, rpt.raw_data->>'acquiringBank', rpt.raw_data->>'acquiringBankName', rpt.raw_data->>'acquirerCode') AS acquiring_bank,
      COALESCE(rpt.mid_code, rpt.raw_data->>'mid', rpt.raw_data->>'merchantId') AS mid,
      COALESCE(rpt.currency, rpt.raw_data->>'currencyCode', 'INR') AS currency,
      COALESCE(rpt.receipt_url, rpt.raw_data->>'customerReceiptUrl', rpt.raw_data->>'receiptUrl') AS receipt_url,
      rpt.posting_date,
      'razorpay_pos_transactions' AS _source
    FROM razorpay_pos_transactions rpt
    WHERE ${rptWhere}
    ORDER BY rpt.transaction_time DESC
  `;

  // Execute both queries in parallel
  const [ptResult, rptResult] = await Promise.all([
    db.query(ptDataQuery, ptParams).catch(err => {
      logger.error('Error querying pos_transactions', { error: err.message });
      return { rows: [] };
    }),
    db.query(rptDataQuery, rptParams).catch(err => {
      logger.error('Error querying razorpay_pos_transactions', { error: err.message });
      return { rows: [] };
    }),
  ]);

  // =========================================================================
  // Step 3: Merge & deduplicate — pos_transactions rows take priority
  // =========================================================================
  const seenTxnIds = new Set();
  const mergedRows = [];

  for (const row of ptResult.rows) {
    const key = row.razorpay_txn_id || row.id;
    if (!seenTxnIds.has(key)) {
      seenTxnIds.add(key);
      mergedRows.push(row);
    }
  }

  for (const row of rptResult.rows) {
    const key = row.razorpay_txn_id || row.id;
    if (!seenTxnIds.has(key)) {
      seenTxnIds.add(key);
      mergedRows.push(row);
    }
  }

  // Sort by txn_time descending
  mergedRows.sort((a, b) => new Date(b.txn_time || 0) - new Date(a.txn_time || 0));

  logger.info('Partner transaction query - merged results', {
    partnerId,
    posTransactions: ptResult.rows.length,
    razorpayTransactions: rptResult.rows.length,
    merged: mergedRows.length,
  });

  // =========================================================================
  // Step 4: Calculate summary from full merged set, then paginate
  // =========================================================================
  const total = mergedRows.length;
  const offset = (page - 1) * pageSize;

  let totalAmount = 0;
  let authorizedCount = 0;
  let capturedCount = 0;
  let failedCount = 0;
  let refundedCount = 0;
  let capturedAmount = 0;
  const terminalSet = new Set();

  for (const row of mergedRows) {
    const amt = parseFloat(row.amount) || 0;
    const st = (row.status || '').toUpperCase();
    totalAmount += amt;
    if (st === 'AUTHORIZED') authorizedCount++;
    if (st === 'CAPTURED') capturedCount++;
    if (st === 'FAILED') failedCount++;
    if (st === 'REFUNDED') refundedCount++;
    if (st === 'CAPTURED') capturedAmount += amt;
    if (row.terminal_id) terminalSet.add(row.terminal_id);
  }

  // Strip internal _source field before returning
  const paginatedRows = mergedRows.slice(offset, offset + pageSize).map(({ _source, ...rest }) => rest);

  return {
    transactions: paginatedRows,
    total,
    page,
    pageSize,
    summary: {
      total_transactions: total,
      total_amount: totalAmount.toFixed(2),
      authorized_count: authorizedCount,
      captured_count: capturedCount,
      failed_count: failedCount,
      refunded_count: refundedCount,
      captured_amount: capturedAmount.toFixed(2),
      terminal_count: terminalSet.size,
    },
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
  const cardNumber = payload.formattedPan || payload.cardNumber || payload.maskedCardNumber || null;
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

