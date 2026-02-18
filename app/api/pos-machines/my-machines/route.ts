import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    console.log('[POS My Machines GET] Auth:', method, '|', user?.email || 'none', '| Role:', user?.role)

    if (!user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit
    const statusFilter = searchParams.get('status')
    const inventoryStatusFilter = searchParams.get('inventory_status')
    const search = searchParams.get('search')

    let query = supabase
      .from('pos_machines')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    // Role-based filtering
    switch (user.role) {
      case 'admin':
        // Admin sees all machines
        break
      case 'master_distributor':
        // Master Distributor should only see machines assigned to them, not machines assigned to partners
        query = query
          .eq('master_distributor_id', user.partner_id!)
          .neq('inventory_status', 'assigned_to_partner') // Exclude machines assigned to partners
        break
      case 'distributor':
        // Distributor should only see machines assigned to them, not machines assigned to partners
        query = query
          .eq('distributor_id', user.partner_id!)
          .neq('inventory_status', 'assigned_to_partner') // Exclude machines assigned to partners
        break
      case 'retailer':
        // Retailer should only see machines assigned to them, not machines assigned to partners
        query = query
          .eq('retailer_id', user.partner_id!)
          .neq('inventory_status', 'assigned_to_partner') // Exclude machines assigned to partners
        break
      default:
        return NextResponse.json({ error: 'Unauthorized role' }, { status: 403 })
    }

    // Apply filters
    if (statusFilter && statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }
    if (inventoryStatusFilter && inventoryStatusFilter !== 'all') {
      query = query.eq('inventory_status', inventoryStatusFilter)
    }
    if (search) {
      query = query.or(`machine_id.ilike.%${search}%,serial_number.ilike.%${search}%,mid.ilike.%${search}%,tid.ilike.%${search}%,brand.ilike.%${search}%`)
    }

    // Pagination
    query = query.range(offset, offset + limit - 1)

    const { data: machines, error, count } = await query

    if (error) {
      console.error('Error fetching POS machines:', error)
      return NextResponse.json({ error: 'Failed to fetch POS machines' }, { status: 500 })
    }

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

