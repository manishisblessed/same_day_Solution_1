import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

/**
 * POST /api/partner/pos-transactions
 * 
 * Returns POS transactions for the authenticated partner.
 * Queries razorpay_pos_transactions using TIDs/device_serials from partner's assigned machines.
 * 
 * Authentication: HMAC-SHA256 via headers (x-api-key, x-signature, x-timestamp)
 * Permission required: read
 * 
 * Body Parameters:
 * - date_from: ISO 8601 date string (required)
 * - date_to: ISO 8601 date string (required)
 * - status: AUTHORIZED | CAPTURED | FAILED | REFUNDED | VOIDED (optional)
 * - terminal_id: Filter by TID (optional)
 * - payment_mode: CARD | UPI | NFC (optional)
 * - page: Page number (default: 1)
 * - page_size: Records per page (default: 50, max: 100)
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Server configuration error' },
        },
        { status: 500 }
      )
    }

    // Authenticate partner via HMAC
    let authResult
    try {
      authResult = await authenticatePartner(request)
    } catch (error) {
      const authError = error as PartnerAuthError
      return NextResponse.json(
        {
          success: false,
          error: { code: authError.code, message: authError.message },
        },
        { status: authError.status }
      )
    }

    const { partner } = authResult

    // Check permission
    if (!partner.permissions.includes('read')) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions. "read" permission required.' },
        },
        { status: 403 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse body
    let body: any = {}
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' },
        },
        { status: 400 }
      )
    }

    const {
      date_from,
      date_to,
      status,
      terminal_id,
      payment_mode,
      page = 1,
      page_size = 50,
    } = body

    // Validate required date filters
    if (!date_from || !date_to) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: 'date_from and date_to are required' },
        },
        { status: 400 }
      )
    }

    const dateFrom = new Date(date_from)
    const dateTo = new Date(date_to)

    if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Invalid date format. Use ISO 8601 (e.g., 2026-02-16T00:00:00.000Z)' },
        },
        { status: 400 }
      )
    }

    const daysDiff = (dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)
    if (daysDiff > 90) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Date range cannot exceed 90 days' },
        },
        { status: 400 }
      )
    }
    if (daysDiff < 0) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: 'date_from must be before date_to' },
        },
        { status: 400 }
      )
    }

    // Validate optional filters
    const validStatuses = ['AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'VOIDED']
    if (status && !validStatuses.includes(status.toUpperCase())) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: `Invalid status. Allowed: ${validStatuses.join(', ')}` },
        },
        { status: 400 }
      )
    }

    const validModes = ['CARD', 'UPI', 'NFC']
    if (payment_mode && !validModes.includes(payment_mode.toUpperCase())) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: `Invalid payment_mode. Allowed: ${validModes.join(', ')}` },
        },
        { status: 400 }
      )
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(page_size, 10) || 50))
    const offset = (pageNum - 1) * pageSizeNum

    // ========================================================================
    // Step 1: Get partner's TIDs and device serials from assigned machines
    // ========================================================================
    let tids: string[] = []
    let serials: string[] = []

    // From partner_pos_machines (Partner API table)
    const { data: partnerMachines } = await supabase
      .from('partner_pos_machines')
      .select('terminal_id, device_serial')
      .eq('partner_id', partner.id)
      .eq('status', 'active')

    if (partnerMachines) {
      tids.push(...partnerMachines.map((m: any) => m.terminal_id).filter(Boolean))
      serials.push(...partnerMachines.map((m: any) => m.device_serial).filter(Boolean))
    }

    // From pos_machines (admin-managed table)
    const { data: posMachines } = await supabase
      .from('pos_machines')
      .select('tid, serial_number')
      .eq('partner_id', partner.id)
      .in('status', ['active', 'inactive'])

    if (posMachines) {
      tids.push(...posMachines.map((m: any) => m.tid).filter(Boolean))
      serials.push(...posMachines.map((m: any) => m.serial_number).filter(Boolean))
    }

    // Deduplicate
    tids = Array.from(new Set(tids))
    serials = Array.from(new Set(serials))

    console.log(`[Partner API Txn] partner: ${partner.name} (${partner.id}), TIDs: [${tids.join(',')}], serials: [${serials.join(',')}]`)

    if (tids.length === 0 && serials.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: {
          page: pageNum,
          page_size: pageSizeNum,
          total_records: 0,
          total_pages: 0,
          has_next: false,
          has_prev: false,
        },
        summary: {
          total_transactions: 0,
          total_amount: '0.00',
          authorized_count: 0,
          captured_count: 0,
          failed_count: 0,
          refunded_count: 0,
          captured_amount: '0.00',
          terminal_count: 0,
        },
      })
    }

    // ========================================================================
    // Step 2: Build OR filter for razorpay_pos_transactions
    // ========================================================================
    const orConditions: string[] = []
    if (tids.length > 0) orConditions.push(`tid.in.(${tids.join(',')})`)
    if (serials.length > 0) orConditions.push(`device_serial.in.(${serials.join(',')})`)

    // If terminal_id filter provided, validate access
    if (terminal_id && !tids.includes(terminal_id)) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: {
          page: pageNum,
          page_size: pageSizeNum,
          total_records: 0,
          total_pages: 0,
          has_next: false,
          has_prev: false,
        },
        summary: {
          total_transactions: 0,
          total_amount: '0.00',
          authorized_count: 0,
          captured_count: 0,
          failed_count: 0,
          refunded_count: 0,
          captured_amount: '0.00',
          terminal_count: 0,
        },
      })
    }

    // ========================================================================
    // Step 3: Query razorpay_pos_transactions (the actual data source)
    // ========================================================================
    let query = supabase
      .from('razorpay_pos_transactions')
      .select('*', { count: 'exact' })
      .or(orConditions.join(','))
      .gte('transaction_time', dateFrom.toISOString())
      .lte('transaction_time', dateTo.toISOString())
      .order('transaction_time', { ascending: false, nullsFirst: false })

    // Apply optional filters
    if (status) {
      // Map CAPTURED to SUCCESS (display_status convention)
      const displayStatus = status.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : status.toUpperCase()
      query = query.eq('display_status', displayStatus)
    }
    if (terminal_id) {
      query = query.eq('tid', terminal_id)
    }
    if (payment_mode) {
      query = query.eq('payment_mode', payment_mode.toUpperCase())
    }

    // Pagination
    query = query.range(offset, offset + pageSizeNum - 1)

    const { data: transactions, error: txnError, count } = await query

    if (txnError) {
      console.error('Error fetching partner transactions:', txnError)
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch transactions' },
        },
        { status: 500 }
      )
    }

    // ========================================================================
    // Step 4: Fetch ALL matching transactions for summary (without pagination)
    // ========================================================================
    let summaryQuery = supabase
      .from('razorpay_pos_transactions')
      .select('amount, status, display_status, tid')
      .or(orConditions.join(','))
      .gte('transaction_time', dateFrom.toISOString())
      .lte('transaction_time', dateTo.toISOString())

    if (status) {
      const displayStatus = status.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : status.toUpperCase()
      summaryQuery = summaryQuery.eq('display_status', displayStatus)
    }
    if (terminal_id) {
      summaryQuery = summaryQuery.eq('tid', terminal_id)
    }
    if (payment_mode) {
      summaryQuery = summaryQuery.eq('payment_mode', payment_mode.toUpperCase())
    }

    const { data: allTxns } = await summaryQuery

    // Calculate summary
    const allTransactions = allTxns || []

    const getStatus = (t: any) => (t.display_status || t.status || '').toUpperCase()
    const getAmountRupees = (t: any) => parseFloat(t.amount) || 0

    const totalAmount = allTransactions.reduce((sum: number, t: any) => sum + getAmountRupees(t), 0)
    const authorizedCount = allTransactions.filter((t: any) => getStatus(t) === 'AUTHORIZED').length
    const capturedCount = allTransactions.filter((t: any) => getStatus(t) === 'SUCCESS' || getStatus(t) === 'CAPTURED').length
    const failedCount = allTransactions.filter((t: any) => getStatus(t) === 'FAILED').length
    const refundedCount = allTransactions.filter((t: any) => getStatus(t) === 'REFUNDED').length
    const capturedAmount = allTransactions
      .filter((t: any) => getStatus(t) === 'SUCCESS' || getStatus(t) === 'CAPTURED')
      .reduce((sum: number, t: any) => sum + getAmountRupees(t), 0)
    const uniqueTerminals = new Set(allTransactions.map((t: any) => t.tid).filter(Boolean))

    // ========================================================================
    // Step 5: Format response — use dedicated columns with raw_data fallback
    // ========================================================================
    const formattedTransactions = (transactions || []).map((tx: any) => {
      const rd = tx.raw_data || {}
      return {
        id: tx.id,
        razorpay_txn_id: tx.txn_id,
        external_ref: tx.external_ref || rd.externalRefNumber || null,
        terminal_id: tx.tid,
        amount: (parseFloat(tx.amount) || 0).toFixed(2),
        status: tx.display_status === 'SUCCESS' ? 'CAPTURED' : (tx.display_status || tx.status || 'PENDING'),
        rrn: tx.rrn || rd.rrNumber || null,
        card_brand: tx.card_brand || rd.paymentCardBrand || rd.cardBrand || null,
        card_type: tx.card_type || rd.paymentCardType || rd.cardType || null,
        payment_mode: tx.payment_mode || null,
        device_serial: tx.device_serial,
        txn_time: tx.transaction_time,
        created_at: tx.created_at,
        customer_name: tx.customer_name || rd.customerName || rd.payerName || null,
        payer_name: tx.payer_name || rd.payerName || null,
        username: tx.username || rd.username || null,
        txn_type: tx.txn_type || rd.txnType || 'CHARGE',
        auth_code: tx.auth_code || rd.authCode || null,
        card_number: tx.card_number || rd.cardNumber || rd.maskedCardNumber || null,
        issuing_bank: tx.issuing_bank || rd.issuingBankName || rd.bankName || rd.issuingBank || null,
        card_classification: tx.card_classification || rd.cardClassification || rd.cardCategory || null,
        card_txn_type: tx.card_txn_type || rd.cardTxnType || rd.cardTransactionType || rd.entryMode || null,
        acquiring_bank: tx.acquiring_bank || rd.acquiringBank || rd.acquiringBankName || rd.acquirerCode || null,
        mid: tx.mid_code || rd.mid || rd.merchantId || null,
        currency: tx.currency || rd.currencyCode || 'INR',
        receipt_url: tx.receipt_url || rd.customerReceiptUrl || rd.receiptUrl || null,
        posting_date: tx.posting_date || null,
      }
    })

    const totalRecords = count || 0
    const totalPages = totalRecords > 0 ? Math.ceil(totalRecords / pageSizeNum) : 0

    return NextResponse.json({
      success: true,
      data: formattedTransactions,
      pagination: {
        page: pageNum,
        page_size: pageSizeNum,
        total_records: totalRecords,
        total_pages: totalPages,
        has_next: pageNum < totalPages,
        has_prev: pageNum > 1,
      },
      summary: {
        total_transactions: allTransactions.length,
        total_amount: totalAmount.toFixed(2),
        authorized_count: authorizedCount,
        captured_count: capturedCount,
        failed_count: failedCount,
        refunded_count: refundedCount,
        captured_amount: capturedAmount.toFixed(2),
        terminal_count: uniqueTerminals.size,
      },
    })
  } catch (error: any) {
    console.error('Error in POST /api/partner/pos-transactions:', error)
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      },
      { status: 500 }
    )
  }
}

