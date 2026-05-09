import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/pos-machines/stats
 * Returns aggregate POS inventory stats for the admin dashboard:
 *   - Total POS devices
 *   - Assigned POS (broken down by level)
 *   - In Stock POS
 *   - Returned History count
 *   - Active assignments count
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { user } = await getCurrentUserWithFallback(request)

    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized. Admin only.' }, { status: 403 })
    }

    // Try RPC first
    try {
      const { data: rpcStats, error: rpcError } = await supabase.rpc('get_pos_stats')
      if (!rpcError && rpcStats) {
        return NextResponse.json({ success: true, stats: rpcStats })
      }
    } catch {
      // RPC not available, fall through to manual queries
    }

    // Manual fallback
    const [totalResult, statusBreakdown, returnedMachines, activeAssignments] = await Promise.all([
      supabase.from('pos_machines').select('id', { count: 'exact', head: true }),
      supabase.from('pos_machines').select('inventory_status'),
      supabase
        .from('pos_assignment_history')
        .select('pos_machine_id')
        .eq('status', 'returned')
        .like('action', 'assigned_to_%'),
      supabase
        .from('pos_assignment_history')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .like('action', 'assigned_to_%'),
    ])

    const total = totalResult.count || 0
    const uniqueReturnedMachines = new Set((returnedMachines.data || []).map((r: any) => r.pos_machine_id))
    const returnedCount = uniqueReturnedMachines.size
    const activeCount = activeAssignments.count || 0

    // Aggregate inventory_status counts
    const byStatus: Record<string, number> = {}
    let inStock = 0
    let assigned = 0
    for (const row of (statusBreakdown.data || [])) {
      const s = row.inventory_status || 'unknown'
      byStatus[s] = (byStatus[s] || 0) + 1
      if (s === 'in_stock' || s === 'received_from_bank') {
        inStock++
      } else if (s.startsWith('assigned_to_')) {
        assigned++
      }
    }

    return NextResponse.json({
      success: true,
      stats: {
        total,
        in_stock: inStock,
        assigned,
        returned_history: returnedCount,
        active_assignments: activeCount,
        by_status: byStatus,
      },
    })
  } catch (err: any) {
    console.error('[POS Stats] Error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
