'use strict';

/**
 * Export Worker - Async background process
 * 
 * Polls export_jobs where status = 'PROCESSING'
 * Streams large queries safely (no memory overload)
 * Generates CSV, Excel, PDF, ZIP
 * Uploads to S3 and generates signed URLs
 * 
 * Run: node workers/exportWorker.js
 * PM2: pm2 start workers/exportWorker.js --name export-worker
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { Pool } = require('pg');
const Cursor = require('pg-cursor');
const { stringify } = require('csv-stringify');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const { Readable, PassThrough } = require('stream');
const fs = require('fs');
const path = require('path');
const os = require('os');

const config = require('../config');
const logger = require('../utils/logger');
const s3Service = require('../services/s3Service');

// ============================================================================
// Database Pool for Worker (separate from main app)
// ============================================================================
const pool = new Pool({
  connectionString: config.db.connectionString,
  min: 1,
  max: 5,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
  ssl: config.db.ssl,
});

// ============================================================================
// Constants
// ============================================================================
const POLL_INTERVAL = config.exportWorker.pollIntervalMs;
const BATCH_SIZE = config.exportWorker.batchSize;
const TMP_DIR = path.join(os.tmpdir(), 'pos-exports');

// Ensure temp directory exists
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// ============================================================================
// CSV Column Headers
// ============================================================================
const CSV_COLUMNS = [
  { key: 'id', header: 'Transaction ID' },
  { key: 'razorpay_txn_id', header: 'Razorpay TxnID' },
  { key: 'external_ref', header: 'External Ref' },
  { key: 'terminal_id', header: 'Terminal ID' },
  { key: 'retailer_code', header: 'Retailer Code' },
  { key: 'retailer_name', header: 'Retailer Name' },
  { key: 'amount_rupees', header: 'Amount (₹)' },
  { key: 'status', header: 'Status' },
  { key: 'rrn', header: 'RRN' },
  { key: 'card_brand', header: 'Card Brand' },
  { key: 'card_type', header: 'Card Type' },
  { key: 'payment_mode', header: 'Payment Mode' },
  { key: 'settlement_status', header: 'Settlement Status' },
  { key: 'device_serial', header: 'Device Serial' },
  { key: 'txn_time', header: 'Transaction Time' },
];

// ============================================================================
// Main Poll Loop
// ============================================================================
let isRunning = true;
let isProcessing = false;

async function pollForJobs() {
  while (isRunning) {
    try {
      if (!isProcessing) {
        await processNextJob();
      }
    } catch (error) {
      logger.error('Export worker poll error', { error: error.message });
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Pick up the oldest PROCESSING job and execute it
 */
