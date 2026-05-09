import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import { resolveTransactionAssignments } from '@/lib/pos-assignment-resolver'

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
    const rawLimit = parseInt(searchParams.get('limit') || '25', 10)
    const limit = [10, 25, 50, 100].includes(rawLimit) ? rawLimit : 25
    const offset = (page - 1) * limit
    const statusFilter = searchParams.get('status') // Optional filter by status
    const dateFrom = searchParams.get('date_from') // Date range start (YYYY-MM-DD or ISO)
    const dateTo = searchParams.get('date_to') // Date range end (YYYY-MM-DD or ISO)
    const paymentMode = searchParams.get('payment_mode') // Filter by payment mode (CARD, UPI, CASH, etc.)
    const searchQuery = searchParams.get('search') // Search by TID, MID, RRN, txn_id, customer_name
    const settlementFilter = searchParams.get('settlement_status') // Filter by settlement status
    const cardBrand = searchParams.get('card_brand') // Filter by card brand
    const merchantSlug = searchParams.get('merchant_slug') // Filter by company: all | ashvam | teachway | newscenaric | lagoon
    const acquiringBank = searchParams.get('acquiring_bank') // Filter by acquiring bank (partial match)

    // Validate pagination
    if (page < 1 || limit < 1) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters' },
        { status: 400 }
      )
    }

    // Fix misclassified transactions: raw status CAPTURED/SUCCESS should be display_status SUCCESS
    // This handles records that were stored before the mapTransactionStatus fix
    // Also covers SETTLEMENT_POSTED from report uploads
    await supabase
      .from('razorpay_pos_transactions')
      .update({ display_status: 'SUCCESS' })
      .eq('display_status', 'PENDING')
      .in('status', ['CAPTURED', 'SUCCESS', 'AUTHORIZED', 'SETTLEMENT_POSTED'])

    // Build query from razorpay_pos_transactions (the table webhook writes to)
    // Select dedicated columns + raw_data for fallback extraction
    let query = supabase
      .from('razorpay_pos_transactions')
      .select('txn_id, amount, payment_mode, display_status, status, transaction_time, raw_data, tid, device_serial, merchant_name, merchant_slug, customer_name, payer_name, username, txn_type, auth_code, card_number, issuing_bank, card_classification, mid_code, card_brand, card_type, currency, rrn, external_ref, settlement_status, settled_on, receipt_url, posting_date, acquiring_bank', { count: 'exact' })
      .order('transaction_time', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    // Apply company (merchant) filter: supports multiple comma-separated slugs
    // ashvam = base URL (slug or null), others = exact slug
    if (merchantSlug && merchantSlug !== 'all') {
      const slugs = merchantSlug.split(',').map(s => s.trim()).filter(Boolean)
      if (slugs.length === 1) {
        if (slugs[0] === 'ashvam') {
          query = query.or('merchant_slug.eq.ashvam,merchant_slug.is.null')
        } else {
          query = query.eq('merchant_slug', slugs[0])
        }
      } else if (slugs.length > 1) {
        // Build OR condition for multiple slugs
        const conditions = slugs.map(slug => {
          if (slug === 'ashvam') {
            return 'merchant_slug.eq.ashvam,merchant_slug.is.null'
          }
          return `merchant_slug.eq.${slug}`
        }).join(',')
        query = query.or(conditions)
      }
    }

    // Apply status filter if provided (filter on display_status: SUCCESS, FAILED, PENDING)
    if (statusFilter && ['CAPTURED', 'FAILED', 'PENDING'].includes(statusFilter.toUpperCase())) {
      const displayStatus = statusFilter.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : statusFilter.toUpperCase()
      query = query.eq('display_status', displayStatus)
    }

    // Apply date range filter (IST boundaries — +05:30 offset)
    if (dateFrom) {
      const fromDate = dateFrom.includes('T') ? dateFrom : `${dateFrom}T00:00:00+05:30`
      query = query.gte('transaction_time', fromDate)
    }
    if (dateTo) {
      const toDate = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59+05:30`
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

    // Apply acquiring bank filter (case-insensitive, partial match)
    if (acquiringBank && acquiringBank.trim()) {
      const b = acquiringBank.trim()
      query = query.ilike('acquiring_bank', `%${b}%`)
    }

    // Apply search query (search across multiple fields using OR)
    if (searchQuery && searchQuery.trim()) {
      const s = searchQuery.trim()
      query = query.or(`txn_id.ilike.%${s}%,rrn.ilike.%${s}%,tid.ilike.%${s}%,mid_code.ilike.%${s}%,customer_name.ilike.%${s}%,username.ilike.%${s}%,card_number.ilike.%${s}%,merchant_name.ilike.%${s}%`)
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

    // Time-aware partner/retailer resolution using assignment history
    const assignmentMap = await resolveTransactionAssignments(
      supabase,
      (transactions || []).map((t: any) => ({
        txn_id: t.txn_id,
        tid: t.tid,
        transaction_time: t.transaction_time,
      }))
    )

    // Build a separate query for aggregate stats
    // We use multiple targeted queries to avoid the 1000-row default limit

    // Fetch amounts in pages to avoid the 1000-row limit
    let totalCapturedAmount = 0
    let totalCapturedCount = 0
    const pageLimit = 1000
    let statsOffset = 0
    let hasMoreStats = true

    // Determine what display_status to use for stats:
    // If user selected a specific status filter, only aggregate that status.
    // Otherwise aggregate SUCCESS (captured) transactions.
    const statsDisplayStatus = (statusFilter && ['CAPTURED', 'FAILED', 'PENDING'].includes(statusFilter.toUpperCase()))
      ? (statusFilter.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : statusFilter.toUpperCase())
      : 'SUCCESS'

    while (hasMoreStats) {
      let amountQuery = supabase
        .from('razorpay_pos_transactions')
        .select('amount')
        .eq('display_status', statsDisplayStatus)
        .range(statsOffset, statsOffset + pageLimit - 1)

      // Apply all filters EXCEPT status (already handled above)
      if (merchantSlug && merchantSlug !== 'all') {
        const slugs = merchantSlug.split(',').map(s => s.trim()).filter(Boolean)
        if (slugs.length === 1) {
          if (slugs[0] === 'ashvam') {
            amountQuery = amountQuery.or('merchant_slug.eq.ashvam,merchant_slug.is.null')
          } else {
            amountQuery = amountQuery.eq('merchant_slug', slugs[0])
          }
        } else if (slugs.length > 1) {
          const conditions = slugs.map(slug => {
            if (slug === 'ashvam') return 'merchant_slug.eq.ashvam,merchant_slug.is.null'
            return `merchant_slug.eq.${slug}`
          }).join(',')
          amountQuery = amountQuery.or(conditions)
        }
      }
      if (dateFrom) {
        const fromDate = dateFrom.includes('T') ? dateFrom : `${dateFrom}T00:00:00+05:30`
        amountQuery = amountQuery.gte('transaction_time', fromDate)
      }
      if (dateTo) {
        const toDate = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59+05:30`
        amountQuery = amountQuery.lte('transaction_time', toDate)
      }
      if (paymentMode && paymentMode !== 'all') amountQuery = amountQuery.eq('payment_mode', paymentMode.toUpperCase())
      if (settlementFilter && settlementFilter !== 'all') amountQuery = amountQuery.eq('settlement_status', settlementFilter.toUpperCase())
      if (cardBrand && cardBrand !== 'all') amountQuery = amountQuery.eq('card_brand', cardBrand.toUpperCase())
      if (acquiringBank && acquiringBank.trim()) amountQuery = amountQuery.ilike('acquiring_bank', `%${acquiringBank.trim()}%`)
      if (searchQuery && searchQuery.trim()) {
        const s = searchQuery.trim()
        amountQuery = amountQuery.or(`txn_id.ilike.%${s}%,rrn.ilike.%${s}%,tid.ilike.%${s}%,mid_code.ilike.%${s}%,customer_name.ilike.%${s}%,username.ilike.%${s}%,card_number.ilike.%${s}%`)
      }

      const { data: amountData } = await amountQuery
      if (amountData && amountData.length > 0) {
        totalCapturedAmount += amountData.reduce((sum: number, t: any) => sum + (t.amount || 0), 0)
        totalCapturedCount += amountData.length
        statsOffset += pageLimit
        if (amountData.length < pageLimit) hasMoreStats = false
      } else {
        hasMoreStats = false
      }
    }

    // total count comes from the main paginated query (exact count)
    const totalTransactions = count || 0
    const capturedAmount = totalCapturedAmount
    const avgAmount = totalCapturedCount > 0 ? Math.round(capturedAmount / totalCapturedCount) : 0

    // Map fields to the format the frontend expects
    // Use dedicated columns first, fallback to raw_data extraction
    const mappedTransactions = (transactions || []).map((txn: any) => {
      const assignment = assignmentMap[txn.txn_id]
      const assignedName = assignment?.assigned_name || null
      const assignedType = assignment?.assigned_type || null

      return {
        txn_id: txn.txn_id,
        amount: txn.amount,
        payment_mode: txn.payment_mode,
        // Map display_status back to frontend status: SUCCESS→CAPTURED
        status: txn.display_status === 'SUCCESS' ? 'CAPTURED' : (txn.display_status || txn.status || 'PENDING'),
        settlement_status: txn.settlement_status || txn.raw_data?.settlementStatus || null,
        created_time: txn.transaction_time,
        service_provider: 'RAZORPAY',
        // Company (merchant_slug): ashvam, teachway, newscenaric, lagoon; null = legacy/ashvam
        merchant_slug: txn.merchant_slug || 'ashvam',
        // Partner/Retailer/Distributor/MD assignment info (from POS machine)
        assigned_name: assignedName,
        assigned_type: assignedType,
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
        acquiring_bank: txn.acquiring_bank || txn.raw_data?.acquiringBank || txn.raw_data?.acquiringBankName || txn.raw_data?.acquirerCode || null,
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
      }
    })

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
      },
      stats: {
        capturedAmount,
        avgAmount,
      }
    })

  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}

