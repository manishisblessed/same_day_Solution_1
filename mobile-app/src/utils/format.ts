import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';

export function formatCurrency(value?: number | string | null, opts?: { compact?: boolean }): string {
  const n = typeof value === 'string' ? parseFloat(value) : value ?? 0;
  if (isNaN(n as number)) return '₹0';
  if (opts?.compact && Math.abs(n) >= 100000) {
    if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
    return `₹${(n / 100000).toFixed(2)}L`;
  }
  return `₹${(n as number).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value?: number | null): string {
  return (value ?? 0).toLocaleString('en-IN');
}

export function formatDate(value?: string | null, pattern = 'dd MMM yyyy, hh:mm a'): string {
  if (!value) return '—';
  try {
    return format(typeof value === 'string' ? parseISO(value) : value, pattern);
  } catch {
    return String(value);
  }
}

export function timeAgo(value?: string | null): string {
  if (!value) return '';
  try {
    return `${formatDistanceToNowStrict(parseISO(value))} ago`;
  } catch {
    return '';
  }
}

export function maskAadhaar(v?: string | null): string {
  if (!v) return '';
  const digits = v.replace(/\D/g, '');
  if (digits.length !== 12) return v;
  return `XXXX XXXX ${digits.slice(8)}`;
}

/** Rupees → paise (BBPS bill/pay expects paise). */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Remove the internal charge/GST breakdown from a transaction description.
 * e.g. "CC ₹34220 + ₹29.5 GST | INDUSIND CREDIT CARD" -> "CC ₹34220 | INDUSIND CREDIT CARD"
 */
export function cleanDescription<T extends string | null | undefined>(desc: T): T {
  if (!desc) return desc;
  return desc
    .replace(/\s*\+\s*₹?[\d.,]+\s*(?:GST|charge)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() as T;
}
