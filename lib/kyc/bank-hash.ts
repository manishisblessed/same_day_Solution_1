/** Server-only: deterministic hash binding a KYC verification to an account+IFSC. */
import { createHash } from 'crypto'

export function bankAccountHash(accountNumber: string, ifsc: string): string {
  const digits = (accountNumber || '').replace(/\D/g, '')
  const code = (ifsc || '').toUpperCase().replace(/\s/g, '')
  return createHash('sha256').update(`${digits}|${code}`).digest('hex')
}
