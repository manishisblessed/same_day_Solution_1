'use strict';

const express = require('express');
const router = express.Router();

const testCallbackController = require('../controllers/testCallbackController');

// POST /api/test-callback/receive — receive callback (mimics partner endpoint)
router.post('/receive', testCallbackController.receiveCallback);

// GET /api/test-callback/list — view received callbacks
router.get('/list', testCallbackController.listCallbacks);

// DELETE /api/test-callback/clear — clear stored callbacks
router.delete('/clear', testCallbackController.clearCallbacks);

module.exports = router;
