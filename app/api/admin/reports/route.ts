import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserServer } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Get current admin user
    const admin = await getCurrentUserServer()
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 401 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const reportType = searchParams.get('type') || 'transactions' // transactions, ledger, commission, audit
    const format = searchParams.get('format') || 'json' // json, csv, pdf
    const startDate = searchParams.get('start') || searchParams.get('date_from')
    const endDate = searchParams.get('end') || searchParams.get('date_to')
    const user_id = searchParams.get('user_id')
    const user_role = searchParams.get('user_role')
    const limit = parseInt(searchParams.get('limit') || '10000')

    // Build query based on report type
    let query: any = null
    let tableName = ''

    if (reportType === 'transactions') {
      // Get all transaction types
      const transactions = []
      
      // BBPS transactions
      let bbpsQuery = supabase
        .from('bbps_transactions')
        .select('*, retailer_id as user_id')
        .order('created_at', { ascending: false })
      
      if (startDate) bbpsQuery = bbpsQuery.gte('created_at', startDate)
      if (endDate) bbpsQuery = bbpsQuery.lte('created_at', endDate)
      if (user_id) bbpsQuery = bbpsQuery.eq('retailer_id', user_id)
      
      const { data: bbps } = await bbpsQuery.limit(limit)
      if (bbps && Array.isArray(bbps)) {
        transactions.push(...bbps.map((tx: any) => ({
          ...tx,
          transaction_type: 'bbps',
          user_role: 'retailer'
        })))
      }

      // AEPS transactions
      let aepsQuery = supabase
        .from('aeps_transactions')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (startDate) aepsQuery = aepsQuery.gte('created_at', startDate)
      if (endDate) aepsQuery = aepsQuery.lte('created_at', endDate)
      if (user_id) aepsQuery = aepsQuery.eq('user_id', user_id)
      if (user_role) aepsQuery = aepsQuery.eq('user_role', user_role)
      
      const { data: aeps } = await aepsQuery.limit(limit)
      if (aeps && Array.isArray(aeps)) {
        transactions.push(...aeps.map((tx: any) => ({
          ...tx,
          transaction_type: 'aeps'
        })))
      }

      // Settlement transactions
      let settlementQuery = supabase
        .from('settlements')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (startDate) settlementQuery = settlementQuery.gte('created_at', startDate)
      if (endDate) settlementQuery = settlementQuery.lte('created_at', endDate)
      if (user_id) settlementQuery = settlementQuery.eq('user_id', user_id)
      if (user_role) settlementQuery = settlementQuery.eq('user_role', user_role)
      
      const { data: settlements } = await settlementQuery.limit(limit)
      if (settlements && Array.isArray(settlements)) {
        transactions.push(...settlements.map((tx: any) => ({
          ...tx,
          transaction_type: 'settlement'
        })))
      }

      // Sort by created_at descending
      transactions.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )

      if (format === 'json') {
        return NextResponse.json({
          success: true,
          report_type: reportType,
          total_records: transactions.length,
          data: transactions.slice(0, limit)
        })
      } else if (format === 'csv') {
        // Convert to CSV
        const headers = Object.keys(transactions[0] || {})
        const csvRows = [
          headers.join(','),
          ...transactions.slice(0, limit).map(row =>
            headers.map(header => {
              const value = row[header as keyof typeof row]
              return typeof value === 'string' && value.includes(',') 
                ? `"${value}"` 
                : value
            }).join(',')
          )
        ]
        
        return new NextResponse(csvRows.join('\n'), {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="transactions_${Date.now()}.csv"`
          }
        })
      }
    } else if (reportType === 'ledger') {
      let ledgerQuery = supabase
        .from('wallet_ledger')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (startDate) ledgerQuery = ledgerQuery.gte('created_at', startDate)
      if (endDate) ledgerQuery = ledgerQuery.lte('created_at', endDate)
      if (user_id) ledgerQuery = ledgerQuery.eq('user_id', user_id)
      if (user_role) ledgerQuery = ledgerQuery.eq('user_role', user_role)
      
      const { data: ledger, error } = await ledgerQuery.limit(limit)
      
      if (error) {
        return NextResponse.json(
          { error: 'Failed to fetch ledger data' },
          { status: 500 }
        )
      }

      if (format === 'json') {
        return NextResponse.json({
          success: true,
          report_type: reportType,
          total_records: ledger?.length || 0,
          data: ledger || []
        })
      } else if (format === 'csv') {
        const headers = Object.keys(ledger?.[0] || {})
        const csvRows = [
          headers.join(','),
          ...(ledger || []).slice(0, limit).map(row =>
            headers.map(header => {
              const value = row[header as keyof typeof row]
              return typeof value === 'string' && value.includes(',') 
                ? `"${value}"` 
                : value
            }).join(',')
          )
        ]
        
        return new NextResponse(csvRows.join('\n'), {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="ledger_${Date.now()}.csv"`
          }
        })
      }
    } else if (reportType === 'commission') {
      let commissionQuery = supabase
        .from('commission_ledger')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (startDate) commissionQuery = commissionQuery.gte('created_at', startDate)
      if (endDate) commissionQuery = commissionQuery.lte('created_at', endDate)
      if (user_id) commissionQuery = commissionQuery.eq('user_id', user_id)
      if (user_role) commissionQuery = commissionQuery.eq('user_role', user_role)
      
      const { data: commission, error } = await commissionQuery.limit(limit)
      
      if (error) {
        return NextResponse.json(
          { error: 'Failed to fetch commission data' },
          { status: 500 }
        )
      }

      if (format === 'json') {
        return NextResponse.json({
          success: true,
          report_type: reportType,
          total_records: commission?.length || 0,
          data: commission || []
        })
      } else if (format === 'csv') {
        const headers = Object.keys(commission?.[0] || {})
        const csvRows = [
          headers.join(','),
          ...(commission || []).slice(0, limit).map(row =>
            headers.map(header => {
              const value = row[header as keyof typeof row]
              return typeof value === 'string' && value.includes(',') 
                ? `"${value}"` 
                : value
            }).join(',')
          )
        ]
        
        return new NextResponse(csvRows.join('\n'), {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="commission_${Date.now()}.csv"`
          }
        })
      }
    } else if (reportType === 'audit') {
      let auditQuery = supabase
        .from('admin_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (startDate) auditQuery = auditQuery.gte('created_at', startDate)
      if (endDate) auditQuery = auditQuery.lte('created_at', endDate)
      if (user_id) auditQuery = auditQuery.eq('target_user_id', user_id)
      
      const { data: audit, error } = await auditQuery.limit(limit)
      
      if (error) {
        return NextResponse.json(
          { error: 'Failed to fetch audit data' },
          { status: 500 }
        )
      }

      if (format === 'json') {
        return NextResponse.json({
          success: true,
          report_type: reportType,
          total_records: audit?.length || 0,
          data: audit || []
        })
      } else if (format === 'csv') {
        const headers = Object.keys(audit?.[0] || {})
        const csvRows = [
          headers.join(','),
          ...(audit || []).slice(0, limit).map(row =>
            headers.map(header => {
              const value = row[header as keyof typeof row]
              return typeof value === 'string' && value.includes(',') 
                ? `"${value}"` 
                : value
            }).join(',')
          )
        ]
        
        return new NextResponse(csvRows.join('\n'), {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="audit_${Date.now()}.csv"`
          }
        })
      }
    }

    return NextResponse.json(
      { error: 'Invalid report type or format' },
      { status: 400 }
    )
  } catch (error: any) {
    console.error('Error generating report:', error)
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    )
  }
}