async function processNextJob() {
  isProcessing = true;

  try {
    // Atomically claim a job (prevents multiple workers from picking the same job)
    const jobResult = await pool.query(
      `UPDATE export_jobs
       SET started_at = COALESCE(started_at, NOW()), updated_at = NOW()
       WHERE id = (
         SELECT id FROM export_jobs
         WHERE status = 'PROCESSING'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`
    );

    if (jobResult.rows.length === 0) {
      isProcessing = false;
      return; // No pending jobs
    }

    const job = jobResult.rows[0];
    logger.info('Processing export job', {
      jobId: job.id,
      partnerId: job.partner_id,
      format: job.format,
    });

    const startTime = Date.now();

    try {
      await executeExportJob(job);

      const duration = Date.now() - startTime;
      logger.info('Export job completed', {
        jobId: job.id,
        duration: `${duration}ms`,
      });
    } catch (error) {
      logger.error('Export job failed', {
        jobId: job.id,
        error: error.message,
        stack: error.stack,
      });

      // Mark job as failed
      await pool.query(
        `UPDATE export_jobs
         SET status = 'FAILED',
             error_message = $1,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [error.message.substring(0, 500), job.id]
      );
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Execute the export: query data, generate file, upload to S3
 */
async function executeExportJob(job) {
  const filters = job.filters || {};
  const format = job.format;
  const partnerId = job.partner_id;
  const jobId = job.id;

  // Build the streaming query
  const { queryText, queryParams } = buildExportQuery(filters);

  // Count total records first
  const countResult = await pool.query(
    queryText.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) AS total FROM').replace(/ORDER BY[\s\S]*$/, ''),
    queryParams
  );
  const totalRecords = parseInt(countResult.rows[0].total, 10);

  if (totalRecords === 0) {
    await pool.query(
      `UPDATE export_jobs
       SET status = 'COMPLETED',
           total_records = 0,
           file_size_bytes = 0,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [jobId]
    );
    return;
  }

  let fileBuffer;
  let fileSizeBytes;

  switch (format) {
    case 'csv':
      fileBuffer = await generateCSV(queryText, queryParams);
      break;
    case 'excel':
      fileBuffer = await generateExcel(queryText, queryParams);
      break;
    case 'pdf':
      fileBuffer = await generatePDF(filters, totalRecords, partnerId);
      break;
    case 'zip':
      fileBuffer = await generateZIP(queryText, queryParams, filters, totalRecords, partnerId);
      break;
    default:
      fileBuffer = await generateCSV(queryText, queryParams);
  }

  fileSizeBytes = fileBuffer.length;

  // Upload to S3
  const s3Key = s3Service.generateExportKey(partnerId, jobId, format);
  const contentType = s3Service.getContentType(format);

  await s3Service.uploadToS3({
    key: s3Key,
    body: fileBuffer,
    contentType,
    metadata: {
      'partner-id': partnerId,
      'job-id': jobId,
      'total-records': String(totalRecords),
    },
  });

  // Generate signed download URL
  const { url, expiresAt } = await s3Service.getSignedDownloadUrl(s3Key);

  // Update job as completed
  await pool.query(
    `UPDATE export_jobs
     SET status = 'COMPLETED',
         file_url = $1,
         file_key = $2,
         file_size_bytes = $3,
         total_records = $4,
         expires_at = $5,
         completed_at = NOW(),
         updated_at = NOW()
     WHERE id = $6`,
    [url, s3Key, fileSizeBytes, totalRecords, expiresAt, jobId]
  );
}

/**
 * Build the streaming export query from filters.
 * CRITICAL: Always includes partner_id filter.
 */
function buildExportQuery(filters) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  // ALWAYS filter by partner_id
  if (filters.partner_id) {
    conditions.push(`pt.partner_id = $${paramIndex}`);
    params.push(filters.partner_id);
    paramIndex++;
  }

  if (filters.date_from) {
    conditions.push(`pt.txn_time >= $${paramIndex}`);
    params.push(filters.date_from);
    paramIndex++;
  }

  if (filters.date_to) {
    conditions.push(`pt.txn_time <= $${paramIndex}`);
    params.push(filters.date_to);
    paramIndex++;
  }

  if (filters.status) {
    conditions.push(`pt.status = $${paramIndex}`);
    params.push(filters.status);
    paramIndex++;
  }

  if (filters.terminal_id) {
    conditions.push(`pt.terminal_id = $${paramIndex}`);
    params.push(filters.terminal_id);
    paramIndex++;
  }

  if (filters.payment_mode) {
    conditions.push(`pt.payment_mode = $${paramIndex}`);
    params.push(filters.payment_mode);
    paramIndex++;
  }

  const whereClause = conditions.length > 0
    ? 'WHERE ' + conditions.join(' AND ')
    : '';

  const queryText = `
    SELECT 
      pt.id,
      pt.razorpay_txn_id,
      pt.external_ref,
      pt.terminal_id,
      pr.retailer_code,
      pr.name AS retailer_name,
      pt.amount,
      pt.status,
      pt.rrn,
      pt.card_brand,
      pt.card_type,
      pt.payment_mode,
      pt.settlement_status,
      pt.device_serial,
      pt.txn_time
    FROM pos_transactions pt
    LEFT JOIN partner_retailers pr ON pr.id = pt.retailer_id
    ${whereClause}
    ORDER BY pt.txn_time DESC
  `;

  return { queryText, queryParams: params };
}

