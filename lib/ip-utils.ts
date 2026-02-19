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
 * Extract the real client IP address from request headers
 * Handles proxy headers (x-forwarded-for, x-real-ip)
 */
export function extractClientIpFromHeaders(headers: Headers): string | null {
  // Check x-forwarded-for header (first IP in chain is the original client)
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs: "client, proxy1, proxy2"
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    if (ips.length > 0) {
      return normalizeIp(ips[0]);
    }
  }

  // Check x-real-ip header (set by nginx/load balancer)
  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return normalizeIp(realIp.trim());
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

  // Check each whitelist entry
  for (const entry of whitelist) {
    if (ipMatchesWhitelist(clientIp, entry)) {
      return true;
    }
  }

  return false;
}

