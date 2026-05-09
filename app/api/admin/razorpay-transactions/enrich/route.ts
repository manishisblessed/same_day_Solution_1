import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ParsedRecord {
  txn_id: string
  date?: string | null
  consumer?: string | null
  username?: string | null
  mode?: string | null
  amount?: number | null
  auth_code?: string | null
  card_number?: string | null
  issuing_bank?: string | null
  card_type?: string | null
  card_brand?: string | null
  card_classification?: string | null
  card_txn_type?: string | null
  rrn?: string | null
  device_serial?: string | null
  status?: string | null
  mid?: string | null
  tid?: string | null
  ref?: string | null
  acquiring_bank?: string | null
  receipt_url?: string | null
  company?: string | null
  payer?: string | null
}

/**
 * POST /api/admin/razorpay-transactions/enrich
 * 
 * Admin-only endpoint that:
 * 1. ENRICHES existing transactions with report-only fields
 * 2. INSERTS missing transactions that don't exist in the database
 * 
 * This handles the case where webhooks were missed (e.g. SSL certificate expired)
 * and the admin uploads the Ezetap/Razorpay report to backfill missing data.
 * 
 * Accepts: Tab-separated text (Razorpay/Ezetap report format) or JSON.
 * Matches by txn_id (the "ID" column in the report).
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      )
    }

    const contentType = request.headers.get('content-type') || ''
    let records: ParsedRecord[] = []

    if (contentType.includes('text/plain') || contentType.includes('text/tab-separated')) {
      const text = await request.text()
      records = parseTabSeparatedReport(text)
    } else {
      const body = await request.json()
      if (body.report_text) {
        records = parseTabSeparatedReport(body.report_text)
      } else if (Array.isArray(body.records)) {
        records = body.records
      } else {
        return NextResponse.json(
          { success: false, error: 'Send { report_text: "..." } with the Razorpay report content, or { records: [...] }' },
          { status: 400 }
        )
      }
    }

    if (records.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid records found in the uploaded report' },
        { status: 400 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let updated = 0
    let inserted = 0
    let skipped = 0
    const errors: string[] = []

    for (const record of records) {
      if (!record.txn_id) {
        skipped++
        continue
      }

      // Check if transaction exists
      const { data: existing } = await supabase
        .from('razorpay_pos_transactions')
        .select('id')
        .eq('txn_id', record.txn_id)
        .maybeSingle()

      if (existing) {
        // UPDATE existing record with enrichment fields + fix status
        const updateData: Record<string, any> = {}
        if (record.card_classification && record.card_classification !== 'NULL') {
          updateData.card_classification = record.card_classification
        }
        if (record.card_txn_type && record.card_txn_type !== 'NULL') {
          updateData.card_txn_type = record.card_txn_type
        }
        if (record.issuing_bank && record.issuing_bank !== 'NULL') {
          updateData.issuing_bank = record.issuing_bank
        }
        if (record.acquiring_bank && record.acquiring_bank !== 'NULL') {
          updateData.acquiring_bank = record.acquiring_bank
        }
        if (record.card_number) {
          updateData.card_number = record.card_number
        }
        // Fix display_status for settled transactions
        if (isSuccessStatus(record.status)) {
          updateData.display_status = 'SUCCESS'
          updateData.settlement_status = 'SETTLED'
        }
        // Fix merchant slug/name from report
        if (record.company) {
          updateData.merchant_name = record.company
          updateData.merchant_slug = detectMerchantSlug(record.company)
        }

        if (Object.keys(updateData).length === 0) {
          skipped++
          continue
        }

        const { error } = await supabase
          .from('razorpay_pos_transactions')
          .update(updateData)
          .eq('txn_id', record.txn_id)

        if (error) {
          errors.push(`${record.txn_id}: update failed - ${error.message}`)
        } else {
          updated++
        }
      } else {
        // INSERT missing transaction
        if (!record.amount || record.amount <= 0) {
          skipped++
          continue
        }

        const txnTime = parseReportDate(record.date)
        const merchantSlug = detectMerchantSlug(record.company)

        const insertData: Record<string, any> = {
          txn_id: record.txn_id,
          status: isSuccessStatus(record.status) ? 'AUTHORIZED' : (record.status || 'AUTHORIZED'),
          display_status: isSuccessStatus(record.status) ? 'SUCCESS' : 'PENDING',
          amount: record.amount,
          payment_mode: (record.mode || 'CARD').toUpperCase(),
          device_serial: record.device_serial || null,
          tid: record.tid || null,
          merchant_name: record.company || null,
          merchant_slug: merchantSlug,
          transaction_time: txnTime,
          customer_name: record.consumer || record.payer || null,
          payer_name: record.payer || record.consumer || null,
          username: record.username || null,
          txn_type: 'CHARGE',
          auth_code: record.auth_code || null,
          card_number: record.card_number || null,
          issuing_bank: (record.issuing_bank && record.issuing_bank !== 'NULL') ? record.issuing_bank : null,
          card_classification: (record.card_classification && record.card_classification !== 'NULL') ? record.card_classification : null,
          mid_code: record.mid || null,
          card_brand: record.card_brand || null,
          card_type: record.card_type || null,
          currency: 'INR',
          rrn: record.rrn || null,
          external_ref: record.ref || null,
          settlement_status: isSuccessStatus(record.status) ? 'SETTLED' : 'PENDING',
          receipt_url: record.receipt_url || null,
          card_txn_type: (record.card_txn_type && record.card_txn_type !== 'NULL') ? record.card_txn_type : null,
          acquiring_bank: (record.acquiring_bank && record.acquiring_bank !== 'NULL') ? record.acquiring_bank : null,
          raw_data: { _source: 'admin_report_upload', txn_id: record.txn_id },
        }

        const { error } = await supabase
          .from('razorpay_pos_transactions')
          .insert(insertData)

        if (error) {
          errors.push(`${record.txn_id}: insert failed - ${error.message}`)
        } else {
          inserted++
        }
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        total_in_report: records.length,
        updated,
        inserted,
        skipped,
        errors: errors.length,
      },
      ...(errors.length > 0 && { error_details: errors.slice(0, 30) }),
    })
  } catch (error: any) {
    console.error('Error in enrich endpoint:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

function isSuccessStatus(status?: string | null): boolean {
  if (!status) return false
  const s = status.toUpperCase().trim()
  return ['SETTLED', 'SETTLEMENT_POSTED', 'AUTHORIZED', 'CAPTURED', 'SUCCESS'].includes(s)
}

function parseReportDate(dateStr?: string | null): string {
  if (!dateStr) return new Date().toISOString()
  const trimmed = dateStr.trim()
  if (trimmed.includes('T')) return trimmed

  // Format: "2026-5-9 12:22" → ISO with IST offset
  const parts = trimmed.split(' ')
  const dateParts = parts[0].split('-')
  if (dateParts.length !== 3) return new Date().toISOString()

  const year = dateParts[0]
  const month = dateParts[1].padStart(2, '0')
  const day = dateParts[2].padStart(2, '0')
  const time = parts[1] ? `${parts[1]}:00` : '00:00:00'
  return `${year}-${month}-${day}T${time}+05:30`
}

function detectMerchantSlug(company?: string | null): string {
  if (!company) return 'ashvam'
  const lower = company.toLowerCase().trim()
  if (lower.includes('teachway')) return 'teachway'
  if (lower.includes('scenaric') || lower.includes('sceneric')) return 'newscenaric'
  if (lower.includes('lagoon')) return 'lagoon'
  if (lower.includes('ashvam')) return 'ashvam'
  return 'ashvam'
}

/**
 * Parse Razorpay/Ezetap POS report (tab-separated format).
 * Handles both New Scenaric and Teachway report formats with varying columns.
 */
