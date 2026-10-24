const crypto = require('crypto')

const partnerId = process.env.KNTEER_PARTNER_ID || 'PT771877'
const secret = process.env.KNTEER_JWT_TOKEN || ''
const baseUrl = process.env.KNTEER_API_BASE_URL || 'https://api.knteersolution.com/Prod'

if (!secret) {
  console.error('KNTEER_JWT_TOKEN not set')
  process.exit(1)
}

function b64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

const refId = Date.now().toString().slice(-6) + '0001'
const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
const payload = b64url(JSON.stringify({
  exp: String(Math.floor(Date.now() / 1000) + 270),
  partnerId: partnerId,
  refId: refId,
}))
const signingInput = header + '.' + payload
const signature = b64url(
  crypto.createHmac('sha256', secret).update(signingInput).digest()
)
const jwt = signingInput + '.' + signature

console.log('Partner ID:', partnerId)
console.log('Secret (first 8):', secret.substring(0, 8) + '...')
console.log('RefId:', refId)
console.log('JWT:', jwt.substring(0, 60) + '...')
console.log('')
console.log('Calling:', baseUrl + '/Wallet/Balance')

fetch(baseUrl + '/Wallet/Balance', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwt,
  },
}).then(function(r) {
  console.log('HTTP Status:', r.status)
  return r.text()
}).then(function(t) {
  console.log('Response:', t)
}).catch(function(e) {
  console.error('Error:', e.message)
})
