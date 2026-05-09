import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import { buildRentalData } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { user: admin } = await getCurrentUserWithFallback(request)

    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const period = sp.get('period') || 'current_month'

    const allData = await buildRentalData(supabase, period, {
      dateFrom: sp.get('dateFrom'),
      dateTo: sp.get('dateTo'),
      company: period === 'all_history' ? sp.get('company') : null,
      partnerType: period === 'all_history' ? sp.get('partnerType') : null,
      status: period === 'all_history' ? sp.get('status') : null,
      search: sp.get('search')
    })

    // Get period label for title
    const today = new Date()
    const currentYear = today.getFullYear()
    const currentMonth = today.getMonth()
    let periodLabel = ''
    if (period === 'current_month') {
      periodLabel = today.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    } else if (period === 'last_month') {
      const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1
      const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear
      periodLabel = new Date(lastMonthYear, lastMonth, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    } else {
      const dateFrom = sp.get('dateFrom') || '01 Jan 2024'
      const dateTo = sp.get('dateTo') || today.toLocaleDateString('en-IN')
      periodLabel = `${dateFrom} to ${dateTo}`
    }

    // Build Excel workbook
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Same Day Solution Pvt. Ltd.'
    workbook.created = new Date()

    // ── SUMMARY SHEET ──
    const summarySheet = workbook.addWorksheet('Summary')
    summarySheet.columns = [
      { width: 35 },
      { width: 20 },
    ]

    const totalPOS = allData.reduce((s, r) => s + r.pos_count, 0)
    const totalDays = allData.reduce((s, r) => s + r.total_rental_days, 0)
    const totalRevenue = allData.reduce((s, r) => s + r.total_prorata_amount, 0)
    const activeCount = allData.filter(r => r.status === 'active').reduce((s, r) => s + r.pos_count, 0)
    const returnedCount = allData.filter(r => r.status !== 'active').reduce((s, r) => s + r.pos_count, 0)

    const addSummaryRow = (label: string, value: string | number, bold = false) => {
      const row = summarySheet.addRow([label, value])
      row.getCell(1).font = { bold }
      row.getCell(2).font = { bold }
    }

    summarySheet.addRow(['POS RENTAL REPORT — PRORATA BASIS']).font = { bold: true, size: 14 }
    summarySheet.addRow(['Same Day Solution Pvt. Ltd.']).font = { italic: true }
    summarySheet.addRow(['Period:', periodLabel])
    summarySheet.addRow(['Generated on:', today.toLocaleString('en-IN')])
    summarySheet.addRow([])
    addSummaryRow('Total Partners', allData.length, true)
    addSummaryRow('Total POS Machines', totalPOS, true)
    addSummaryRow('Active POS', activeCount)
    addSummaryRow('Returned POS', returnedCount)
    addSummaryRow('Total Rental Days', totalDays)
    addSummaryRow('Total Revenue (₹)', `₹${totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, true)
    if (allData.length > 0) {
      addSummaryRow('Avg Days per POS', (totalDays / totalPOS).toFixed(1))
      addSummaryRow('Avg Revenue per Partner', `₹${(totalRevenue / allData.length).toFixed(2)}`)
    }

    // ── PARTNER-WISE REPORT SHEET ──
    const reportSheet = workbook.addWorksheet('Rental Report')

    const headerStyle: Partial<ExcelJS.Style> = {
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } },
      font: { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      border: {
        top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
      }
    }

    reportSheet.columns = [
      { header: 'Sr.', key: 'sr', width: 5 },
      { header: 'Company Name', key: 'company', width: 32 },
      { header: 'Partner / Retailer Name', key: 'partner', width: 32 },
      { header: 'Type', key: 'type', width: 16 },
      { header: 'No. of POS', key: 'pos_count', width: 10 },
      { header: 'TID(s)', key: 'tids', width: 38 },
      { header: 'Rate / Month (₹)', key: 'rate', width: 16 },
      { header: 'First Assigned', key: 'assigned', width: 16 },
      { header: 'Last Return', key: 'returned', width: 16 },
      { header: 'Total Days', key: 'days', width: 11 },
      { header: 'Prorata Amount (₹)', key: 'prorata', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
    ]

    // Style header row
    const headerRow = reportSheet.getRow(1)
    headerRow.height = 36
    headerRow.eachCell((cell) => {
      Object.assign(cell, headerStyle)
    })

    // Data rows
    allData.forEach((row, idx) => {
      const isEven = idx % 2 === 0
      const bgColor = isEven ? 'FFFAFAFA' : 'FFFFFFFF'

      const dataRow = reportSheet.addRow({
        sr: idx + 1,
        company: row.company_name,
        partner: row.partner_name,
        type: row.partner_type,
        pos_count: row.pos_count,
        tids: row.pos_tids.join(', '),
        rate: row.monthly_rate,
        assigned: formatDate(row.earliest_assigned_date),
        returned: formatDate(row.latest_return_date),
        days: row.period_days,
        prorata: row.total_prorata_amount,
        status: row.status === 'active' ? 'Active' : 'Returned',
      })

      dataRow.height = 20
      dataRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
        cell.border = {
          top: { style: 'hair', color: { argb: 'FFDDDDDD' } },
          left: { style: 'hair', color: { argb: 'FFDDDDDD' } },
          bottom: { style: 'hair', color: { argb: 'FFDDDDDD' } },
          right: { style: 'hair', color: { argb: 'FFDDDDDD' } }
        }
        cell.alignment = { vertical: 'middle', wrapText: false }
      })

      // Right-align numeric columns
      dataRow.getCell('rate').alignment = { horizontal: 'right', vertical: 'middle' }
      dataRow.getCell('days').alignment = { horizontal: 'center', vertical: 'middle' }
      dataRow.getCell('pos_count').alignment = { horizontal: 'center', vertical: 'middle' }
      dataRow.getCell('prorata').alignment = { horizontal: 'right', vertical: 'middle' }
      dataRow.getCell('prorata').font = { bold: true }

      // Format rupee columns
      dataRow.getCell('rate').numFmt = '₹#,##0.00'
      dataRow.getCell('prorata').numFmt = '₹#,##0.00'

      // Color status cell
      const statusCell = dataRow.getCell('status')
      statusCell.alignment = { horizontal: 'center', vertical: 'middle' }
      if (row.status === 'active') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }
        statusCell.font = { color: { argb: 'FF2E7D32' }, bold: true }
      } else {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } }
        statusCell.font = { color: { argb: 'FF757575' } }
      }
    })

    // Totals row
    const totalRow = reportSheet.addRow({
      sr: '',
      company: 'TOTAL',
      partner: '',
      type: '',
      pos_count: totalPOS,
      tids: '',
      rate: '',
      assigned: '',
      returned: '',
      days: allData.reduce((s, r) => s + r.period_days, 0),
      prorata: Math.round(totalRevenue * 100) / 100,
      status: ''
    })
    totalRow.height = 24
    totalRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true }
      cell.alignment = { vertical: 'middle' }
    })
    totalRow.getCell('prorata').numFmt = '₹#,##0.00'
    totalRow.getCell('prorata').alignment = { horizontal: 'right', vertical: 'middle' }
    totalRow.getCell('days').alignment = { horizontal: 'center', vertical: 'middle' }
    totalRow.getCell('pos_count').alignment = { horizontal: 'center', vertical: 'middle' }

    // Freeze header row
    reportSheet.views = [{ state: 'frozen', ySplit: 1 }]

    // ── MACHINE-WISE DETAIL SHEET ──
    const detailSheet = workbook.addWorksheet('Machine-wise Detail')
    detailSheet.columns = [
      { header: 'Sr.', key: 'sr', width: 5 },
      { header: 'Company Name', key: 'company', width: 32 },
      { header: 'Partner Name', key: 'partner', width: 32 },
      { header: 'Type', key: 'type', width: 16 },
      { header: 'TID', key: 'tid', width: 14 },
      { header: 'Serial No.', key: 'serial', width: 18 },
      { header: 'Rate / Month (₹)', key: 'rate', width: 16 },
      { header: 'Assigned Date', key: 'assigned', width: 16 },
      { header: 'Return Date', key: 'returned', width: 16 },
      { header: 'Rental Days', key: 'days', width: 12 },
      { header: 'Prorata Amount (₹)', key: 'prorata', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
    ]

    const dHeaderRow = detailSheet.getRow(1)
    dHeaderRow.height = 36
    dHeaderRow.eachCell((cell) => { Object.assign(cell, headerStyle) })

    let detailSr = 1
    allData.forEach((partner) => {
      partner.machines.forEach((m, mi) => {
        const isEven = detailSr % 2 === 0
        const row = detailSheet.addRow({
          sr: detailSr++,
          company: partner.company_name,
          partner: partner.partner_name,
          type: partner.partner_type,
          tid: m.tid,
          serial: m.serial_number,
          rate: partner.monthly_rate,
          assigned: formatDate(m.assigned_date),
          returned: formatDate(m.return_date),
          days: m.rental_days,
          prorata: m.prorata_amount,
          status: m.machine_status === 'active' ? 'Active' : 'Returned'
        })
        row.height = 20
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFFAFAFA' : 'FFFFFFFF' } }
          cell.border = {
            top: { style: 'hair', color: { argb: 'FFDDDDDD' } },
            left: { style: 'hair', color: { argb: 'FFDDDDDD' } },
            bottom: { style: 'hair', color: { argb: 'FFDDDDDD' } },
            right: { style: 'hair', color: { argb: 'FFDDDDDD' } }
          }
          cell.alignment = { vertical: 'middle' }
        })
        row.getCell('rate').numFmt = '₹#,##0.00'
        row.getCell('prorata').numFmt = '₹#,##0.00'
        row.getCell('prorata').font = { bold: true }
        row.getCell('prorata').alignment = { horizontal: 'right', vertical: 'middle' }
        row.getCell('days').alignment = { horizontal: 'center', vertical: 'middle' }
      })
    })

    detailSheet.views = [{ state: 'frozen', ySplit: 1 }]

    // Generate Excel buffer
    const buffer = await workbook.xlsx.writeBuffer()

    const today2 = new Date()
    const dateStr = today2.toISOString().split('T')[0]
    const fileName = `POS_Rental_Report_${period}_${dateStr}.xlsx`

    return new NextResponse(buffer as Buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-cache'
      }
    })
  } catch (error: any) {
    console.error('Error in export API:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
