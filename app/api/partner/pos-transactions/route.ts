import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const EMPTY_SUMMARY = {
  total_transactions: 0,
  total_amount: '0.00',
  authorized_count: 0,
  captured_count: 0,
  failed_count: 0,
  refunded_count: 0,
  captured_amount: '0.00',
  terminal_count: 0,
}

/**
 * POST /api/partner/pos-transactions
 *
 * Returns POS transactions for the authenticated partner.
 *
 * Strategy (dual-source):
 *   1. Query pos_transactions directly by partner_id (primary — populated by
 *      both the Express webhook and the Next.js webhook sync).
 *   2. Also query razorpay_pos_transactions by TID/device_serial (fallback —
 *      catches transactions that were not yet synced to pos_transactions).
 *   3. Merge results, deduplicate by razorpay_txn_id / txn_id, and return.
 *
 * Authentication: HMAC-SHA256 via headers (x-api-key, x-signature, x-timestamp)
 * Permission required: read
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

    const validModes = ['CARD', 'UPI', 'NFC', 'CASH', 'WALLET', 'NETBANKING', 'BHARATQR']
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
    // Step 1: Get partner's TIDs from assigned machines (for fallback query
    //         and terminal_id access validation)
    // ========================================================================
    let tids: string[] = []
    let serials: string[] = []

    const { data: partnerMachines } = await supabase
      .from('partner_pos_machines')
      .select('terminal_id, device_serial')
      .eq('partner_id', partner.id)
      .eq('status', 'active')

    if (partnerMachines) {
      tids.push(...partnerMachines.map((m: any) => m.terminal_id).filter(Boolean))
      serials.push(...partnerMachines.map((m: any) => m.device_serial).filter(Boolean))
    }

    const { data: posMachines } = await supabase
      .from('pos_machines')
      .select('tid, serial_number')
      .eq('partner_id', partner.id)
      .in('status', ['active', 'inactive'])

    if (posMachines) {
      tids.push(...posMachines.map((m: any) => m.tid).filter(Boolean))
      serials.push(...posMachines.map((m: any) => m.serial_number).filter(Boolean))
    }

    tids = Array.from(new Set(tids))
    serials = Array.from(new Set(serials))

    console.log(`[Partner API Txn] partner: ${partner.name} (${partner.id}), TIDs: [${tids.join(',')}], serials: [${serials.join(',')}]`)

    if (tids.length === 0 && serials.length === 0) {
      return NextResponse.json({
        success: true,
        company: 'Same Day Solution',
        data: [],
        pagination: { page: pageNum, page_size: pageSizeNum, total_records: 0, total_pages: 0, has_next: false, has_prev: false },
        summary: EMPTY_SUMMARY,
      })
    }

    // If terminal_id filter provided, validate access
    if (terminal_id && !tids.includes(terminal_id)) {
      return NextResponse.json({
        success: true,
        company: 'Same Day Solution',
        data: [],
        pagination: { page: pageNum, page_size: pageSizeNum, total_records: 0, total_pages: 0, has_next: false, has_prev: false },
        summary: EMPTY_SUMMARY,
      })
    }

    // ========================================================================
    // Step 2: Query BOTH data sources in parallel
    // ========================================================================

    // --- Source A: pos_transactions (has partner_id directly) ---
    // Amount is stored in PAISA (BIGINT)
    let ptQuery = supabase
      .from('pos_transactions')
      .select('*', { count: 'exact' })
      .eq('partner_id', partner.id)
      .gte('txn_time', dateFrom.toISOString())
      .lte('txn_time', dateTo.toISOString())
      .order('txn_time', { ascending: false })

    if (status) {
      ptQuery = ptQuery.eq('status', status.toUpperCase())
    }
    if (terminal_id) {
      ptQuery = ptQuery.eq('terminal_id', terminal_id)
    }
    if (payment_mode) {
      ptQuery = ptQuery.eq('payment_mode', payment_mode.toUpperCase())
    }

    // --- Source B: razorpay_pos_transactions (matched by TID/serial) ---
    // Amount is stored in RUPEES (DECIMAL)
    const orConditions: string[] = []
    if (tids.length > 0) orConditions.push(`tid.in.(${tids.join(',')})`)
    if (serials.length > 0) orConditions.push(`device_serial.in.(${serials.join(',')})`)

    let rptQuery = supabase
      .from('razorpay_pos_transactions')
      .select('*', { count: 'exact' })
      .or(orConditions.join(','))
      .gte('transaction_time', dateFrom.toISOString())
      .lte('transaction_time', dateTo.toISOString())
      .order('transaction_time', { ascending: false, nullsFirst: false })

    if (status) {
      const displayStatus = status.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : status.toUpperCase()
      rptQuery = rptQuery.eq('display_status', displayStatus)
    }
    if (terminal_id) {
      rptQuery = rptQuery.eq('tid', terminal_id)
    }
    if (payment_mode) {
      rptQuery = rptQuery.eq('payment_mode', payment_mode.toUpperCase())
    }

    const [ptResult, rptResult] = await Promise.all([
      ptQuery,
      rptQuery,
    ])

    if (ptResult.error) {
      console.error('Error fetching pos_transactions:', ptResult.error)
    }
    if (rptResult.error) {
      console.error('Error fetching razorpay_pos_transactions:', rptResult.error)
    }

    // ========================================================================
    // Step 3: Merge & deduplicate — pos_transactions is authoritative
    // ========================================================================
    const seenTxnIds = new Set<string>()
    const mergedRows: any[] = []

    // Normalize pos_transactions rows (amount paisa → rupees)
    for (const tx of (ptResult.data || [])) {
      const txnKey = tx.razorpay_txn_id || tx.id
      if (seenTxnIds.has(txnKey)) continue
      seenTxnIds.add(txnKey)

      const rd = tx.raw_payload || {}
      mergedRows.push({
        id: tx.id,
        razorpay_txn_id: tx.razorpay_txn_id,
        external_ref: tx.external_ref || rd.externalRefNumber || null,
        terminal_id: tx.terminal_id,
        amount: ((parseInt(tx.amount, 10) || 0) / 100).toFixed(2),
        status: tx.status || 'PENDING',
        rrn: tx.rrn || rd.rrNumber || null,
        card_brand: tx.card_brand || rd.paymentCardBrand || rd.cardBrand || null,
        card_type: tx.card_type || rd.paymentCardType || rd.cardType || null,
        payment_mode: tx.payment_mode || null,
        device_serial: tx.device_serial,
        txn_time: tx.txn_time,
        created_at: tx.created_at,
        customer_name: tx.customer_name || rd.customerName || rd.payerName || null,
        payer_name: tx.payer_name || rd.payerName || null,
        txn_type: tx.txn_type || rd.txnType || 'CHARGE',
        auth_code: tx.auth_code || rd.authCode || null,
        card_number: tx.card_number || rd.formattedPan || rd.cardNumber || rd.maskedCardNumber || null,
        issuing_bank: tx.issuing_bank || rd.issuingBankName || rd.bankName || rd.issuingBank || null,
        card_classification: tx.card_classification || rd.cardClassification || rd.cardCategory || null,
        card_txn_type: tx.card_txn_type || rd.cardTxnType || rd.cardTransactionType || rd.entryMode || null,
        acquiring_bank: tx.acquiring_bank || rd.acquiringBank || rd.acquiringBankName || rd.acquirerCode || null,
        mid: tx.mid || rd.mid || rd.merchantId || null,
        currency: tx.currency || rd.currencyCode || 'INR',
        receipt_url: tx.receipt_url || rd.customerReceiptUrl || rd.receiptUrl || null,
        posting_date: tx.posting_date || null,
        _source: 'pos_transactions',
      })
    }

    // Add razorpay_pos_transactions rows not already present
    for (const tx of (rptResult.data || [])) {
      const txnKey = tx.txn_id || tx.id
      if (seenTxnIds.has(txnKey)) continue
      seenTxnIds.add(txnKey)

      const rd = tx.raw_data || {}
      mergedRows.push({
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
        txn_type: tx.txn_type || rd.txnType || 'CHARGE',
        auth_code: tx.auth_code || rd.authCode || null,
        card_number: tx.card_number || rd.formattedPan || rd.cardNumber || rd.maskedCardNumber || null,
        issuing_bank: tx.issuing_bank || rd.issuingBankName || rd.bankName || rd.issuingBank || null,
        card_classification: tx.card_classification || rd.cardClassification || rd.cardCategory || null,
        card_txn_type: tx.card_txn_type || rd.cardTxnType || rd.cardTransactionType || rd.entryMode || null,
        acquiring_bank: tx.acquiring_bank || rd.acquiringBank || rd.acquiringBankName || rd.acquirerCode || null,
        mid: tx.mid_code || rd.mid || rd.merchantId || null,
        currency: tx.currency || rd.currencyCode || 'INR',
        receipt_url: tx.receipt_url || rd.customerReceiptUrl || rd.receiptUrl || null,
        posting_date: tx.posting_date || null,
        _source: 'razorpay_pos_transactions',
      })
    }

    // Sort merged rows by txn_time descending
    mergedRows.sort((a, b) => {
      const ta = new Date(a.txn_time || 0).getTime()
      const tb = new Date(b.txn_time || 0).getTime()
      return tb - ta
    })

    // ========================================================================
    // Step 4: Calculate summary from full merged set, then paginate
    // ========================================================================
    const totalRecords = mergedRows.length
    const totalPages = totalRecords > 0 ? Math.ceil(totalRecords / pageSizeNum) : 0

    const getStatusStr = (t: any) => (t.status || '').toUpperCase()
    const getAmt = (t: any) => parseFloat(t.amount) || 0

    const totalAmount = mergedRows.reduce((s, t) => s + getAmt(t), 0)
    const authorizedCount = mergedRows.filter(t => getStatusStr(t) === 'AUTHORIZED').length
    const capturedCount = mergedRows.filter(t => getStatusStr(t) === 'CAPTURED').length
    const failedCount = mergedRows.filter(t => getStatusStr(t) === 'FAILED').length
    const refundedCount = mergedRows.filter(t => getStatusStr(t) === 'REFUNDED').length
    const capturedAmount = mergedRows
      .filter(t => getStatusStr(t) === 'CAPTURED')
      .reduce((s, t) => s + getAmt(t), 0)
    const uniqueTerminals = new Set(mergedRows.map(t => t.terminal_id).filter(Boolean))

    // Paginate
    const paginatedData = mergedRows.slice(offset, offset + pageSizeNum)

    // Strip internal _source field from response
    const responseData = paginatedData.map(({ _source, ...rest }) => rest)

    console.log(`[Partner API Txn] partner: ${partner.name}, pos_txn: ${ptResult.data?.length || 0}, rpt_txn: ${rptResult.data?.length || 0}, merged: ${totalRecords}`)

    return NextResponse.json({
      success: true,
      company: 'Same Day Solution',
      data: responseData,
      pagination: {
        page: pageNum,
        page_size: pageSizeNum,
        total_records: totalRecords,
        total_pages: totalPages,
        has_next: pageNum < totalPages,
        has_prev: pageNum > 1,
      },
      summary: {
        total_transactions: totalRecords,
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

