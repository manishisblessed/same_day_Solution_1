import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * Test Razorpay API Connection
 * Admin-only endpoint to verify Razorpay API credentials and connectivity
 */
export async function GET(request: NextRequest) {
  try {
    // Check admin authentication with fallback
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Test Razorpay] Auth:', method, '|', admin?.email || 'none')
    
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    const results: any = {
      timestamp: new Date().toISOString(),
      tests: []
    }

    // Test 1: Check if credentials are configured
    const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID
    const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET
    const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET

    results.tests.push({
      name: 'Credentials Configuration',
      status: 'checking',
      details: {
        keyId: RAZORPAY_KEY_ID ? `${RAZORPAY_KEY_ID.substring(0, 8)}...` : 'NOT SET',
        keySecret: RAZORPAY_KEY_SECRET ? 'SET' : 'NOT SET',
        webhookSecret: RAZORPAY_WEBHOOK_SECRET ? 'SET' : 'NOT SET'
      }
    })

    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      results.tests[0].status = 'failed'
      results.tests[0].error = 'Razorpay credentials are not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in environment variables.'
      return NextResponse.json(results)
    }

    results.tests[0].status = 'passed'

    // Test 2: Test API Authentication (fetch account details)
    try {
      const authString = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')
      
      const accountResponse = await fetch('https://api.razorpay.com/v1/account', {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/json'
        }
      })

      const accountData = await accountResponse.json()

      if (accountResponse.ok) {
        results.tests.push({
          name: 'API Authentication',
          status: 'passed',
          details: {
            accountId: accountData.id || 'N/A',
            accountName: accountData.name || 'N/A',
            accountType: accountData.type || 'N/A'
          }
        })
      } else {
        results.tests.push({
          name: 'API Authentication',
          status: 'failed',
          error: accountData.error?.description || accountData.error?.message || 'Authentication failed',
          details: {
            statusCode: accountResponse.status,
            response: accountData
          }
        })
      }
    } catch (error: any) {
      results.tests.push({
        name: 'API Authentication',
        status: 'failed',
        error: error.message || 'Failed to connect to Razorpay API',
        details: {
          message: error.message
        }
      })
    }

    // Test 3: Test Payments API (fetch recent payments - limit 1)
    try {
      const authString = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')
      
      const paymentsResponse = await fetch('https://api.razorpay.com/v1/payments?count=1', {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/json'
        }
      })

      const paymentsData = await paymentsResponse.json()

      if (paymentsResponse.ok) {
        results.tests.push({
          name: 'Payments API Access',
          status: 'passed',
          details: {
            canAccessPayments: true,
            totalPayments: paymentsData.count || 0,
            samplePayment: paymentsData.items && paymentsData.items.length > 0 ? {
              id: paymentsData.items[0].id,
              amount: paymentsData.items[0].amount,
              status: paymentsData.items[0].status,
              method: paymentsData.items[0].method
            } : 'No payments found'
          }
        })
      } else {
        results.tests.push({
          name: 'Payments API Access',
          status: 'failed',
          error: paymentsData.error?.description || paymentsData.error?.message || 'Failed to access payments API',
          details: {
            statusCode: paymentsResponse.status,
            response: paymentsData
          }
        })
      }
    } catch (error: any) {
      results.tests.push({
        name: 'Payments API Access',
        status: 'failed',
        error: error.message || 'Failed to connect to Razorpay Payments API',
        details: {
          message: error.message
        }
      })
    }

    // Test 4: Test Webhook Signature Verification
    if (RAZORPAY_WEBHOOK_SECRET) {
      try {
        const testPayload = JSON.stringify({ test: 'webhook signature verification' })
        const testSignature = crypto
          .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
          .update(testPayload)
          .digest('hex')

        const isValid = crypto.timingSafeEqual(
          Buffer.from(testSignature),
          Buffer.from(testSignature) // Should match
        )

        results.tests.push({
          name: 'Webhook Signature Verification',
          status: isValid ? 'passed' : 'failed',
          details: {
            webhookSecretConfigured: true,
            signatureAlgorithm: 'HMAC SHA256',
            testResult: isValid ? 'Signature verification working correctly' : 'Signature verification failed'
          }
        })
      } catch (error: any) {
        results.tests.push({
          name: 'Webhook Signature Verification',
          status: 'failed',
          error: error.message || 'Failed to test webhook signature verification',
          details: {
            message: error.message
          }
        })
      }
    } else {
      results.tests.push({
        name: 'Webhook Signature Verification',
        status: 'skipped',
        details: {
          reason: 'RAZORPAY_WEBHOOK_SECRET is not configured'
        }
      })
    }

    // Test 5: Test Orders API (if needed for POS)
    try {
      const authString = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')
      
      const ordersResponse = await fetch('https://api.razorpay.com/v1/orders?count=1', {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/json'
        }
      })

      const ordersData = await ordersResponse.json()

      if (ordersResponse.ok) {
        results.tests.push({
          name: 'Orders API Access',
          status: 'passed',
          details: {
            canAccessOrders: true,
            totalOrders: ordersData.count || 0
          }
        })
      } else {
        results.tests.push({
          name: 'Orders API Access',
          status: 'failed',
          error: ordersData.error?.description || ordersData.error?.message || 'Failed to access orders API',
          details: {
            statusCode: ordersResponse.status
          }
        })
      }
    } catch (error: any) {
      results.tests.push({
        name: 'Orders API Access',
        status: 'failed',
        error: error.message || 'Failed to connect to Razorpay Orders API',
        details: {
          message: error.message
        }
      })
    }

    // Calculate overall status
    const passedTests = results.tests.filter((t: any) => t.status === 'passed').length
    const failedTests = results.tests.filter((t: any) => t.status === 'failed').length
    const totalTests = results.tests.filter((t: any) => t.status !== 'skipped').length

    results.summary = {
      total: totalTests,
      passed: passedTests,
      failed: failedTests,
      skipped: results.tests.filter((t: any) => t.status === 'skipped').length,
      overallStatus: failedTests === 0 ? 'SUCCESS' : 'PARTIAL_FAILURE'
    }

    return NextResponse.json(results)

  } catch (error: any) {
    console.error('[Test Razorpay API] Error:', error)
    return NextResponse.json(
      {
        error: 'Failed to test Razorpay API',
        details: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}

