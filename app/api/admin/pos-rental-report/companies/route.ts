import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    // Get all unique company names from assignments
    const { data: assignments } = await supabase
      .from('pos_assignment_history')
      .select('pos_machine_id')

    const companies = new Set<string>()

    if (assignments) {
      for (const assignment of assignments) {
        const { data: pos } = await supabase
          .from('pos_machines')
          .select('retailer_id, distributor_id, master_distributor_id, partner_id')
          .eq('id', assignment.pos_machine_id)
          .maybeSingle()

        if (!pos) continue

        if (pos.retailer_id) {
          const { data: retailer } = await supabase
            .from('retailers')
            .select('business_name, name')
            .eq('partner_id', pos.retailer_id)
            .maybeSingle()
          if (retailer) companies.add(retailer.business_name || retailer.name)
        }
        if (pos.distributor_id) {
          const { data: dist } = await supabase
            .from('distributors')
            .select('business_name, name')
            .eq('partner_id', pos.distributor_id)
            .maybeSingle()
          if (dist) companies.add(dist.business_name || dist.name)
        }
        if (pos.master_distributor_id) {
          const { data: md } = await supabase
            .from('master_distributors')
            .select('business_name, name')
            .eq('partner_id', pos.master_distributor_id)
            .maybeSingle()
          if (md) companies.add(md.business_name || md.name)
        }
        if (pos.partner_id) {
          const { data: partner } = await supabase
            .from('partners')
            .select('business_name, name')
            .eq('id', pos.partner_id)
            .maybeSingle()
          if (partner) companies.add(partner.business_name || partner.name)
        }
      }
    }

    return NextResponse.json({
      companies: Array.from(companies).sort()
    })
  } catch (error: any) {
    console.error('Error fetching companies:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
