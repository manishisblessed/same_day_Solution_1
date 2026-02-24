import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/razorpay-transactions/enrich
 * 
 * Admin-only endpoint to enrich POS transactions with data from Razorpay's
 * downloadable report. These fields are NOT available via webhook:
 *   - card_classification (STANDARD, PLATINUM, CLASSIC, PREPAID, ANY)
 *   - card_txn_type / entry mode (EMV with PIN, Contactless, Swipe)
 *   - issuing_bank (HDFC, AMEX, ICICI, etc.)
 *   - acquiring_bank (HDFC, AMEX, etc.)
 * 
 * Accepts: Tab-separated text (Razorpay report format) or JSON array.
 * Matches by txn_id (the "ID" column in Razorpay report).
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
    let records: Array<{
      txn_id: string
      card_classification?: string | null
      card_txn_type?: string | null
      issuing_bank?: string | null
      acquiring_bank?: string | null
      card_number?: string | null
    }> = []

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
    let skipped = 0
    let notFound = 0
    const errors: string[] = []

    for (const record of records) {
      if (!record.txn_id) {
        skipped++
        continue
      }

      const updateData: Record<string, string> = {}
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

      if (Object.keys(updateData).length === 0) {
        skipped++
        continue
      }

      const { data, error } = await supabase
        .from('razorpay_pos_transactions')
        .update(updateData)
        .eq('txn_id', record.txn_id)
        .select('id')

      if (error) {
        errors.push(`${record.txn_id}: ${error.message}`)
      } else if (!data || data.length === 0) {
        notFound++
      } else {
        updated++
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        total_in_report: records.length,
        updated,
        skipped,
        not_found: notFound,
        errors: errors.length,
      },
      ...(errors.length > 0 && { error_details: errors.slice(0, 20) }),
    })
  } catch (error: any) {
    console.error('Error in enrich endpoint:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Parse Razorpay POS report (tab-separated format).
 * Header row: ID  Date  Consumer  Username  Type  Mode  Amount  Txn Type  Auth Code  Card  Issuing Bank  Card Type  Brand Type  Card Classification  Card Txn Type  RRN  Device Serial  MID  TID  Ref#  Acquiring Bank  Receipt URL
 */
function parseTabSeparatedReport(text: string): Array<{
  txn_id: string
  card_classification?: string | null
  card_txn_type?: string | null
  issuing_bank?: string | null
  acquiring_bank?: string | null
  card_number?: string | null
}> {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []

  const headerLine = lines[0]
  const headers = headerLine.split('\t').map(h => h.trim().toLowerCase())

  const colIdx = {
    id: headers.findIndex(h => h === 'id'),
    card: headers.findIndex(h => h === 'card'),
    issuingBank: headers.findIndex(h => h === 'issuing bank'),
    cardClassification: headers.findIndex(h => h === 'card classification'),
    cardTxnType: headers.findIndex(h => h === 'card txn type'),
    acquiringBank: headers.findIndex(h => h === 'acquiring bank'),
  }

  if (colIdx.id === -1) return []

  const records = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t')
    const txnId = cols[colIdx.id]?.trim().replace(/^'/, '')
    if (!txnId) continue

    records.push({
      txn_id: txnId,
      card_number: colIdx.card !== -1 ? (cols[colIdx.card]?.trim() || null) : null,
      issuing_bank: colIdx.issuingBank !== -1 ? (cols[colIdx.issuingBank]?.trim() || null) : null,
      card_classification: colIdx.cardClassification !== -1 ? (cols[colIdx.cardClassification]?.trim() || null) : null,
      card_txn_type: colIdx.cardTxnType !== -1 ? (cols[colIdx.cardTxnType]?.trim() || null) : null,
      acquiring_bank: colIdx.acquiringBank !== -1 ? (cols[colIdx.acquiringBank]?.trim() || null) : null,
    })
  }

  return records
}
