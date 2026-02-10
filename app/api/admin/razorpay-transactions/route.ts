import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

// Helper function to get Supabase client with validation
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables. Please configure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(supabaseUrl, supabaseServiceKey)
}

/**
 * Admin-only API to fetch Razorpay POS transactions
 * 
 * Reads from razorpay_pos_transactions table (populated by webhook)
 * Returns paginated list of transactions sorted by transaction_time DESC
 * 
 * Response fields:
 * - txn_id
 * - amount
 * - payment_mode
 * - status (CAPTURED, FAILED, PENDING)
 * - settlement_status
 * - created_time (mapped from transaction_time)
 */
export async function GET(request: NextRequest) {
  // Check environment variables FIRST - before anything else
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { 
        error: 'Server configuration error',
        message: `Missing: ${!supabaseUrl ? 'NEXT_PUBLIC_SUPABASE_URL' : ''} ${!supabaseServiceKey ? 'SUPABASE_SERVICE_ROLE_KEY' : ''}`.trim()
      },
      { status: 500 }
    )
  }

  try {
    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check admin authentication with fallback
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Razorpay Transactions] Auth:', method, '|', admin?.email || 'none')
    
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100) // Cap at 100
    const offset = (page - 1) * limit
    const statusFilter = searchParams.get('status') // Optional filter by status

    // Validate pagination
    if (page < 1 || limit < 1) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters' },
        { status: 400 }
      )
    }

    // Build query from razorpay_pos_transactions (the table webhook writes to)
    let query = supabase
      .from('razorpay_pos_transactions')
      .select('txn_id, amount, payment_mode, display_status, status, transaction_time, raw_data', { count: 'exact' })
      .order('transaction_time', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    // Apply status filter if provided (filter on display_status: SUCCESS, FAILED, PENDING)
    if (statusFilter && ['CAPTURED', 'FAILED', 'PENDING'].includes(statusFilter.toUpperCase())) {
      const displayStatus = statusFilter.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : statusFilter.toUpperCase()
      query = query.eq('display_status', displayStatus)
    }

    const { data: transactions, error, count } = await query

    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return NextResponse.json(
          { error: 'Table razorpay_pos_transactions does not exist. Please contact admin.' },
          { status: 500 }
        )
      }
      return NextResponse.json(
        { error: 'Database error', message: error.message },
        { status: 500 }
      )
    }

    // Map fields to the format the frontend expects
    const mappedTransactions = (transactions || []).map((txn: any) => ({
      txn_id: txn.txn_id,
      amount: txn.amount,
      payment_mode: txn.payment_mode,
      // Map display_status back to frontend status: SUCCESS→CAPTURED
      status: txn.display_status === 'SUCCESS' ? 'CAPTURED' : (txn.display_status || txn.status || 'PENDING'),
      settlement_status: txn.raw_data?.settlementStatus || null,
      created_time: txn.transaction_time,
      // Additional details from raw_data for expanded view
      customer_name: txn.raw_data?.customerName || txn.raw_data?.payerName || null,
      payer_name: txn.raw_data?.payerName || null,
      tid: txn.raw_data?.tid || null,
      mid: txn.raw_data?.mid || null,
      rrn: txn.raw_data?.rrNumber || txn.raw_data?.rrn || null,
      device_serial: txn.raw_data?.deviceSerial || null,
      external_ref: txn.raw_data?.externalRefNumber || null,
      card_brand: txn.raw_data?.paymentCardBrand || null,
      card_type: txn.raw_data?.paymentCardType || null,
      txn_type: txn.raw_data?.txnType || null,
      currency: txn.raw_data?.currencyCode || null,
      auth_code: txn.raw_data?.authCode || null,
      customer_receipt_url: txn.raw_data?.customerReceiptUrl || null,
      posting_date: txn.raw_data?.postingDate || null,
      username: txn.raw_data?.username || null,
      merchant_name: txn.raw_data?.merchantName || txn.merchant_name || null,
      raw_data: txn.raw_data || null
    }))

    // Calculate pagination metadata
    const totalPages = count ? Math.ceil(count / limit) : 1
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    return NextResponse.json({
      success: true,
      data: mappedTransactions,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNextPage,
        hasPrevPage
      }
    })

  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}

