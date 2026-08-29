import fs from 'fs'
import path from 'path'

/**
 * Dedicated, size-rotated logger for the verbose partner POS-transaction records
 * (full TID/serial arrays). Keeps these large lines out of the shared PM2 stdout
 * log while retaining every id for audit/debugging.
 *
 * - One file per PM2 instance (`partner-pos-txn-<instance>.log`) so the two
 *   cluster workers never interleave writes into the same file.
 * - Rotates at MAX_BYTES, keeping RETAIN older generations (.1 .. .RETAIN).
 * - Fails safe: if no writable dir is found or a write throws, it falls back to
 *   stdout so a logging problem can never break the API response.
 */

const MAX_BYTES = 20 * 1024 * 1024 // 20MB per file (matches pm2-logrotate)
const RETAIN = 5

let _initialized = false
let _logFile: string | null = null

function resolveLogDir(): string | null {
  const candidates = [
    process.env.POS_TXN_LOG_DIR,
    // On EC2 this resolves to /home/ubuntu/logs (already exists).
    path.join(process.cwd(), '..', 'logs'),
    path.join(process.cwd(), 'logs'),
  ].filter(Boolean) as string[]

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.accessSync(dir, fs.constants.W_OK)
      return dir
    } catch {
      // try the next candidate
    }
  }
  return null
}

function ensureInit(): void {
  if (_initialized) return
  _initialized = true
  const dir = resolveLogDir()
  const instance = process.env.NODE_APP_INSTANCE ?? 'main'
  _logFile = dir ? path.join(dir, `partner-pos-txn-${instance}.log`) : null
}

function rotateIfNeeded(): void {
  if (!_logFile) return
  try {
    const { size } = fs.statSync(_logFile)
    if (size < MAX_BYTES) return

    for (let i = RETAIN - 1; i >= 1; i--) {
      const src = `${_logFile}.${i}`
      const dst = `${_logFile}.${i + 1}`
      if (fs.existsSync(src)) fs.renameSync(src, dst)
    }
    fs.renameSync(_logFile, `${_logFile}.1`)

    const overflow = `${_logFile}.${RETAIN + 1}`
    if (fs.existsSync(overflow)) fs.unlinkSync(overflow)
  } catch {
    // file missing (ENOENT) or rename race — nothing to rotate
  }
}

export function logPartnerPosTxn(record: Record<string, unknown>): void {
  ensureInit()
  const payload = JSON.stringify(record)

  if (!_logFile) {
    console.log(`[Partner API Txn] ${payload}`)
    return
  }

  try {
    rotateIfNeeded()
    fs.appendFileSync(_logFile, `${new Date().toISOString()} ${payload}\n`)
  } catch {
    console.log(`[Partner API Txn] ${payload}`)
  }
}
