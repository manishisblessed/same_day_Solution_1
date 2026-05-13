import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function batchFetchIn<T>(
  supabase: any,
  table: string,
  column: string,
  ids: string[],
  selectCols: string
): Promise<T[]> {
  if (ids.length === 0) return []
  const CHUNK = 500
  const results: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data } = await supabase.from(table).select(selectCols).in(column, chunk)
    if (data) results.push(...data)
  }
  return results
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

    const { data: assignments } = await supabase
      .from('pos_assignment_history')
      .select('pos_machine_id')

    if (!assignments || assignments.length === 0) {
      return NextResponse.json({ companies: [] })
    }

    const machineIds = [...new Set(assignments.map((a: any) => a.pos_machine_id))] as string[]

    const machines: any[] = await batchFetchIn(
      supabase,
      'pos_machines',
      'id',
      machineIds,
      'id, distributor_id, master_distributor_id, partner_id'
    )

    const distributorIds = new Set<string>()
    const mdIds = new Set<string>()
    const partnerIds = new Set<string>()

    for (const pos of machines) {
      if (pos.distributor_id) distributorIds.add(pos.distributor_id)
      if (pos.master_distributor_id) mdIds.add(pos.master_distributor_id)
      if (pos.partner_id) partnerIds.add(pos.partner_id)
    }

    const [distributors, masterDists, partners] = await Promise.all([
      batchFetchIn<any>(supabase, 'distributors', 'partner_id', [...distributorIds], 'partner_id, business_name, name'),
      batchFetchIn<any>(supabase, 'master_distributors', 'partner_id', [...mdIds], 'partner_id, business_name, name'),
      batchFetchIn<any>(supabase, 'partners', 'id', [...partnerIds], 'id, business_name, name'),
    ])

    const companies = new Set<string>()
    for (const d of distributors) {
      if (d.business_name || d.name) companies.add(d.business_name || d.name)
    }
    for (const md of masterDists) {
      if (md.business_name || md.name) companies.add(md.business_name || md.name)
    }
    for (const p of partners) {
      if (p.business_name || p.name) companies.add(p.business_name || p.name)
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
