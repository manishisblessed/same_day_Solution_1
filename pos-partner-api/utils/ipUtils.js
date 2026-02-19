'use strict';

/**
 * Extract the real client IP address from request
 * Handles proxy headers (x-forwarded-for, x-real-ip) and IPv6 normalization
 */
function extractClientIp(req) {
  // Check x-forwarded-for header (first IP in chain is the original client)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs: "client, proxy1, proxy2"
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    if (ips.length > 0) {
      return normalizeIp(ips[0]);
    }
  }

  // Check x-real-ip header (set by nginx/load balancer)
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return normalizeIp(realIp.trim());
  }

  // Fallback to Express req.ip (works with trust proxy)
  if (req.ip) {
    return normalizeIp(req.ip);
  }

  // Last resort: connection remote address
  if (req.connection && req.connection.remoteAddress) {
    return normalizeIp(req.connection.remoteAddress);
  }

  // If socket exists
  if (req.socket && req.socket.remoteAddress) {
    return normalizeIp(req.socket.remoteAddress);
  }

  return null;
}

/**
 * Normalize IP address (remove IPv6 prefix, handle IPv4-mapped IPv6)
 */
function normalizeIp(ip) {
  if (!ip) return null;
  
  // Remove IPv6 prefix (::ffff:)
  let normalized = ip.replace(/^::ffff:/i, '');
  
  // Remove brackets from IPv6 addresses
  normalized = normalized.replace(/^\[|\]$/g, '');
  
  // Trim whitespace
  normalized = normalized.trim();
  
  return normalized;
}

/**
 * Check if an IP address matches a whitelist entry
 * Supports:
 * - Exact IP match: "192.168.1.100"
 * - CIDR notation: "192.168.1.0/24"
 */
function ipMatchesWhitelist(clientIp, whitelistEntry) {
  if (!clientIp || !whitelistEntry) return false;

  const normalizedClientIp = normalizeIp(clientIp);
  const normalizedEntry = normalizeIp(whitelistEntry);

  // Exact match
  if (normalizedClientIp === normalizedEntry) {
    return true;
  }

  // CIDR notation check
  if (normalizedEntry.includes('/')) {
    return ipInCidr(normalizedClientIp, normalizedEntry);
  }

  return false;
}

/**
 * Check if an IP address is within a CIDR range
 * Supports IPv4 CIDR notation (e.g., "192.168.1.0/24")
 */
function ipInCidr(ip, cidr) {
  try {
    const [network, prefixLength] = cidr.split('/');
    const prefix = parseInt(prefixLength, 10);

    if (isNaN(prefix) || prefix < 0 || prefix > 32) {
      return false;
    }

    // Convert IPs to numbers for comparison
    const ipNum = ipToNumber(ip);
    const networkNum = ipToNumber(network);

    if (ipNum === null || networkNum === null) {
      return false;
    }

    // Calculate subnet mask
    const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;

    // Check if IP is in the network
    return (ipNum & mask) === (networkNum & mask);
  } catch (error) {
    return false;
  }
}

/**
 * Convert IPv4 address to a 32-bit number
 */
function ipToNumber(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }

  let num = 0;
  for (let i = 0; i < 4; i++) {
    const part = parseInt(parts[i], 10);
    if (isNaN(part) || part < 0 || part > 255) {
      return null;
    }
    num = (num << 8) + part;
  }

  return num >>> 0; // Ensure unsigned 32-bit
}

/**
 * Check if client IP is in whitelist (supports multiple entries and CIDR)
 */
function isIpWhitelisted(req, whitelist) {
  if (!whitelist || !Array.isArray(whitelist) || whitelist.length === 0) {
    return false;
  }

  const clientIp = extractClientIp(req);
  if (!clientIp) {
    return false;
  }

  // Check each whitelist entry
  for (const entry of whitelist) {
    if (ipMatchesWhitelist(clientIp, entry)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  extractClientIp,
  normalizeIp,
  ipMatchesWhitelist,
  ipInCidr,
  ipToNumber,
  isIpWhitelisted,
};

