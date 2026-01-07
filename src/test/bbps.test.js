/**
 * BBPS API Test Script
 * 
 * This script tests the BBPS API connectivity and credentials.
 * Run with: NODE_ENV=production node src/test/bbps.test.js
 * Or with dotenv: node -r dotenv/config src/test/bbps.test.js
 */

require('dotenv').config()

const BBPS_API_BASE_URL = process.env.BBPS_API_BASE_URL || 'https://api.sparkuptech.in/api/ba'
const BBPS_PARTNER_ID = process.env.BBPS_PARTNER_ID || process.env.BBPS_CLIENT_ID || ''
const BBPS_CONSUMER_KEY = process.env.BBPS_CONSUMER_KEY || ''
const BBPS_CONSUMER_SECRET = process.env.BBPS_CONSUMER_SECRET || ''

// Environment configuration
const APP_ENV = process.env.APP_ENV || process.env.NODE_ENV || 'development'
const USE_MOCK = process.env.BBPS_USE_MOCK === 'true'

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('🧪 BBPS API Test Script')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

// Check environment variables
console.log('📋 Environment Configuration:')
console.log({
  APP_ENV: APP_ENV,
  NODE_ENV: process.env.NODE_ENV,
  BBPS_USE_MOCK: process.env.BBPS_USE_MOCK,
  BBPS_FORCE_REAL_API: process.env.BBPS_FORCE_REAL_API,
  MODE: USE_MOCK ? 'MOCK' : 'REAL API',
})
console.log('')

// Check credentials
console.log('🔐 Credentials Check:')
const credentialsConfigured = !!(BBPS_PARTNER_ID && BBPS_CONSUMER_KEY && BBPS_CONSUMER_SECRET)
console.log({
  BBPS_API_BASE_URL: BBPS_API_BASE_URL || 'Not set',
  BBPS_PARTNER_ID: BBPS_PARTNER_ID ? '✅ Set' : '❌ Not set',
  BBPS_CONSUMER_KEY: BBPS_CONSUMER_KEY ? '✅ Set' : '❌ Not set',
  BBPS_CONSUMER_SECRET: BBPS_CONSUMER_SECRET ? '✅ Set' : '❌ Not set',
  CREDENTIALS_CONFIGURED: credentialsConfigured ? '✅ Yes' : '❌ No',
})
console.log('')

if (!credentialsConfigured) {
  console.error('❌ ERROR: BBPS API credentials not configured!')
  console.error('Please set the following environment variables:')
  console.error('  - BBPS_PARTNER_ID (or BBPS_CLIENT_ID)')
  console.error('  - BBPS_CONSUMER_KEY')
  console.error('  - BBPS_CONSUMER_SECRET')
  process.exit(1)
}

// Test API connection
async function testBBPSConnection() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🔌 Testing BBPS API Connection...')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  if (USE_MOCK) {
    console.log('⚠️  Mock mode is enabled. Skipping real API test.')
    console.log('Set BBPS_USE_MOCK=false to test real API connection.\n')
    return
  }

  try {
    // Test API call with a simple category (Electricity)
    const testUrl = `${BBPS_API_BASE_URL}/billerId/getList?blr_category_name=Electricity&page=&limit=10`
    const headers = {
      'Content-Type': 'application/json',
      'partnerid': BBPS_PARTNER_ID,
      'consumerkey': BBPS_CONSUMER_KEY,
      'consumersecret': BBPS_CONSUMER_SECRET,
    }

    console.log('📡 Making API Request:')
    console.log('  URL:', testUrl)
    console.log('  Method: GET')
    console.log('  Headers:', {
      'Content-Type': headers['Content-Type'],
      'partnerid': BBPS_PARTNER_ID ? 'Set' : 'Not set',
      'consumerkey': BBPS_CONSUMER_KEY ? 'Set' : 'Not set',
      'consumersecret': '***',
    })
    console.log('')

    const startTime = Date.now()
    const response = await fetch(testUrl, {
      method: 'GET',
      headers,
    })
    const responseTime = Date.now() - startTime

    console.log('📥 API Response:')
    console.log('  Status:', response.status, response.statusText)
    console.log('  Response Time:', `${responseTime}ms`)
    console.log('')

    const responseText = await response.text()
    let responseData
    try {
      responseData = JSON.parse(responseText)
    } catch {
      responseData = responseText
    }

    if (response.ok) {
      console.log('✅ SUCCESS: BBPS API connection is working!')
      console.log('')
      console.log('📊 Response Summary:')
      console.log({
        success: responseData.success,
        message: responseData.message,
        dataCount: Array.isArray(responseData.data) ? responseData.data.length : 0,
        status: responseData.status,
      })
      
      if (Array.isArray(responseData.data) && responseData.data.length > 0) {
        console.log('')
        console.log('📋 Sample Biller (first result):')
        const firstBiller = responseData.data[0]
        console.log({
          biller_id: firstBiller.blr_id || firstBiller._id,
          biller_name: firstBiller.blr_name,
          category: firstBiller.blr_category_name,
        })
      }
      
      console.log('')
      console.log('✅ Your EC2 IP is whitelisted and credentials are working correctly!')
    } else {
      console.error('❌ ERROR: BBPS API connection failed!')
      console.error('')
      console.error('Response:', responseData)
      console.error('')
      
      if (response.status === 401 || response.status === 403) {
        console.error('⚠️  This might indicate:')
        console.error('  - IP address not whitelisted with SparkUpTech')
        console.error('  - Invalid credentials')
        console.error('  - API endpoint changed')
      } else if (response.status === 404) {
        console.error('⚠️  API endpoint not found. Check BBPS_API_BASE_URL.')
      } else {
        console.error('⚠️  Unexpected error. Check API documentation.')
      }
      
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ ERROR: Failed to connect to BBPS API')
    console.error('')
    console.error('Error Details:')
    console.error('  Message:', error.message)
    console.error('  Stack:', error.stack)
    console.error('')
    console.error('⚠️  Possible causes:')
    console.error('  - Network connectivity issue')
    console.error('  - EC2 IP not whitelisted')
    console.error('  - API endpoint unreachable')
    console.error('  - DNS resolution failure')
    console.error('')
    process.exit(1)
  }
}

// Run the test
testBBPSConnection()
  .then(() => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('✅ Test completed successfully!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Test failed with error:', error)
    process.exit(1)
  })

