import * as OTPAuth from 'otpauth'

const ISSUER = 'Same Day Solution'
const ALGORITHM = 'SHA1'
const DIGITS = 6
const PERIOD = 30

// Simple symmetric encryption for storing secrets at rest.
// Uses AES-256-CBC with a server-side key from env.
const ENC_KEY = process.env.TOTP_ENCRYPTION_KEY || ''

function getEncryptionKey(): Buffer {
  if (!ENC_KEY) throw new Error('TOTP_ENCRYPTION_KEY not configured')
  const key = Buffer.from(ENC_KEY, 'hex')
  if (key.length !== 32) throw new Error('TOTP_ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
  return key
}

export async function encryptSecret(plainSecret: string): Promise<string> {
  const crypto = await import('crypto')
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  let encrypted = cipher.update(plainSecret, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return iv.toString('hex') + ':' + encrypted
}

export async function decryptSecret(encryptedSecret: string): Promise<string> {
  const crypto = await import('crypto')
  const key = getEncryptionKey()
  const [ivHex, encHex] = encryptedSecret.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  let decrypted = decipher.update(encHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

export function generateSecret(): string {
  const secret = new OTPAuth.Secret({ size: 20 })
  return secret.base32
}

export function generateTOTPUri(secret: string, email: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  })
  return totp.toString()
}

export function verifyTOTP(secret: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  })
  // Allow 1 period window (±30s) to handle clock drift
  const delta = totp.validate({ token, window: 1 })
  return delta !== null
}

export function generateBackupCodes(count: number = 8): string[] {
  const crypto = require('crypto') as typeof import('crypto')
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase()
    // Format: XXXX-XXXX
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`)
  }
  return codes
}

export async function hashBackupCode(code: string): Promise<string> {
  const crypto = await import('crypto')
  return crypto.createHash('sha256').update(code.replace('-', '').toUpperCase()).digest('hex')
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map(c => hashBackupCode(c)))
}

export async function verifyBackupCode(code: string, hashedCodes: string[]): Promise<number> {
  const hash = await hashBackupCode(code)
  return hashedCodes.indexOf(hash)
}
