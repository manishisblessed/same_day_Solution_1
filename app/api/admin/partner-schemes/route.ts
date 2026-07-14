import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin authentication required' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Supabase configuration missing' },
      { status: 500 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Get optional filter parameters
    const { searchParams } = new URL(request.url)
    const partnerId = searchParams.get('partner_id')
    const status = searchParams.get('status') || 'active'

    let query = supabase
      .from('partner_schemes')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })

    if (partnerId) {
      query = query.eq('partner_id', partnerId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching partner schemes:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json({ data })
  } catch (error: any) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin authentication required' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Supabase configuration missing' },
      { status: 500 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const body = await request.json()

    // Validate required fields
    const {
      partner_id,
      mode,
      card_type,
      brand_type,
      merchant_slug,
      partner_mdr_t0,
      partner_mdr_t1,
      partner_mdr,
      status = 'active',
    } = body

    // Brand (merchant company) this scheme applies to; null = all brands
    const { isValidPOSMerchantSlug } = await import('@/lib/merchant-companies')
    const normalizedSlug = merchant_slug ? String(merchant_slug).toLowerCase().trim() : null
    if (normalizedSlug && !isValidPOSMerchantSlug(normalizedSlug)) {
      return NextResponse.json(
        { error: `Invalid merchant_slug: ${merchant_slug}` },
        { status: 400 }
      )
    }

    // Support both unified partner_mdr and legacy t0/t1
    const resolvedT0 = partner_mdr !== undefined ? partner_mdr : partner_mdr_t0
    const resolvedT1 = partner_mdr !== undefined ? partner_mdr : partner_mdr_t1

    if (!partner_id || !mode || resolvedT0 === undefined || resolvedT1 === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: partner_id, mode, and MDR rate (partner_mdr or partner_mdr_t0/t1)' },
        { status: 400 }
      )
    }

    if (resolvedT0 < 0 || resolvedT0 > 100 || resolvedT1 < 0 || resolvedT1 > 100) {
      return NextResponse.json(
        { error: 'MDR rates must be between 0 and 100' },
        { status: 400 }
      )
    }

    // Check if scheme already exists for this partner/brand/mode/card_type/brand_type
    let existingQuery = supabase
      .from('partner_schemes')
      .select('id, status')
      .eq('partner_id', partner_id)
      .eq('mode', mode)
      .eq('status', 'active')
    existingQuery = card_type ? existingQuery.eq('card_type', card_type) : existingQuery.is('card_type', null)
    existingQuery = brand_type ? existingQuery.eq('brand_type', brand_type) : existingQuery.is('brand_type', null)
    existingQuery = normalizedSlug ? existingQuery.eq('merchant_slug', normalizedSlug) : existingQuery.is('merchant_slug', null)
    const { data: existing } = await existingQuery.maybeSingle()

    if (existing) {
      // Deactivate existing scheme first
      await supabase
        .from('partner_schemes')
        .update({ status: 'inactive' })
        .eq('id', existing.id)
    }

    const { data, error } = await supabase
      .from('partner_schemes')
      .insert({
        partner_id,
        mode,
        card_type: card_type || null,
        brand_type: brand_type || null,
        merchant_slug: normalizedSlug,
        partner_mdr_t0: resolvedT0,
        partner_mdr_t1: resolvedT1,
        status,
        effective_date: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating partner scheme:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    console.log(`[Admin] Partner scheme created: ${data.id} for partner ${partner_id}`)

    return NextResponse.json({ data })
  } catch (error: any) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin authentication required' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Supabase configuration missing' },
      { status: 500 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const body = await request.json()
    const { id, partner_mdr_t0, partner_mdr_t1, status } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Missing scheme id' },
        { status: 400 }
      )
    }

    const updateData: any = {}
    if (partner_mdr_t0 !== undefined) updateData.partner_mdr_t0 = partner_mdr_t0
    if (partner_mdr_t1 !== undefined) updateData.partner_mdr_t1 = partner_mdr_t1
    if (status !== undefined) updateData.status = status

    const { data, error } = await supabase
      .from('partner_schemes')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating partner scheme:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    console.log(`[Admin] Partner scheme updated: ${id}`)

    return NextResponse.json({ data })
  } catch (error: any) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