function parseTabSeparatedReport(text: string): ParsedRecord[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []

  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase())

  const findCol = (names: string[]) => {
    for (const name of names) {
      const idx = headers.findIndex(h => h === name)
      if (idx !== -1) return idx
    }
    return -1
  }

  const colIdx = {
    id: findCol(['id']),
    date: findCol(['date']),
    consumer: findCol(['consumer']),
    username: findCol(['username']),
    mode: findCol(['mode']),
    amount: findCol(['amount']),
    authCode: findCol(['auth code']),
    card: findCol(['card']),
    issuingBank: findCol(['issuing bank']),
    cardType: findCol(['card type']),
    brandType: findCol(['brand type']),
    cardClassification: findCol(['card classification']),
    cardTxnType: findCol(['card txn type']),
    rrn: findCol(['rrn']),
    deviceSerial: findCol(['device serial']),
    status: findCol(['status']),
    mid: findCol(['mid']),
    tid: findCol(['tid']),
    ref: findCol(['ref#']),
    acquiringBank: findCol(['acquiring bank']),
    receiptUrl: findCol(['receipt url']),
    company: findCol(['company']),
    payer: findCol(['payer']),
  }

  if (colIdx.id === -1) return []

  const getVal = (cols: string[], idx: number): string | null => {
    if (idx === -1) return null
    const v = (cols[idx] || '').trim().replace(/^'/, '')
    return v || null
  }

  const records: ParsedRecord[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t')
    const txnId = getVal(cols, colIdx.id)
    if (!txnId) continue

    const amountStr = getVal(cols, colIdx.amount)
    const amount = amountStr ? parseFloat(amountStr) : null

    // Clean TID: remove leading zeros (e.g., '0096202861' → '96202861')
    let tid = getVal(cols, colIdx.tid)
    if (tid) tid = tid.replace(/^0+/, '')

    records.push({
      txn_id: txnId,
      date: getVal(cols, colIdx.date),
      consumer: getVal(cols, colIdx.consumer),
      username: getVal(cols, colIdx.username),
      mode: getVal(cols, colIdx.mode),
      amount,
      auth_code: getVal(cols, colIdx.authCode),
      card_number: getVal(cols, colIdx.card),
      issuing_bank: getVal(cols, colIdx.issuingBank),
      card_type: getVal(cols, colIdx.cardType),
      card_brand: getVal(cols, colIdx.brandType),
      card_classification: getVal(cols, colIdx.cardClassification),
      card_txn_type: getVal(cols, colIdx.cardTxnType),
      rrn: getVal(cols, colIdx.rrn),
      device_serial: getVal(cols, colIdx.deviceSerial),
      status: getVal(cols, colIdx.status),
      mid: getVal(cols, colIdx.mid),
      tid,
      ref: getVal(cols, colIdx.ref),
      acquiring_bank: getVal(cols, colIdx.acquiringBank),
      receipt_url: getVal(cols, colIdx.receiptUrl),
      company: getVal(cols, colIdx.company),
      payer: getVal(cols, colIdx.payer),
    })
  }

  return records
}
