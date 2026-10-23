/**
 * Knteer auth-scheme probe — RUN THIS ON THE WHITELISTED SERVER (15.207.31.125).
 *
 * From a non-whitelisted IP the gateway returns the portal SPA (HTML); from the
 * whitelisted server it returns real JSON. Balance is GET with no body, so AES
 * body-encryption does not apply — this isolates the AUTH HEADER format.
 *
 * Reads KNTEER_* from .env.local (or .env, or real process.env).
 * Run:  node scripts/knteer-probe.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import * as crypto from 'node:crypto'

// ── Load KNTEER_* ─────────────────────────────────────────────────────────────
const env = { ...process.env }
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(KNTEER_[A-Z_]+)=(.*)$/)
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/\s+#.*$/, '').trim()
  }
}

const baseUrl = (env.KNTEER_API_BASE_URL || 'https://api.knteersolution.com/prod').replace(/\/$/, '')
const msrId = env.KNTEER_MSR_ID || ''
const jwtToken = env.KNTEER_JWT_TOKEN || ''
const authorizeKey = env.KNTEER_AUTHORIZE_KEY || ''
const rechargeSecret = env.KNTEER_RECHARGE_SECRET_KEY || ''

if (!msrId || !jwtToken) {
  console.error('Missing KNTEER_MSR_ID / KNTEER_JWT_TOKEN. Ensure .env.local on this server has the values.')
  process.exit(1)
}

function b64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
function makeJwt(partnerId, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 270, partnerId, refId: `PROBE${Date.now()}` }))
  const signing = `${header}.${payload}`
  const sig = b64url(crypto.createHmac('sha256', secret).update(signing).digest())
  return `${signing}.${sig}`
}

const url = `${baseUrl}/wallet/balance`

const attempts = [
  { name: 'A. Bearer = JwtToken (static)', headers: { Authorization: `Bearer ${jwtToken}` } },
  { name: 'B. Bearer=JwtToken + MsrId + AuthorizeKey headers', headers: { Authorization: `Bearer ${jwtToken}`, MsrId: msrId, AuthorizeKey: authorizeKey } },
  { name: 'C. Headers MsrId + AuthorizeKey + JwtToken (no Bearer)', headers: { MsrId: msrId, AuthorizeKey: authorizeKey, JwtToken: jwtToken } },
  { name: 'D. Bearer = HS256 JWT{partnerId:MsrId} signed w/ RechargeSecret', headers: { Authorization: `Bearer ${makeJwt(msrId, rechargeSecret)}` } },
  { name: 'E. Bearer = HS256 JWT{partnerId:MsrId} signed w/ JwtToken', headers: { Authorization: `Bearer ${makeJwt(msrId, jwtToken)}` } },
  { name: 'F. Bearer = HS256 JWT{partnerId:MsrId} signed w/ AuthorizeKey', headers: { Authorization: `Bearer ${makeJwt(msrId, authorizeKey)}` } },
  { name: 'G. x-api-key = AuthorizeKey + MsrId header', headers: { 'x-api-key': authorizeKey, MsrId: msrId } },
  { name: 'H. Authorization = JwtToken (raw, no Bearer)', headers: { Authorization: jwtToken, MsrId: msrId } },
]

console.log('Probing BALANCE:', url)
console.log('(run from whitelisted server — expecting JSON, not HTML)\n')

for (const a of attempts) {
  try {
    const res = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json', ...a.headers } })
    const ct = res.headers.get('content-type') || ''
    const text = await res.text()
    const isHtml = ct.includes('html') || text.trimStart().toLowerCase().startsWith('<!doctype')
    console.log(`── ${a.name}`)
    console.log(`   HTTP ${res.status} | ct=${ct}`)
    console.log(`   ${isHtml ? '[HTML SPA — not the API]' : 'BODY: ' + text.slice(0, 400)}\n`)
  } catch (e) {
    console.log(`── ${a.name}\n   ERROR ${e.message}\n`)
  }
}
