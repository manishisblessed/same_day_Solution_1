/**
 * Knteer probe v2 — fixes:
 *   1. Tries /Prod (capital P) and /prod
 *   2. exp as STRING in JWT (matching Postman samples)
 *   3. Tries partnerId = MsrId (UUID)
 *
 * Run on whitelisted server:  node scripts/knteer-probe-v2.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import * as crypto from 'node:crypto'

const env = { ...process.env }
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(KNTEER_[A-Z_]+)=(.*)$/)
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/\s+#.*$/, '').trim()
  }
}

const host = 'https://api.knteersolution.com'
const msrId = env.KNTEER_MSR_ID || ''
const jwtToken = env.KNTEER_JWT_TOKEN || ''
const authorizeKey = env.KNTEER_AUTHORIZE_KEY || ''
const rechargeSecret = env.KNTEER_RECHARGE_SECRET_KEY || ''

if (!msrId || !jwtToken) {
  console.error('Missing KNTEER_MSR_ID / KNTEER_JWT_TOKEN')
  process.exit(1)
}

function b64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function makeJwt(partnerId, secret, expAsString = false) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const expVal = Math.floor(Date.now() / 1000) + 270
  const payload = b64url(JSON.stringify({
    partnerId,
    refId: `${Date.now()}`,
    exp: expAsString ? String(expVal) : expVal,
  }))
  const signing = `${header}.${payload}`
  const sig = b64url(crypto.createHmac('sha256', secret).update(signing).digest())
  return `${signing}.${sig}`
}

const paths = ['/Prod/wallet/balance', '/prod/wallet/balance', '/wallet/balance']

const authCombos = [
  { name: 'JWT(MsrId, JwtToken, exp=STRING)', token: () => makeJwt(msrId, jwtToken, true) },
  { name: 'JWT(MsrId, JwtToken, exp=NUMBER)', token: () => makeJwt(msrId, jwtToken, false) },
  { name: 'JWT(MsrId, RechargeSecret, exp=STRING)', token: () => makeJwt(msrId, rechargeSecret, true) },
  { name: 'JWT(MsrId, AuthorizeKey, exp=STRING)', token: () => makeJwt(msrId, authorizeKey, true) },
  { name: 'Static Bearer = JwtToken', token: () => jwtToken },
  { name: 'Static Bearer = AuthorizeKey', token: () => authorizeKey },
]

console.log(`Knteer probe v2 — ${paths.length} paths × ${authCombos.length} auth combos = ${paths.length * authCombos.length} requests\n`)

for (const path of paths) {
  const url = `${host}${path}`
  console.log(`\n━━ PATH: ${url}`)

  for (const auth of authCombos) {
    try {
      const token = auth.token()
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      })
      const ct = res.headers.get('content-type') || ''
      const text = await res.text()
      const isHtml = ct.includes('html') || text.trimStart().toLowerCase().startsWith('<!doctype')
      const label = isHtml ? '[HTML]' : text.slice(0, 300)
      console.log(`   ${auth.name} → ${res.status} ${isHtml ? '[HTML SPA]' : label}`)
    } catch (e) {
      console.log(`   ${auth.name} → ERROR ${e.message}`)
    }
  }
}
