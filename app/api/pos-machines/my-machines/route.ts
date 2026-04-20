import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Explicit column list — never use select('*') on pos_machines because
// PostgREST silently drops rows when select('*') is combined with .eq() filters.
const POS_COLUMNS = [
  'id', 'machine_id', 'serial_number',
  'retailer_id', 'distributor_id', 'master_distributor_id', 'partner_id',
  'machine_type', 'status', 'inventory_status',
  'mid', 'tid', 'brand',
  'assigned_by', 'assigned_by_role', 'last_assigned_at',
  'delivery_date', 'installation_date',
  'location', 'city', 'state', 'pincode',
  'notes', 'created_at', 'updated_at'
].join(',')

// Columns for partner_pos_machines table (different schema)
const PARTNER_POS_COLUMNS = [
  'id', 'partner_id', 'terminal_id', 'device_serial', 'machine_model',
  'status', 'activated_at', 'last_txn_at', 'metadata',
  'retailer_code', 'retailer_name', 'retailer_business_name',
  'retailer_city', 'retailer_state',
  'created_at', 'updated_at'
].join(',')

/**
 * GET /api/pos-machines/my-machines
 * Returns POS machines assigned to the current user based on their role:
 * - Admin: All machines
 * - Master Distributor: Machines where master_distributor_id = user.partner_id
 * - Distributor: Machines where distributor_id = user.partner_id
 * - Retailer: Machines where retailer_id = user.partner_id
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user, method } = await getCurrentUserWithFallback(request)
    console.log('[POS My Machines GET] Auth:', method, '|', user?.email || 'none', '| Role:', user?.role, '| Partner ID:', user?.partner_id || 'NONE')

    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    if (user.role !== 'admin' && !user.partner_id) {
      console.error('[POS My Machines GET] User has no partner_id:', user.email, user.role)
      return NextResponse.json({ error: 'Account configuration issue. Please contact support.', code: 'NO_PARTNER_ID' }, { status: 400 })
    }

    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const rawLimit = parseInt(searchParams.get('limit') || '25', 10)
    const limit = [10, 25, 100].includes(rawLimit) ? rawLimit : 25
    const offset = (page - 1) * limit
    const statusFilter = searchParams.get('status')
    const inventoryStatusFilter = searchParams.get('inventory_status')
    const search = searchParams.get('search')

    // SPECIAL HANDLING FOR PARTNER ROLE: Query partner_pos_machines table instead
    if (user.role === 'partner') {
      return await handlePartnerMachines(supabase, supabaseUrl, supabaseServiceKey, user, { page, limit, offset, statusFilter, search })
    }

    // Build PostgREST query params — bypass supabase-js query builder entirely
    // because it silently drops rows when .eq() filters are used.
    const params = new URLSearchParams({ select: POS_COLUMNS, limit: '10000' })

    switch (user.role) {
      case 'admin':
        break
      case 'master_distributor':
        params.set('master_distributor_id', `eq.${user.partner_id}`)
        params.set('inventory_status', `in.(assigned_to_master_distributor,assigned_to_distributor,assigned_to_retailer)`)
        break
      case 'distributor':
        params.set('distributor_id', `eq.${user.partner_id}`)
        params.set('inventory_status', `in.(assigned_to_distributor,assigned_to_retailer)`)
        break
      case 'retailer':
        params.set('retailer_id', `eq.${user.partner_id}`)
        params.set('inventory_status', `eq.assigned_to_retailer`)
        break
      default:
        return NextResponse.json({ error: 'Unauthorized role' }, { status: 403 })
    }

    if (statusFilter && statusFilter !== 'all') {
      params.set('status', `eq.${statusFilter}`)
    }
    if (user.role === 'admin' && inventoryStatusFilter && inventoryStatusFilter !== 'all') {
      params.set('inventory_status', `eq.${inventoryStatusFilter}`)
    }
    if (search) {
      params.set('or', `(machine_id.ilike.%${search}%,serial_number.ilike.%${search}%,mid.ilike.%${search}%,tid.ilike.%${search}%,brand.ilike.%${search}%)`)
    }

    const restUrl = `${supabaseUrl}/rest/v1/pos_machines?${params.toString()}`
    console.log('[POS My Machines GET] PostgREST URL:', restUrl.replace(supabaseUrl, '<SUPA>'))
    const res = await fetch(restUrl, {
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Accept': 'application/json',
        'Cache-Control': 'no-cache, no-store',
        'Pragma': 'no-cache',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error('Error fetching POS machines:', res.status, errBody)
      return NextResponse.json({ error: 'Failed to fetch POS machines' }, { status: 500 })
    }

    const rawMachines: any[] = await res.json()

    console.log('[POS My Machines GET] PostgREST returned', rawMachines.length, 'rows (before server filter)')

    // Server-side safety filter: guarantee we never return machines that don't match
    let allMachines = rawMachines
    if (user.role === 'retailer') {
      allMachines = rawMachines.filter(m =>
        m.retailer_id === user.partner_id && m.inventory_status === 'assigned_to_retailer'
      )
      if (allMachines.length !== rawMachines.length) {
        console.warn('[POS My Machines GET] SERVER FILTER removed', rawMachines.length - allMachines.length,
          'stale machines. PostgREST returned', rawMachines.length, 'but only', allMachines.length, 'actually match.')
      }
    } else if (user.role === 'distributor') {
      allMachines = rawMachines.filter(m =>
        m.distributor_id === user.partner_id &&
        ['assigned_to_distributor', 'assigned_to_retailer'].includes(m.inventory_status)
      )
    } else if (user.role === 'master_distributor') {
      allMachines = rawMachines.filter(m =>
        m.master_distributor_id === user.partner_id &&
        ['assigned_to_master_distributor', 'assigned_to_distributor', 'assigned_to_retailer'].includes(m.inventory_status)
      )
    }

    allMachines.sort((a: any, b: any) => {
      const da = a.created_at ? new Date(a.created_at).getTime() : 0
      const db = b.created_at ? new Date(b.created_at).getTime() : 0
      return db - da
    })
    const count = allMachines.length
    const machines = allMachines.slice(offset, offset + limit)

    console.log('[POS My Machines GET] Results:', count, 'machines for', user.role, user.partner_id)

    // Fetch assignable users based on role
    let assignableUsers: any[] = []
    
    // For Admin - fetch both Master Distributors and Partners
    if (user.role === 'admin') {
      const [masterDistributorsResult, partnersResult] = await Promise.all([
        supabase
          .from('master_distributors')
          .select('partner_id, name, email, business_name, status')
          .eq('status', 'active')
          .order('name'),
        supabase
          .from('partners')
          .select('id, name, email, business_name, status')
          .eq('status', 'active')
          .order('name')
      ])
      
      // Format master distributors
      const masterDistributors = (masterDistributorsResult.data || []).map((md: any) => ({
        partner_id: md.partner_id,
        name: md.name,
        email: md.email,
        business_name: md.business_name,
        status: md.status,
        type: 'master_distributor'
      }))
      
      // Format partners (use id as partner_id for consistency)
      const partners = (partnersResult.data || []).map((p: any) => ({
        partner_id: p.id, // Use id as partner_id for consistency
        name: p.name,
        email: p.email,
        business_name: p.business_name,
        status: p.status,
        type: 'partner'
      }))
      
      assignableUsers = [...masterDistributors, ...partners]
    }
    
    // For Master Distributor - also fetch their distributors for assignment dropdown
    if (user.role === 'master_distributor') {
      const { data: distributors } = await supabase
        .from('distributors')
        .select('partner_id, name, email, business_name, status')
        .eq('master_distributor_id', user.partner_id!)
        .eq('status', 'active')
        .order('name')
      assignableUsers = distributors || []
    }

    // For Distributor - also fetch their retailers for assignment dropdown
    if (user.role === 'distributor') {
      const { data: retailers } = await supabase
        .from('retailers')
        .select('partner_id, name, email, business_name, status')
        .eq('distributor_id', user.partner_id!)
        .eq('status', 'active')
        .order('name')
      assignableUsers = retailers || []
    }

    const totalPages = count ? Math.ceil(count / limit) : 1

    return NextResponse.json({
      success: true,
      data: machines || [],
      assignableUsers,
      userRole: user.role,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    })

  } catch (error: any) {
    console.error('Error in GET /api/pos-machines/my-machines:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Handle POS machines for partner role - queries partner_pos_machines table
 * This is separate because partners use a different table structure
 */
