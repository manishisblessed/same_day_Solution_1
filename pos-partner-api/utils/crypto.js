'use strict';

const crypto = require('crypto');

/**
 * Generate HMAC-SHA256 signature
 * @param {string} secret - The API secret key
 * @param {string} payload - The data to sign
 * @returns {string} Hex-encoded HMAC signature
 */
function generateHmacSignature(secret, payload) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');
}

/**
 * Verify HMAC-SHA256 signature with timing-safe comparison
 * @param {string} secret - The API secret key
 * @param {string} payload - The data that was signed
 * @param {string} providedSignature - The signature to verify
 * @returns {boolean}
 */
function verifyHmacSignature(secret, payload, providedSignature) {
  const expectedSignature = generateHmacSignature(secret, payload);

  if (expectedSignature.length !== providedSignature.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(providedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically secure API key
 * @param {string} prefix - Key prefix (e.g., 'pk_live_')
 * @param {number} bytes - Number of random bytes
 * @returns {string}
 */
function generateApiKey(prefix = 'pk_live_', bytes = 24) {
  return prefix + crypto.randomBytes(bytes).toString('hex');
}

/**
 * Generate a cryptographically secure API secret
 * @param {string} prefix - Secret prefix (e.g., 'sk_live_')
 * @param {number} bytes - Number of random bytes
 * @returns {string}
 */
function generateApiSecret(prefix = 'sk_live_', bytes = 32) {
  return prefix + crypto.randomBytes(bytes).toString('hex');
}

/**
 * Verify Razorpay webhook signature
 * @param {string} body - Raw request body
 * @param {string} signature - x-razorpay-signature header
 * @param {string} secret - Razorpay webhook secret
 * @returns {boolean}
 */
function verifyRazorpaySignature(body, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

module.exports = {
  generateHmacSignature,
  verifyHmacSignature,
  generateApiKey,
  generateApiSecret,
  verifyRazorpaySignature,
};


