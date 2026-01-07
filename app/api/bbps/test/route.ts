import { NextRequest, NextResponse } from 'next/server'

/**
 * Test endpoint to verify BBPS API connectivity and credentials
 * This endpoint doesn't require authentication - use it to test your API setup
 */
export async function GET(request: NextRequest) {
  try {
    const BBPS_API_BASE_URL = process.env.BBPS_API_BASE_URL || 'https://api.sparkuptech.in/api/ba'
    const BBPS_PARTNER_ID = process.env.BBPS_PARTNER_ID || process.env.BBPS_CLIENT_ID || ''
    const BBPS_CONSUMER_KEY = process.env.BBPS_CONSUMER_KEY || ''
    const BBPS_CONSUMER_SECRET = process.env.BBPS_CONSUMER_SECRET || ''

    // Check if credentials are configured
    const credentialsConfigured = !!(BBPS_PARTNER_ID && BBPS_CONSUMER_KEY && BBPS_CONSUMER_SECRET)

    if (!credentialsConfigured) {
      return NextResponse.json({
        success: false,
        error: 'BBPS API credentials not configured',
        details: {
          BBPS_API_BASE_URL: BBPS_API_BASE_URL || 'Not set',
          BBPS_PARTNER_ID: BBPS_PARTNER_ID ? 'Set' : 'Not set',
          BBPS_CONSUMER_KEY: BBPS_CONSUMER_KEY ? 'Set' : 'Not set',
          BBPS_CONSUMER_SECRET: BBPS_CONSUMER_SECRET ? 'Set' : 'Not set',
        },
        message: 'Please set BBPS_PARTNER_ID (or BBPS_CLIENT_ID), BBPS_CONSUMER_KEY, and BBPS_CONSUMER_SECRET in your environment variables',
      })
    }

    // Test API call with a simple category (Electricity)
    const testUrl = `${BBPS_API_BASE_URL}/billerId/getList?blr_category_name=Electricity&page=&limit=10`
    const headers = {
      'Content-Type': 'application/json',
      'partnerid': BBPS_PARTNER_ID,
      'consumerkey': BBPS_CONSUMER_KEY,
      'consumersecret': BBPS_CONSUMER_SECRET,
    }

    console.log('Testing BBPS API connection...')
    console.log('URL:', testUrl)
    console.log('Headers:', { ...headers, 'Consumer-Secret': '***' })

    const startTime = Date.now()
    const response = await fetch(testUrl, {
      method: 'GET',
      headers,
    })
    const responseTime = Date.now() - startTime

    const responseText = await response.text()
    let responseData
    try {
      responseData = JSON.parse(responseText)
    } catch {
      responseData = responseText
    }

    // Check if mock mode is enabled
    const APP_ENV = process.env.APP_ENV || process.env.NODE_ENV || 'development'
    const USE_MOCK = process.env.BBPS_USE_MOCK === 'true' || 
                     (APP_ENV === 'dev' && process.env.BBPS_FORCE_REAL_API !== 'true')

    return NextResponse.json({
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      responseTime: `${responseTime}ms`,
      credentialsConfigured: true,
      environment: {
        APP_ENV,
        NODE_ENV: process.env.NODE_ENV,
        USE_MOCK_MODE: USE_MOCK,
      },
      apiUrl: BBPS_API_BASE_URL,
      testUrl,
      response: response.ok ? {
        success: responseData.success,
        message: responseData.message,
        dataCount: Array.isArray(responseData.data) ? responseData.data.length : 0,
      } : {
        error: responseData.message || responseData.error || responseText,
        fullResponse: process.env.NODE_ENV === 'development' ? responseData : undefined,
      },
      headers: {
        'partnerid': BBPS_PARTNER_ID ? 'Set' : 'Not set',
        'consumerkey': BBPS_CONSUMER_KEY ? 'Set' : 'Not set',
        'consumersecret': BBPS_CONSUMER_SECRET ? 'Set' : 'Not set',
      },
      message: response.ok 
        ? 'BBPS API connection successful! Your EC2 IP is whitelisted and credentials are working.'
        : 'BBPS API connection failed. Check your credentials and IP whitelisting.',
    })
  } catch (error: any) {
    console.error('Error testing BBPS API:', error)
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to test BBPS API',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      message: 'Network error or API endpoint unreachable. Check your EC2 instance connectivity.',
    }, { status: 500 })
  }
}

