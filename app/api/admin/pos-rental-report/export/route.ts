import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Simple XLSX generation helper
function generateXLSX(data: any[], filename: string) {
  const headers = Object.keys(data[0] || {})
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => {
        const value = row[header]
        if (value === null || value === undefined) return ''
        if (Array.isArray(value)) return `"${value.join(', ')}"`
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`
        }
        return String(value)
      }).join(',')
    )
  ].join('\n')

  return Buffer.from(csvContent, 'utf-8')
}

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user: admin } = await getCurrentUserWithFallback(request)

    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const period = searchParams.get('period') || 'current_month'
    const company = searchParams.get('company')
    const partnerType = searchParams.get('partnerType')
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    // Determine date range
    const today = new Date()
    const currentYear = today.getFullYear()
    const currentMonth = today.getMonth()

    let startDate: string
    let endDate: string

    if (period === 'current_month') {
      startDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`
      endDate = today.toISOString().split('T')[0]
    } else if (period === 'last_month') {
      const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1
      const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear
      startDate = `${lastMonthYear}-${String(lastMonth + 1).padStart(2, '0')}-01`
      const lastDay = new Date(lastMonthYear, lastMonth + 1, 0)
      endDate = lastDay.toISOString().split('T')[0]
    } else {
      startDate = searchParams.get('dateFrom') || '2024-01-01'
      endDate = searchParams.get('dateTo') || today.toISOString().split('T')[0]
    }

    // Fetch all assignments in date range
    const { data: assignments, error } = await supabase
      .from('pos_assignment_history')
      .select('*')
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)
      .order('created_at', { ascending: false })

    if (error) throw error

    const enrichedData = []

    if (assignments) {
      for (const assignment of assignments) {
        const { data: pos } = await supabase
          .from('pos_machines')
          .select('*')
          .eq('id', assignment.pos_machine_id)
          .single()

        if (!pos) continue

        let companyName = ''
        let partnerName = ''
        let pType = ''

        if (pos.retailer_id) {
          const { data: retailer } = await supabase
            .from('retailers')
            .select('name, business_name')
            .eq('partner_id', pos.retailer_id)
            .single()
          partnerName = retailer?.name || pos.retailer_id
          companyName = retailer?.business_name || retailer?.name || 'Unknown'
          pType = 'Retailer'
        } else if (pos.distributor_id) {
          const { data: dist } = await supabase
            .from('distributors')
            .select('name, business_name')
            .eq('partner_id', pos.distributor_id)
            .single()
          partnerName = dist?.name || pos.distributor_id
          companyName = dist?.business_name || dist?.name || 'Unknown'
          pType = 'Distributor'
        } else if (pos.master_distributor_id) {
          const { data: md } = await supabase
            .from('master_distributors')
            .select('name, business_name')
            .eq('partner_id', pos.master_distributor_id)
            .single()
          partnerName = md?.name || pos.master_distributor_id
          companyName = md?.business_name || md?.name || 'Unknown'
          pType = 'Master Distributor'
        } else if (pos.partner_id) {
          const { data: partner } = await supabase
            .from('partners')
            .select('name, business_name')
            .eq('id', pos.partner_id)
            .single()
          partnerName = partner?.name || pos.partner_id
          companyName = partner?.business_name || partner?.name || 'Unknown'
          pType = 'Partner'
        }

        // Apply filters
        if (company && companyName !== company) continue
        if (partnerType && pType !== partnerType) continue
        if (status && assignment.status !== status) continue
        if (search) {
          const searchLower = search.toLowerCase()
          if (!companyName.toLowerCase().includes(searchLower) &&
              !partnerName.toLowerCase().includes(searchLower) &&
              !(pos.tid && pos.tid.includes(search)) &&
              !(pos.serial_number && pos.serial_number.includes(search))) {
            continue
          }
        }

        // Get subscription rate
        let monthlyRate = 500
        if (pos.retailer_id) {
          const { data: sub } = await supabase
            .from('subscriptions')
            .select('id')
            .eq('user_id', pos.retailer_id)
            .eq('user_role', 'retailer')
            .maybeSingle()

          if (sub) {
            const { data: item } = await supabase
              .from('subscription_items')
              .select('retailer_rate')
              .eq('subscription_id', sub.id)
              .eq('is_active', true)
              .maybeSingle()

            if (item) monthlyRate = item.retailer_rate || 500
          }
        }

        const rentalDays =
          assignment.returned_date
            ? Math.floor((new Date(assignment.returned_date).getTime() - new Date(assignment.created_at).getTime()) / (1000 * 60 * 60 * 24))
            : Math.floor((new Date().getTime() - new Date(assignment.created_at).getTime()) / (1000 * 60 * 60 * 24))

        const prorataAmount = (monthlyRate / 30) * rentalDays

        enrichedData.push({
          Month: new Date(assignment.created_at).toISOString().split('T')[0].substring(0, 7),
          Company: companyName,
          Partner: partnerName,
          'Partner Type': pType,
          'POS Count': 1,
          'TIDs': pos.tid || '',
          'Monthly Rate (₹)': monthlyRate,
          'Assigned Date': new Date(assignment.created_at).toLocaleDateString('en-IN'),
          'Return Date': assignment.returned_date ? new Date(assignment.returned_date).toLocaleDateString('en-IN') : '-',
          'Rental Days': rentalDays,
          'Prorata Amount (₹)': Math.round(prorataAmount * 100) / 100,
          'Status': assignment.status === 'active' ? 'Active' : 'Returned'
        })
      }
    }

    const csvContent = generateXLSX(enrichedData, `POS_Rental_Report_${period}`)

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="POS_Rental_Report_${period}_${new Date().toISOString().split('T')[0]}.csv"`
      }
    })
  } catch (error: any) {
    console.error('Error in export API:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
