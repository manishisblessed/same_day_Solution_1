'use strict';

const db = require('../config/database');
const config = require('../config');
const { verifyHmacSignature } = require('../utils/crypto');
const { UnauthorizedError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Partner HMAC Authentication Middleware
 * 
 * Required headers:
 *   x-api-key      - Partner public API key
 *   x-signature    - HMAC-SHA256(api_secret, JSON.stringify(body) + timestamp)
 *   x-timestamp    - Unix timestamp (ms) when request was signed
 * 
 * Flow:
 *   1. Extract and validate headers
 *   2. Reject if timestamp is stale (> 5 minutes)
 *   3. Look up API key in partner_api_keys
 *   4. Verify the HMAC signature using stored secret
 *   5. Attach partner info to req.partner
 */
async function authMiddleware(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'];
    const signature = req.headers['x-signature'];
    const timestamp = req.headers['x-timestamp'];

    // 1. Check required headers
    if (!apiKey || !signature || !timestamp) {
      throw new UnauthorizedError(
        'Missing required authentication headers: x-api-key, x-signature, x-timestamp'
      );
    }

    // 2. Validate timestamp freshness (prevent replay attacks)
    const requestTime = parseInt(timestamp, 10);
    if (isNaN(requestTime)) {
      throw new UnauthorizedError('Invalid x-timestamp format');
    }

    const now = Date.now();
    const tolerance = config.security.hmacTimestampToleranceMs;
    if (Math.abs(now - requestTime) > tolerance) {
      throw new UnauthorizedError(
        `Request timestamp expired. Must be within ${tolerance / 1000} seconds of server time.`
      );
    }

    // 3. Look up API key
    const keyResult = await db.query(
      `SELECT 
        ak.id AS key_id,
        ak.api_secret,
        ak.permissions,
        ak.expires_at,
        p.id AS partner_id,
        p.name AS partner_name,
        p.status AS partner_status,
        p.ip_whitelist
       FROM partner_api_keys ak
       JOIN partners p ON p.id = ak.partner_id
       WHERE ak.api_key = $1
         AND ak.is_active = true`,
      [apiKey]
    );

    if (keyResult.rows.length === 0) {
      throw new UnauthorizedError('Invalid API key');
    }

    const keyRecord = keyResult.rows[0];

    // 4. Check partner status
    if (keyRecord.partner_status !== 'active') {
      throw new UnauthorizedError('Partner account is not active');
    }

    // 5. Check key expiry
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      throw new UnauthorizedError('API key has expired');
    }

    // 6. Check IP whitelist (MANDATORY — no whitelist = blocked)
    if (!keyRecord.ip_whitelist || keyRecord.ip_whitelist.length === 0) {
      logger.warn('Partner has no IP whitelist configured — access denied', {
        partnerId: keyRecord.partner_id,
      });
      throw new UnauthorizedError(
        'No IP whitelist configured. Contact admin to whitelist your server IP before accessing the API.'
      );
    }

    const clientIp = req.ip || req.connection.remoteAddress;
    const normalizedIp = clientIp.replace('::ffff:', '');
    if (!keyRecord.ip_whitelist.includes(normalizedIp)) {
      logger.warn('IP not in whitelist', {
        partnerId: keyRecord.partner_id,
        clientIp: normalizedIp,
        whitelist: keyRecord.ip_whitelist,
      });
      throw new UnauthorizedError('IP address not authorized');
    }

    // 7. Verify HMAC signature
    // Signature = HMAC_SHA256(api_secret, JSON.stringify(body) + timestamp)
    const bodyStr = req.method === 'GET' ? '' : JSON.stringify(req.body);
    const signaturePayload = bodyStr + timestamp;
    const isValid = verifyHmacSignature(
      keyRecord.api_secret,
      signaturePayload,
      signature
    );

    if (!isValid) {
      throw new UnauthorizedError('Invalid signature');
    }

    // 8. Attach partner info to request
    req.partner = {
      id: keyRecord.partner_id,
      name: keyRecord.partner_name,
      keyId: keyRecord.key_id,
      permissions: keyRecord.permissions || ['read'],
    };

    // 9. Update last_used_at (fire-and-forget, don't block request)
    db.query(
      'UPDATE partner_api_keys SET last_used_at = NOW() WHERE id = $1',
      [keyRecord.key_id]
    ).catch(err => logger.error('Failed to update last_used_at', { error: err.message }));

    logger.info('Partner authenticated', {
      partnerId: keyRecord.partner_id,
      partnerName: keyRecord.partner_name,
      path: req.path,
    });

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: error.message,
        },
      });
    }
    logger.error('Auth middleware error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication service error',
      },
    });
  }
}

/**
 * Permission check middleware factory
 * @param {string} requiredPermission - e.g., 'read', 'export'
 */
function requirePermission(requiredPermission) {
  return (req, res, next) => {
    if (!req.partner) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const permissions = req.partner.permissions || [];
    if (!permissions.includes(requiredPermission)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Missing required permission: ${requiredPermission}`,
        },
      });
    }

    next();
  };
}

module.exports = { authMiddleware, requirePermission };


