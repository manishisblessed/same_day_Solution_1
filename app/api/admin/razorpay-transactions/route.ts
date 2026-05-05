import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs' // Force Node.js runtime (Supabase not compatible with Edge Runtime)
export const dynamic = 'force-dynamic'

// Helper function to get Supabase client with validation
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables. Please configure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(supabaseUrl, supabaseServiceKey)
}

/**
 * Admin-only API to fetch Razorpay POS transactions
 * 
 * Reads from razorpay_pos_transactions table (populated by webhook)
 * Returns paginated list of transactions sorted by transaction_time DESC
 * 
 * Response fields:
 * - txn_id
 * - amount
 * - payment_mode
 * - status (CAPTURED, FAILED, PENDING)
 * - settlement_status
 * - created_time (mapped from transaction_time)
 */
export async function GET(request: NextRequest) {
  // Check environment variables FIRST - before anything else
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { 
        error: 'Server configuration error',
        message: `Missing: ${!supabaseUrl ? 'NEXT_PUBLIC_SUPABASE_URL' : ''} ${!supabaseServiceKey ? 'SUPABASE_SERVICE_ROLE_KEY' : ''}`.trim()
      },
      { status: 500 }
    )
  }

  try {
    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check admin authentication with fallback
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[Razorpay Transactions] Auth:', method, '|', admin?.email || 'none')
    
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 })
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const rawLimit = parseInt(searchParams.get('limit') || '25', 10)
    const limit = [10, 25, 100].includes(rawLimit) ? rawLimit : 25
    const offset = (page - 1) * limit
    const statusFilter = searchParams.get('status') // Optional filter by status
    const dateFrom = searchParams.get('date_from') // Date range start (YYYY-MM-DD or ISO)
    const dateTo = searchParams.get('date_to') // Date range end (YYYY-MM-DD or ISO)
    const paymentMode = searchParams.get('payment_mode') // Filter by payment mode (CARD, UPI, CASH, etc.)
    const searchQuery = searchParams.get('search') // Search by TID, MID, RRN, txn_id, customer_name
    const settlementFilter = searchParams.get('settlement_status') // Filter by settlement status
    const cardBrand = searchParams.get('card_brand') // Filter by card brand
    const merchantSlug = searchParams.get('merchant_slug') // Filter by company: all | ashvam | teachway | newscenaric | lagoon
    const acquiringBank = searchParams.get('acquiring_bank') // Filter by acquiring bank (partial match)

    // Validate pagination
    if (page < 1 || limit < 1) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters' },
        { status: 400 }
      )
    }

    // Build query from razorpay_pos_transactions (the table webhook writes to)
    // Select dedicated columns + raw_data for fallback extraction
    let query = supabase
      .from('razorpay_pos_transactions')
      .select('txn_id, amount, payment_mode, display_status, status, transaction_time, raw_data, tid, device_serial, merchant_name, merchant_slug, customer_name, payer_name, username, txn_type, auth_code, card_number, issuing_bank, card_classification, mid_code, card_brand, card_type, currency, rrn, external_ref, settlement_status, settled_on, receipt_url, posting_date, acquiring_bank', { count: 'exact' })
      .order('transaction_time', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    // Apply company (merchant) filter: supports multiple comma-separated slugs
    // ashvam = base URL (slug or null), others = exact slug
    if (merchantSlug && merchantSlug !== 'all') {
      const slugs = merchantSlug.split(',').map(s => s.trim()).filter(Boolean)
      if (slugs.length === 1) {
        if (slugs[0] === 'ashvam') {
          query = query.or('merchant_slug.eq.ashvam,merchant_slug.is.null')
        } else {
          query = query.eq('merchant_slug', slugs[0])
        }
      } else if (slugs.length > 1) {
        // Build OR condition for multiple slugs
        const conditions = slugs.map(slug => {
          if (slug === 'ashvam') {
            return 'merchant_slug.eq.ashvam,merchant_slug.is.null'
          }
          return `merchant_slug.eq.${slug}`
        }).join(',')
        query = query.or(conditions)
      }
    }

    // Apply status filter if provided (filter on display_status: SUCCESS, FAILED, PENDING)
    if (statusFilter && ['CAPTURED', 'FAILED', 'PENDING'].includes(statusFilter.toUpperCase())) {
      const displayStatus = statusFilter.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : statusFilter.toUpperCase()
      query = query.eq('display_status', displayStatus)
    }

    // Apply date range filter
    if (dateFrom) {
      const fromDate = dateFrom.includes('T') ? dateFrom : `${dateFrom}T00:00:00`
      query = query.gte('transaction_time', fromDate)
    }
    if (dateTo) {
      const toDate = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59`
      query = query.lte('transaction_time', toDate)
    }

    // Apply payment mode filter
    if (paymentMode && paymentMode !== 'all') {
      query = query.eq('payment_mode', paymentMode.toUpperCase())
    }

    // Apply settlement status filter
    if (settlementFilter && settlementFilter !== 'all') {
      query = query.eq('settlement_status', settlementFilter.toUpperCase())
    }

    // Apply card brand filter
    if (cardBrand && cardBrand !== 'all') {
      query = query.eq('card_brand', cardBrand.toUpperCase())
    }

    // Apply acquiring bank filter (case-insensitive, partial match)
    if (acquiringBank && acquiringBank.trim()) {
      const b = acquiringBank.trim()
      query = query.ilike('acquiring_bank', `%${b}%`)
    }

    // Apply search query (search across multiple fields using OR)
    if (searchQuery && searchQuery.trim()) {
      const s = searchQuery.trim()
      query = query.or(`txn_id.ilike.%${s}%,rrn.ilike.%${s}%,tid.ilike.%${s}%,mid_code.ilike.%${s}%,customer_name.ilike.%${s}%,username.ilike.%${s}%,card_number.ilike.%${s}%`)
    }

    const { data: transactions, error, count } = await query

    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return NextResponse.json(
          { error: 'Table razorpay_pos_transactions does not exist. Please contact admin.' },
          { status: 500 }
        )
      }
      return NextResponse.json(
        { error: 'Database error', message: error.message },
        { status: 500 }
      )
    }

    // Fetch POS machine assignment history for time-aware assignee resolution
    const uniqueTids = [...new Set((transactions || []).map((t: any) => t.tid).filter(Boolean))]
    const tidToAssignments: Record<string, { assigned_to: string, assigned_to_role: string, from: Date, to: Date | null }[]> = {}
    let posMachineMap: Record<string, any> = {}
    let retailerMap: Record<string, any> = {}
    let distributorMap: Record<string, any> = {}
    let masterDistributorMap: Record<string, any> = {}
    let partnerMap: Record<string, any> = {}

    if (uniqueTids.length > 0) {
      const { data: posMachines } = await supabase
        .from('pos_machines')
        .select('id, tid, retailer_id, distributor_id, master_distributor_id, partner_id')
        .in('tid', uniqueTids)

      if (posMachines) {
        const machineIdToTid = new Map<string, string>()
        posMachines.forEach((pm: any) => {
          if (pm.tid) {
            posMachineMap[pm.tid] = pm
            machineIdToTid.set(pm.id, pm.tid)
          }
        })

        // Fetch assignment history for all machines
        const machineIds = posMachines.map((pm: any) => pm.id).filter(Boolean)
        if (machineIds.length > 0) {
          const { data: history } = await supabase
            .from('pos_assignment_history')
            .select('pos_machine_id, assigned_to, assigned_to_role, created_at, returned_date, status')
            .in('pos_machine_id', machineIds)
            .like('action', 'assigned_to_%')
            .order('created_at', { ascending: false })

          if (history) {
            for (const h of history) {
              const tid = machineIdToTid.get(h.pos_machine_id)
              if (!tid) continue
              if (!tidToAssignments[tid]) tidToAssignments[tid] = []
              tidToAssignments[tid].push({
                assigned_to: h.assigned_to,
                assigned_to_role: h.assigned_to_role,
                from: new Date(h.created_at),
                to: h.returned_date ? new Date(h.returned_date) : null
              })
            }
          }
        }

        // Collect all unique assignee IDs by role (from both history and current assignment)
        const retailerIds = new Set<string>()
        const distributorIds = new Set<string>()
        const masterDistributorIds = new Set<string>()
        const partnerIds = new Set<string>()

        for (const tid in tidToAssignments) {
          for (const a of tidToAssignments[tid]) {
            switch (a.assigned_to_role) {
              case 'retailer': retailerIds.add(a.assigned_to); break
              case 'distributor': distributorIds.add(a.assigned_to); break
              case 'master_distributor': masterDistributorIds.add(a.assigned_to); break
              case 'partner': partnerIds.add(a.assigned_to); break
            }
          }
        }

        // Also include current assignment IDs as fallback
        posMachines.forEach((pm: any) => {
          if (pm.retailer_id) retailerIds.add(pm.retailer_id)
          if (pm.distributor_id) distributorIds.add(pm.distributor_id)
          if (pm.master_distributor_id) masterDistributorIds.add(pm.master_distributor_id)
          if (pm.partner_id) partnerIds.add(pm.partner_id)
        })

        // Fetch names in parallel
        const [retailerResult, distributorResult, mdResult, partnerResult] = await Promise.all([
          retailerIds.size > 0 ? supabase.from('retailers').select('partner_id, name, business_name').in('partner_id', [...retailerIds]) : Promise.resolve({ data: [] as any[] }),
          distributorIds.size > 0 ? supabase.from('distributors').select('partner_id, name, business_name').in('partner_id', [...distributorIds]) : Promise.resolve({ data: [] as any[] }),
          masterDistributorIds.size > 0 ? supabase.from('master_distributors').select('partner_id, name, business_name').in('partner_id', [...masterDistributorIds]) : Promise.resolve({ data: [] as any[] }),
          partnerIds.size > 0 ? supabase.from('partners').select('id, name, business_name').in('id', [...partnerIds]) : Promise.resolve({ data: [] as any[] }),
        ])

        for (const r of (retailerResult.data || [])) retailerMap[r.partner_id] = r
        for (const d of (distributorResult.data || [])) distributorMap[d.partner_id] = d
        for (const md of (mdResult.data || [])) masterDistributorMap[md.partner_id] = md
        for (const p of (partnerResult.data || [])) partnerMap[p.id] = p
      }
    }

    // Build a separate query for aggregate stats using RPC-style approach
    // We use multiple targeted queries to avoid the 1000-row default limit
    
    // Helper: build base filter for stats queries
    const buildStatsFilter = (q: any) => {
      if (merchantSlug && merchantSlug !== 'all') {
        const slugs = merchantSlug.split(',').map(s => s.trim()).filter(Boolean)
        if (slugs.length === 1) {
          if (slugs[0] === 'ashvam') {
            q = q.or('merchant_slug.eq.ashvam,merchant_slug.is.null')
          } else {
            q = q.eq('merchant_slug', slugs[0])
          }
        } else if (slugs.length > 1) {
          const conditions = slugs.map(slug => {
            if (slug === 'ashvam') return 'merchant_slug.eq.ashvam,merchant_slug.is.null'
            return `merchant_slug.eq.${slug}`
          }).join(',')
          q = q.or(conditions)
        }
      }
      if (statusFilter && ['CAPTURED', 'FAILED', 'PENDING'].includes(statusFilter.toUpperCase())) {
        const displayStatus = statusFilter.toUpperCase() === 'CAPTURED' ? 'SUCCESS' : statusFilter.toUpperCase()
        q = q.eq('display_status', displayStatus)
      }
      if (dateFrom) {
        const fromDate = dateFrom.includes('T') ? dateFrom : `${dateFrom}T00:00:00`
        q = q.gte('transaction_time', fromDate)
      }
      if (dateTo) {
        const toDate = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59`
        q = q.lte('transaction_time', toDate)
      }
      if (paymentMode && paymentMode !== 'all') q = q.eq('payment_mode', paymentMode.toUpperCase())
      if (settlementFilter && settlementFilter !== 'all') q = q.eq('settlement_status', settlementFilter.toUpperCase())
      if (cardBrand && cardBrand !== 'all') q = q.eq('card_brand', cardBrand.toUpperCase())
      if (acquiringBank && acquiringBank.trim()) q = q.ilike('acquiring_bank', `%${acquiringBank.trim()}%`)
      if (searchQuery && searchQuery.trim()) {
        const s = searchQuery.trim()
        q = q.or(`txn_id.ilike.%${s}%,rrn.ilike.%${s}%,tid.ilike.%${s}%,mid_code.ilike.%${s}%,customer_name.ilike.%${s}%,username.ilike.%${s}%,card_number.ilike.%${s}%`)
      }
      return q
    }

    // Fetch amounts in pages to avoid the 1000-row limit
    let totalCapturedAmount = 0
    const pageLimit = 1000
    let statsOffset = 0
    let hasMoreStats = true
    while (hasMoreStats) {
      let amountQuery = supabase
        .from('razorpay_pos_transactions')
        .select('amount')
        .eq('display_status', 'SUCCESS')
        .range(statsOffset, statsOffset + pageLimit - 1)
      amountQuery = buildStatsFilter(amountQuery)
      const { data: amountData } = await amountQuery
      if (amountData && amountData.length > 0) {
        totalCapturedAmount += amountData.reduce((sum: number, t: any) => sum + (t.amount || 0), 0)
        statsOffset += pageLimit
        if (amountData.length < pageLimit) hasMoreStats = false
      } else {
        hasMoreStats = false
      }
    }

    // total count comes from the main paginated query (exact count)
    const totalTransactions = count || 0
    const capturedAmount = totalCapturedAmount
    const avgAmount = totalTransactions > 0 ? Math.round(capturedAmount / totalTransactions) : 0

    // Map fields to the format the frontend expects
    // Use dedicated columns first, fallback to raw_data extraction
    const mappedTransactions = (transactions || []).map((txn: any) => {
      // Historical assignee resolution: find who had the machine at transaction time
      let assignedName = null
      let assignedType = null

      if (txn.tid && tidToAssignments[txn.tid]) {
        const txTime = new Date(txn.transaction_time)
        const matchingAssignment = tidToAssignments[txn.tid].find(
          (a: { from: Date, to: Date | null }) => txTime >= a.from && (!a.to || txTime <= a.to)
        )
        if (matchingAssignment) {
          const id = matchingAssignment.assigned_to
          switch (matchingAssignment.assigned_to_role) {
            case 'retailer':
              assignedName = retailerMap[id]?.name || retailerMap[id]?.business_name
              assignedType = 'retailer'
              break
            case 'distributor':
              assignedName = distributorMap[id]?.name || distributorMap[id]?.business_name
              assignedType = 'distributor'
              break
            case 'master_distributor':
              assignedName = masterDistributorMap[id]?.name || masterDistributorMap[id]?.business_name
              assignedType = 'master_distributor'
              break
            case 'partner':
              assignedName = partnerMap[id]?.name || partnerMap[id]?.business_name
              assignedType = 'partner'
              break
          }
        }
      }

      // Fallback to current pos_machines assignment ONLY if no history exists for this TID
      // (handles machines assigned before history tracking was implemented).
      // If history exists but no window matches, the machine was unassigned at that time.
      if (!assignedName && txn.tid && !tidToAssignments[txn.tid]) {
        const posMachine = posMachineMap[txn.tid]
        if (posMachine) {
          if (posMachine.retailer_id) {
            assignedName = retailerMap[posMachine.retailer_id]?.name || retailerMap[posMachine.retailer_id]?.business_name
            assignedType = 'retailer'
          } else if (posMachine.distributor_id) {
            assignedName = distributorMap[posMachine.distributor_id]?.name || distributorMap[posMachine.distributor_id]?.business_name
            assignedType = 'distributor'
          } else if (posMachine.master_distributor_id) {
            assignedName = masterDistributorMap[posMachine.master_distributor_id]?.name || masterDistributorMap[posMachine.master_distributor_id]?.business_name
            assignedType = 'master_distributor'
          } else if (posMachine.partner_id) {
            assignedName = partnerMap[posMachine.partner_id]?.name || partnerMap[posMachine.partner_id]?.business_name
            assignedType = 'partner'
          }
        }
      }

      return {
        txn_id: txn.txn_id,
        amount: txn.amount,
        payment_mode: txn.payment_mode,
        // Map display_status back to frontend status: SUCCESS→CAPTURED
        status: txn.display_status === 'SUCCESS' ? 'CAPTURED' : (txn.display_status || txn.status || 'PENDING'),
        settlement_status: txn.settlement_status || txn.raw_data?.settlementStatus || null,
        created_time: txn.transaction_time,
        service_provider: 'RAZORPAY',
        // Company (merchant_slug): ashvam, teachway, newscenaric, lagoon; null = legacy/ashvam
        merchant_slug: txn.merchant_slug || 'ashvam',
        // Partner/Retailer/Distributor/MD assignment info (from POS machine)
        assigned_name: assignedName,
        assigned_type: assignedType,
        // Customer & User Info
        customer_name: txn.customer_name || txn.raw_data?.customerName || txn.raw_data?.payerName || null,
        payer_name: txn.payer_name || txn.raw_data?.payerName || null,
        username: txn.username || txn.raw_data?.username || null,
        // Terminal & Device Info
        tid: txn.tid || txn.raw_data?.tid || null,
        mid: txn.mid_code || txn.raw_data?.mid || txn.raw_data?.merchantId || null,
        device_serial: txn.device_serial || txn.raw_data?.deviceSerial || null,
        merchant_name: txn.merchant_name || txn.raw_data?.merchantName || null,
        // Transaction Details
        txn_type: txn.txn_type || txn.raw_data?.txnType || 'CHARGE',
        auth_code: txn.auth_code || txn.raw_data?.authCode || null,
        currency: txn.currency || txn.raw_data?.currencyCode || 'INR',
        // Card Details
        card_brand: txn.card_brand || txn.raw_data?.paymentCardBrand || txn.raw_data?.cardBrand || null,
        card_type: txn.card_type || txn.raw_data?.paymentCardType || txn.raw_data?.cardType || null,
        card_number: txn.card_number || txn.raw_data?.cardNumber || txn.raw_data?.maskedCardNumber || null,
        issuing_bank: txn.issuing_bank || txn.raw_data?.issuingBankName || txn.raw_data?.bankName || txn.raw_data?.issuingBank || null,
        card_classification: txn.card_classification || txn.raw_data?.cardClassification || txn.raw_data?.cardCategory || null,
        acquiring_bank: txn.acquiring_bank || txn.raw_data?.acquiringBank || txn.raw_data?.acquiringBankName || txn.raw_data?.acquirerCode || null,
        // Reference Numbers
        rrn: txn.rrn || txn.raw_data?.rrNumber || txn.raw_data?.rrn || null,
        external_ref: txn.external_ref || txn.raw_data?.externalRefNumber || null,
        // Dates
        posting_date: txn.posting_date || txn.raw_data?.postingDate || null,
        settled_on: txn.settled_on || txn.raw_data?.settledOn || txn.raw_data?.settlementDate || null,
        // Receipt
        customer_receipt_url: txn.receipt_url || txn.raw_data?.customerReceiptUrl || txn.raw_data?.receiptUrl || null,
        // Raw data for JSON view
        raw_data: txn.raw_data || null
      }
    })

    // Calculate pagination metadata
    const totalPages = count ? Math.ceil(count / limit) : 1
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    return NextResponse.json({
      success: true,
      data: mappedTransactions,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNextPage,
        hasPrevPage
      },
      stats: {
        capturedAmount,
        avgAmount,
      }
    })

  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}

