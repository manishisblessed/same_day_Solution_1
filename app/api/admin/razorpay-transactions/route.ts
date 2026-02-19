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
    const dateFrom = searchParams.get('date_from') // Date range start (YYYY-MM-DD or ISO)
    const dateTo = searchParams.get('date_to') // Date range end (YYYY-MM-DD or ISO)
    const paymentMode = searchParams.get('payment_mode') // Filter by payment mode (CARD, UPI, CASH, etc.)
    const searchQuery = searchParams.get('search') // Search by TID, MID, RRN, txn_id, customer_name
    const settlementFilter = searchParams.get('settlement_status') // Filter by settlement status
    const cardBrand = searchParams.get('card_brand') // Filter by card brand

    // Validate pagination
    if (page < 1 || limit < 1) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters' },
        { status: 400 }
      )
    }

    // Build query from razorpay_pos_transactions (the table webhook writes to)
    // Select dedicated columns + raw_data for fallback extraction
    let query = supabase
      .from('razorpay_pos_transactions')
      .select('txn_id, amount, payment_mode, display_status, status, transaction_time, raw_data, tid, device_serial, merchant_name, customer_name, payer_name, username, txn_type, auth_code, card_number, issuing_bank, card_classification, mid_code, card_brand, card_type, currency, rrn, external_ref, settlement_status, settled_on, receipt_url, posting_date', { count: 'exact' })
      .order('transaction_time', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    // Apply status filter if provided (filter on display_status: SUCCESS, FAILED, PENDING)
    if (statusFilter && ['CAPTURED', 'FAILED', 'PENDING'].includes(statusFilter.toUpperCase())) {
      const displayStatus = statusFilter.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : statusFilter.toUpperCase()
      query = query.eq('display_status', displayStatus)
    }

    // Apply date range filter
    if (dateFrom) {
      const fromDate = dateFrom.includes('T') ? dateFrom : `${dateFrom}T00:00:00`
      query = query.gte('transaction_time', fromDate)
    }
    if (dateTo) {
      const toDate = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59`
      query = query.lte('transaction_time', toDate)
    }

    // Apply payment mode filter
    if (paymentMode && paymentMode !== 'all') {
      query = query.eq('payment_mode', paymentMode.toUpperCase())
    }

    // Apply settlement status filter
    if (settlementFilter && settlementFilter !== 'all') {
      query = query.eq('settlement_status', settlementFilter.toUpperCase())
    }

    // Apply card brand filter
    if (cardBrand && cardBrand !== 'all') {
      query = query.eq('card_brand', cardBrand.toUpperCase())
    }

    // Apply search query (search across multiple fields using OR)
    if (searchQuery && searchQuery.trim()) {
      const s = searchQuery.trim()
      query = query.or(`txn_id.ilike.%${s}%,rrn.ilike.%${s}%,tid.ilike.%${s}%,mid_code.ilike.%${s}%,customer_name.ilike.%${s}%,username.ilike.%${s}%,card_number.ilike.%${s}%`)
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
    // Use dedicated columns first, fallback to raw_data extraction
    const mappedTransactions = (transactions || []).map((txn: any) => ({
      txn_id: txn.txn_id,
      amount: txn.amount,
      payment_mode: txn.payment_mode,
      // Map display_status back to frontend status: SUCCESS→CAPTURED
      status: txn.display_status === 'SUCCESS' ? 'CAPTURED' : (txn.display_status || txn.status || 'PENDING'),
      settlement_status: txn.settlement_status || txn.raw_data?.settlementStatus || null,
      created_time: txn.transaction_time,
      // Customer & User Info
      customer_name: txn.customer_name || txn.raw_data?.customerName || txn.raw_data?.payerName || null,
      payer_name: txn.payer_name || txn.raw_data?.payerName || null,
      username: txn.username || txn.raw_data?.username || null,
      // Terminal & Device Info
      tid: txn.tid || txn.raw_data?.tid || null,
      mid: txn.mid_code || txn.raw_data?.mid || txn.raw_data?.merchantId || null,
      device_serial: txn.device_serial || txn.raw_data?.deviceSerial || null,
      merchant_name: txn.merchant_name || txn.raw_data?.merchantName || null,
      // Transaction Details
      txn_type: txn.txn_type || txn.raw_data?.txnType || 'CHARGE',
      auth_code: txn.auth_code || txn.raw_data?.authCode || null,
      currency: txn.currency || txn.raw_data?.currencyCode || 'INR',
      // Card Details
      card_brand: txn.card_brand || txn.raw_data?.paymentCardBrand || txn.raw_data?.cardBrand || null,
      card_type: txn.card_type || txn.raw_data?.paymentCardType || txn.raw_data?.cardType || null,
      card_number: txn.card_number || txn.raw_data?.cardNumber || txn.raw_data?.maskedCardNumber || null,
      issuing_bank: txn.issuing_bank || txn.raw_data?.issuingBankName || txn.raw_data?.bankName || txn.raw_data?.issuingBank || null,
      card_classification: txn.card_classification || txn.raw_data?.cardClassification || txn.raw_data?.cardCategory || null,
      // Reference Numbers
      rrn: txn.rrn || txn.raw_data?.rrNumber || txn.raw_data?.rrn || null,
      external_ref: txn.external_ref || txn.raw_data?.externalRefNumber || null,
      // Dates
      posting_date: txn.posting_date || txn.raw_data?.postingDate || null,
      settled_on: txn.settled_on || txn.raw_data?.settledOn || txn.raw_data?.settlementDate || null,
      // Receipt
      customer_receipt_url: txn.receipt_url || txn.raw_data?.customerReceiptUrl || txn.raw_data?.receiptUrl || null,
      // Raw data for JSON view
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