/**
 * Generate CSV using streaming cursor to prevent memory overload
 */
async function generateCSV(queryText, queryParams) {
  const client = await pool.connect();
  try {
    const cursor = client.query(new Cursor(queryText, queryParams));
    const chunks = [];

    // Write CSV header
    const header = CSV_COLUMNS.map(c => c.header).join(',') + '\n';
    chunks.push(Buffer.from(header));

    // Stream rows in batches
    let batch;
    do {
      batch = await new Promise((resolve, reject) => {
        cursor.read(BATCH_SIZE, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      if (batch.length > 0) {
        const csvRows = batch.map(row => {
          return CSV_COLUMNS.map(col => {
            let val = row[col.key];
            if (col.key === 'amount_rupees') {
              val = (row.amount / 100).toFixed(2);
            }
            if (val === null || val === undefined) return '';
            val = String(val);
            // Escape CSV special chars
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
              val = '"' + val.replace(/"/g, '""') + '"';
            }
            return val;
          }).join(',');
        }).join('\n') + '\n';

        chunks.push(Buffer.from(csvRows));
      }
    } while (batch.length > 0);

    cursor.close();
    return Buffer.concat(chunks);
  } finally {
    client.release();
  }
}

/**
 * Generate Excel workbook using streaming
 */
async function generateExcel(queryText, queryParams) {
  const client = await pool.connect();
  try {
    const cursor = client.query(new Cursor(queryText, queryParams));
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('POS Transactions');

    // Set columns
    sheet.columns = CSV_COLUMNS.map(col => ({
      header: col.header,
      key: col.key,
      width: col.key === 'razorpay_txn_id' ? 30 : 18,
    }));

    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Stream rows
    let batch;
    do {
      batch = await new Promise((resolve, reject) => {
        cursor.read(BATCH_SIZE, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      for (const row of batch) {
        sheet.addRow({
          ...row,
          amount_rupees: (row.amount / 100).toFixed(2),
          txn_time: row.txn_time ? new Date(row.txn_time).toISOString() : '',
        });
      }
    } while (batch.length > 0);

    cursor.close();

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  } finally {
    client.release();
  }
}

/**
 * Generate PDF summary report (summary only, not full data)
 */
async function generatePDF(filters, totalRecords, partnerId) {
  // Get summary stats
  const summaryResult = await pool.query(
    `SELECT 
      COUNT(*) AS total_transactions,
      COALESCE(SUM(amount), 0) AS total_amount,
      COUNT(*) FILTER (WHERE status = 'CAPTURED') AS captured_count,
      COALESCE(SUM(amount) FILTER (WHERE status = 'CAPTURED'), 0) AS captured_amount,
      COUNT(*) FILTER (WHERE status = 'AUTHORIZED') AS authorized_count,
      COUNT(*) FILTER (WHERE status = 'FAILED') AS failed_count,
      COUNT(*) FILTER (WHERE status = 'REFUNDED') AS refunded_count,
      COUNT(DISTINCT terminal_id) AS terminal_count,
      MIN(txn_time) AS first_txn,
      MAX(txn_time) AS last_txn
     FROM pos_transactions
     WHERE partner_id = $1
       AND ($2::timestamptz IS NULL OR txn_time >= $2)
       AND ($3::timestamptz IS NULL OR txn_time <= $3)`,
    [partnerId, filters.date_from || null, filters.date_to || null]
  );

  const summary = summaryResult.rows[0];

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(20).font('Helvetica-Bold')
      .text('POS Transaction Summary Report', { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica')
      .text(`Generated: ${new Date().toISOString()}`, { align: 'center' });
    doc.text(`Partner ID: ${partnerId}`, { align: 'center' });
    doc.moveDown(1);

    // Date range
    doc.fontSize(12).font('Helvetica-Bold').text('Report Period');
    doc.fontSize(10).font('Helvetica');
    doc.text(`From: ${filters.date_from || 'All time'}`);
    doc.text(`To: ${filters.date_to || 'Present'}`);
    doc.moveDown(1);

    // Summary table
    doc.fontSize(12).font('Helvetica-Bold').text('Transaction Summary');
    doc.moveDown(0.5);

    const tableData = [
      ['Total Transactions', String(summary.total_transactions)],
      ['Total Amount', `₹ ${(parseInt(summary.total_amount) / 100).toFixed(2)}`],
      ['Captured Transactions', String(summary.captured_count)],
      ['Captured Amount', `₹ ${(parseInt(summary.captured_amount) / 100).toFixed(2)}`],
      ['Authorized (Pending)', String(summary.authorized_count)],
      ['Failed', String(summary.failed_count)],
      ['Refunded', String(summary.refunded_count)],
      ['Unique Terminals', String(summary.terminal_count)],
      ['First Transaction', summary.first_txn ? new Date(summary.first_txn).toISOString() : 'N/A'],
      ['Last Transaction', summary.last_txn ? new Date(summary.last_txn).toISOString() : 'N/A'],
    ];

    const startX = 50;
    const colWidth = 250;
    let y = doc.y;

    doc.fontSize(10).font('Helvetica');
    for (const [label, value] of tableData) {
      doc.font('Helvetica-Bold').text(label, startX, y, { continued: false, width: colWidth });
      doc.font('Helvetica').text(value, startX + colWidth, y);
      y += 20;
    }

    doc.moveDown(2);

    // Filters applied
    if (filters.status || filters.terminal_id || filters.payment_mode) {
      doc.fontSize(12).font('Helvetica-Bold').text('Filters Applied');
      doc.fontSize(10).font('Helvetica');
      if (filters.status) doc.text(`Status: ${filters.status}`);
      if (filters.terminal_id) doc.text(`Terminal: ${filters.terminal_id}`);
      if (filters.payment_mode) doc.text(`Payment Mode: ${filters.payment_mode}`);
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).font('Helvetica')
      .text('This is a system-generated report from Same Day Solution POS Partner API.', {
        align: 'center',
      });

    doc.end();
  });
}

/**
 * Generate ZIP archive containing CSV + PDF
 */
async function generateZIP(queryText, queryParams, filters, totalRecords, partnerId) {
  // Generate CSV and PDF in parallel
  const [csvBuffer, pdfBuffer] = await Promise.all([
    generateCSV(queryText, queryParams),
    generatePDF(filters, totalRecords, partnerId),
  ]);

  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', chunk => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    archive.append(csvBuffer, { name: 'pos_transactions.csv' });
    archive.append(pdfBuffer, { name: 'pos_transactions_summary.pdf' });

    archive.finalize();
  });
}

// ============================================================================
// Worker Startup
// ============================================================================
logger.info('Export worker starting...', {
  pollInterval: `${POLL_INTERVAL}ms`,
  batchSize: BATCH_SIZE,
  pid: process.pid,
});

console.log(`
╔═══════════════════════════════════════════════════════╗
║          Export Worker - Same Day Solution            ║
╠═══════════════════════════════════════════════════════╣
║  Status    : RUNNING                                  ║
║  Poll Intv : ${String(POLL_INTERVAL + 'ms').padEnd(40)}║
║  Batch Size: ${String(BATCH_SIZE).padEnd(40)}║
║  PID       : ${String(process.pid).padEnd(40)}║
╚═══════════════════════════════════════════════════════╝
`);

pollForJobs();

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Export worker shutting down (SIGTERM)...');
  isRunning = false;
  setTimeout(() => {
    pool.end();
    process.exit(0);
  }, 5000);
});

process.on('SIGINT', () => {
  logger.info('Export worker shutting down (SIGINT)...');
  isRunning = false;
  setTimeout(() => {
    pool.end();
    process.exit(0);
  }, 5000);
});


