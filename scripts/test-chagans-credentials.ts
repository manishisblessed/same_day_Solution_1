#!/usr/bin/env node
/**
 * Test script to validate Chagans BBPS credentials are loading correctly
 * Run: npx ts-node scripts/test-chagans-credentials.ts
 */

import {
  getBBPSProvider,
  getChagansBaseUrl,
  getChagansClientId,
  getChagansClientSecret,
  getChagansAuthToken,
  getChagansMerchantId,
} from '../services/bbps/config'

function maskSecret(secret: string, showChars = 4): string {
  if (!secret) return '(empty)'
  if (secret.length <= showChars) return secret
  return secret.slice(0, showChars) + '*'.repeat(secret.length - showChars)
}

console.log('\n=== Chagans BBPS Credentials Validation ===\n')

try {
  const provider = getBBPSProvider()
  console.log(`✓ BBPS_PROVIDER: ${provider}`)

  if (provider !== 'chagans') {
    console.warn(`⚠ Warning: BBPS_PROVIDER is '${provider}', not 'chagans'`)
    console.warn(
      '  (Set BBPS_PROVIDER=chagans in .env.local to use Chagans BBPS)'
    )
  }

  const baseUrl = getChagansBaseUrl()
  console.log(`✓ Chagans Base URL: ${baseUrl}`)

  const clientId = getChagansClientId()
  console.log(
    `✓ Client ID: ${clientId ? maskSecret(clientId, 8) : '(empty)'}`
  )
  if (!clientId) console.error('  ✗ Missing: Set CHAGHANS_BBPS_CLIENT_ID')

  const clientSecret = getChagansClientSecret()
  console.log(
    `✓ Client Secret: ${clientSecret ? maskSecret(clientSecret, 4) : '(empty)'}`
  )
  if (!clientSecret) {
    console.error('  ✗ Missing: Set CHAGHANS_BBPS_CONSUMER_SECRET')
  }

  const authToken = getChagansAuthToken()
  console.log(
    `✓ Auth Token: ${authToken ? maskSecret(authToken, 10) : '(empty)'}`
  )
  if (!authToken) {
    console.error('  ✗ Missing: Set CHAGHANS_BBPS_AUTH_TOKEN')
  }

  const merchantId = getChagansMerchantId()
  console.log(
    `✓ Merchant ID: ${merchantId ? maskSecret(merchantId, 8) : '(empty)'}`
  )
  if (!merchantId) {
    console.warn('  ⚠ Optional: Set CHAGHANS_BBPS_MERCHANT_ID for pay requests')
  }

  // Summary
  console.log('\n=== Summary ===\n')
  const allSet = clientId && clientSecret && authToken
  if (allSet) {
    console.log(
      '✓ All required credentials are set. Ready to test Chagans BBPS.\n'
    )
  } else {
    console.error('✗ Missing required credentials. Check .env.local.\n')
    process.exit(1)
  }
} catch (e: any) {
  console.error('✗ Error validating credentials:', e.message)
  process.exit(1)
}
