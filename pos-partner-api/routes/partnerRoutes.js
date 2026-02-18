'use strict';

const express = require('express');
const router = express.Router();

const { authMiddleware, requirePermission } = require('../middleware/authMiddleware');
const { globalRateLimiter, exportRateLimiter } = require('../middleware/rateLimiter');
const transactionController = require('../controllers/transactionController');
const exportController = require('../controllers/exportController');
const machineController = require('../controllers/machineController');

// ============================================================================
// All partner routes require authentication + rate limiting
// ============================================================================
router.use(authMiddleware);
router.use(globalRateLimiter);

// ============================================================================
// GET /api/partner/pos-machines
// Fetch POS machines assigned to partner
// ============================================================================
router.get(
  '/pos-machines',
  requirePermission('read'),
  machineController.getMachines
);

// ============================================================================
// POST /api/partner/pos-transactions
// Fetch transactions with filters and pagination
// ============================================================================
router.post(
  '/pos-transactions',
  requirePermission('read'),
  transactionController.getTransactions
);

// ============================================================================
// POST /api/partner/pos-transactions/export
// Create async export job
// ============================================================================
router.post(
  '/pos-transactions/export',
  requirePermission('export'),
  exportRateLimiter,
  exportController.createExport
);

// ============================================================================
// GET /api/partner/export-status/:job_id
// Check export job status and get download URL
// ============================================================================
router.get(
  '/export-status/:job_id',
  requirePermission('read'),
  exportController.getExportStatus
);

module.exports = router;


