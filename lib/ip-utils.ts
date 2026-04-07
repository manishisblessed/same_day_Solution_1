/**
 * IP Whitelist Utilities
 * Supports exact IP matching and CIDR notation
 */

/**
 * Normalize IP address (remove IPv6 prefix, handle IPv4-mapped IPv6)
 */
export function normalizeIp(ip: string | null): string | null {
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
 * Strip port suffix from an IP address (e.g., "1.2.3.4:12345" → "1.2.3.4")
 */
function stripPort(ip: string): string {
  const portMatch = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/);
  if (portMatch) return portMatch[1];
  return ip;
}

/**
 * Extract the real client IP address from request headers.
 * Handles proxy headers from AWS CloudFront/ALB, Vercel, nginx, and generic proxies.
 */
export function extractClientIpFromHeaders(headers: Headers): string | null {
  // 1. CloudFront-Viewer-Address (AWS CloudFront — includes port, e.g. "1.2.3.4:54321")
  const cfViewerAddr = headers.get('cloudfront-viewer-address');
  if (cfViewerAddr) {
    return normalizeIp(stripPort(cfViewerAddr.trim()));
  }

  // 2. x-forwarded-for (standard proxy header — "client, proxy1, proxy2")
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ips = forwardedFor.split(',').map(ip => stripPort(ip.trim()));
    if (ips.length > 0 && ips[0]) {
      return normalizeIp(ips[0]);
    }
  }

  // 3. x-real-ip (nginx / load balancer)
  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return normalizeIp(stripPort(realIp.trim()));
  }

  // 4. true-client-ip (Cloudflare / Akamai)
  const trueClientIp = headers.get('true-client-ip');
  if (trueClientIp) {
    return normalizeIp(stripPort(trueClientIp.trim()));
  }

  return null;
}

/**
 * Convert IPv4 address to a 32-bit number
 */
function ipToNumber(ip: string): number | null {
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
 * Check if an IP address is within a CIDR range
 * Supports IPv4 CIDR notation (e.g., "192.168.1.0/24")
 */
function ipInCidr(ip: string, cidr: string): boolean {
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
 * Check if an IP address matches a whitelist entry
 * Supports:
 * - Exact IP match: "192.168.1.100"
 * - CIDR notation: "192.168.1.0/24"
 */
export function ipMatchesWhitelist(clientIp: string, whitelistEntry: string): boolean {
  if (!clientIp || !whitelistEntry) return false;

  const normalizedClientIp = normalizeIp(clientIp);
  const normalizedEntry = normalizeIp(whitelistEntry);

  if (!normalizedClientIp || !normalizedEntry) return false;

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
 * Check if client IP is in whitelist (supports multiple entries and CIDR)
 */
export function isIpWhitelisted(clientIp: string | null, whitelist: string[] | null | undefined): boolean {
  if (!whitelist || !Array.isArray(whitelist) || whitelist.length === 0) {
    return false;
  }

  if (!clientIp) {
    return false;
  }

  // Trim and filter whitelist entries (handles DB entries with extra whitespace)
  const cleanedWhitelist = whitelist
    .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);

  for (const entry of cleanedWhitelist) {
    if (ipMatchesWhitelist(clientIp, entry)) {
      return true;
    }
  }

  return false;
}

