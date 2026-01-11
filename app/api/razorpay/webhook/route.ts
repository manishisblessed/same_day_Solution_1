import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyWebhookSignature, processRazorpayTransaction } from '@/lib/razorpay/service'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export async function POST(request: NextRequest) {
  try {
    // Get webhook signature from headers
    const signature = request.headers.get('x-razorpay-signature')
    if (!signature) {
      return NextResponse.json(
        { error: 'Missing webhook signature' },
        { status: 401 }
      )
    }

    // Get raw body for signature verification
    const body = await request.text()
    const payload = JSON.parse(body)

    // Verify webhook signature
    const isValid = verifyWebhookSignature(body, signature)
    if (!isValid) {
      console.error('Invalid webhook signature')
      return NextResponse.json(
        { error: 'Invalid webhook signature' },
        { status: 401 }
      )
    }

    // Handle payment events
    if (payload.event === 'payment.captured' || payload.event === 'payment.authorized') {
      const payment = payload.payload.payment.entity

      // Process transaction
      const result = await processRazorpayTransaction(payment.id, {
        amount: payment.amount,
        status: payment.status,
        method: payment.method,
        terminal_id: payment.terminal_id,
        rrn: payment.rrn,
        auth_code: payment.auth_code,
        created_at: payment.created_at,
        notes: payment.notes || {}
      })

      if (!result.success) {
        console.error('Error processing transaction:', result.error)
        // Still return 200 to prevent Razorpay from retrying
        // Log error for manual review
        return NextResponse.json({ 
          received: true, 
          processed: false,
          error: result.error 
        })
      }

      return NextResponse.json({ 
        received: true, 
        processed: true,
        transactionId: result.transactionId 
      })
    }

    // Handle other events (refunds, etc.)
    if (payload.event === 'payment.refunded' || payload.event === 'refund.processed') {
      // Update transaction status
      const paymentId = payload.payload.payment?.entity?.id || payload.payload.refund?.entity?.payment_id
      
      if (paymentId) {
        await supabase
          .from('razorpay_transactions')
          .update({ 
            status: 'refunded',
            razorpay_status: 'refunded'
          })
          .eq('razorpay_payment_id', paymentId)
      }
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Webhook error:', error)
    // Return 200 to prevent Razorpay from retrying
    return NextResponse.json({ 
      received: true, 
      error: error.message 
    })
  }
}

// Handle GET for webhook verification (if needed)
export async function GET() {
  return NextResponse.json({ 
    message: 'Razorpay webhook endpoint',
    status: 'active' 
  })
}