async function handlePartnerMachines(
  supabase: any,
  supabaseUrl: string,
  supabaseServiceKey: string,
  user: any,
  options: { page: number; limit: number; offset: number; statusFilter: string | null; search: string | null }
) {
  const { page, limit, offset, statusFilter, search } = options

  // Build query for partner_pos_machines - filter by partner_id directly
  const params = new URLSearchParams({ 
    select: PARTNER_POS_COLUMNS, 
    limit: '10000',
    partner_id: `eq.${user.partner_id}`
  })

  if (statusFilter && statusFilter !== 'all') {
    params.set('status', `eq.${statusFilter}`)
  }
  if (search) {
    params.set('or', `(terminal_id.ilike.%${search}%,device_serial.ilike.%${search}%,machine_model.ilike.%${search}%,retailer_name.ilike.%${search}%)`)
  }

  const restUrl = `${supabaseUrl}/rest/v1/partner_pos_machines?${params.toString()}`
  console.log('[POS My Machines GET] Partner PostgREST URL:', restUrl.replace(supabaseUrl, '<SUPA>'))
  
  const res = await fetch(restUrl, {
    headers: {
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Accept': 'application/json',
      'Cache-Control': 'no-cache, no-store',
      'Pragma': 'no-cache',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const errBody = await res.text()
    console.error('Error fetching partner POS machines:', res.status, errBody)
    return NextResponse.json({ error: 'Failed to fetch POS machines' }, { status: 500 })
  }

  const rawMachines: any[] = await res.json()
  console.log('[POS My Machines GET] Partner PostgREST returned', rawMachines.length, 'machines')

  // Transform partner_pos_machines format to match expected dashboard format
  const transformedMachines = rawMachines.map(m => ({
    id: m.id,
    machine_id: m.terminal_id, // Map terminal_id to machine_id for UI consistency
    serial_number: m.device_serial,
    machine_type: m.machine_model,
    tid: m.terminal_id,
    mid: m.metadata?.mid || null,
    brand: m.machine_model,
    status: m.status,
    inventory_status: 'assigned_to_partner',
    activated_at: m.activated_at,
    last_txn_at: m.last_txn_at,
    retailer_code: m.retailer_code,
    retailer_name: m.retailer_name,
    retailer_business_name: m.retailer_business_name,
    retailer_city: m.retailer_city,
    retailer_state: m.retailer_state,
    created_at: m.created_at,
    updated_at: m.updated_at,
  }))

  // Sort by created_at descending
  transformedMachines.sort((a, b) => {
    const da = a.created_at ? new Date(a.created_at).getTime() : 0
    const db = b.created_at ? new Date(b.created_at).getTime() : 0
    return db - da
  })

  const count = transformedMachines.length
  const machines = transformedMachines.slice(offset, offset + limit)
  const totalPages = count ? Math.ceil(count / limit) : 1

  console.log('[POS My Machines GET] Partner Results:', count, 'machines for partner', user.partner_id)

  return NextResponse.json({
    success: true,
    data: machines,
    assignableUsers: [], // Partners cannot assign machines
    userRole: user.role,
    pagination: {
      page,
      limit,
      total: count,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    }
  })
}

