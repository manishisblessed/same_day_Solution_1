import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Admin-only API to send a test transaction to the Razorpay POS webhook endpoint
 * 
 * This allows admins to manually fire test transactions from the dashboard
 * to verify the webhook pipeline is working end-to-end.
 */
export async function POST(request: NextRequest) {
  try {
    // Check admin authentication
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Test Razorpay Transaction] Auth:', method, '|', admin?.email || 'none')
    
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    // Get test parameters from request body
    const body = await request.json()
    const {
      amount = 100,
      paymentMode = 'UPI',
      customerName = 'Test Customer',
      status = 'AUTHORIZED'
    } = body

    // Generate unique test transaction ID
    const now = new Date()
    const timestamp = now.toISOString().replace(/[-:.TZ]/g, '').substring(0, 14)
    const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0')
    const testTxnId = `TEST_ADMIN_${timestamp}_${random}`

    // Build POS-format payload (matching what Razorpay sends)
    const testPayload = {
      amount: amount,
      amountAdditional: 0,
      amountCashBack: 0,
      amountOriginal: amount,
      authCode: 'NA',
      batchNumber: '',
      currencyCode: 'INR',
      customerName: customerName,
      customerReceiptUrl: '',
      deviceSerial: '',
      externalRefNumber: `EZ_TEST_${timestamp}`,
      externalRefNumber4: '',
      externalRefNumber5: '',
      externalRefNumber6: '',
      externalRefNumber7: '',
      formattedPan: '',
      invoiceNumber: '',
      mid: 'TEST_MID',
      payerName: customerName,
      paymentCardBrand: '',
      paymentCardType: paymentMode === 'CARD' ? 'DEBIT' : 'UNKNOWN',
      paymentMode: paymentMode,
      pgInvoiceNumber: '',
      postingDate: now.toISOString(),
      rrNumber: Math.floor(Math.random() * 100000000).toString(),
      settlementStatus: 'PENDING',
      stan: '',
      status: status,
      tid: 'TEST_TID',
      txnId: testTxnId,
      Id: testTxnId,
      txnType: 'CHARGE',
      userAgreement: '',
      username: 'admin_test',
      orderId: ''
    }

    // Determine the webhook URL (use internal URL for server-to-server call)
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.NEXTAUTH_URL || 'https://api.samedaysolution.in'
    const webhookUrl = `${baseUrl}/api/razorpay/notification`

    console.log(`[Test Transaction] Sending test to: ${webhookUrl}`)
    console.log(`[Test Transaction] Payload:`, JSON.stringify({ txnId: testTxnId, amount, paymentMode, status }))

    // Send the test transaction to the webhook endpoint
    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/json'
      },
      body: JSON.stringify(testPayload)
    })

    const webhookResult = await webhookResponse.json()

    return NextResponse.json({
      success: true,
      message: 'Test transaction sent successfully',
      testTxnId: testTxnId,
      webhookResponse: {
        status: webhookResponse.status,
        ...webhookResult
      },
      sentPayload: {
        txnId: testTxnId,
        amount,
        paymentMode,
        customerName,
        status
      }
    })

  } catch (error: any) {
    console.error('[Test Razorpay Transaction] Error:', error)
    return NextResponse.json(
      { error: 'Failed to send test transaction', details: error.message },
      { status: 500 }
    )
  }
}

