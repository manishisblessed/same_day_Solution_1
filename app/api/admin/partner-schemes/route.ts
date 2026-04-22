import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
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
      partner_mdr_t0,
      partner_mdr_t1,
      status = 'active',
    } = body

    if (!partner_id || !mode || partner_mdr_t0 === undefined || partner_mdr_t1 === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: partner_id, mode, partner_mdr_t0, partner_mdr_t1' },
        { status: 400 }
      )
    }

    // Validate MDR rates
    if (partner_mdr_t0 < 0 || partner_mdr_t0 > 100 || partner_mdr_t1 < 0 || partner_mdr_t1 > 100) {
      return NextResponse.json(
        { error: 'MDR rates must be between 0 and 100' },
        { status: 400 }
      )
    }

    // Check if scheme already exists for this partner/mode/card_type/brand_type
    const { data: existing } = await supabase
      .from('partner_schemes')
      .select('id, status')
      .eq('partner_id', partner_id)
      .eq('mode', mode)
      .eq('card_type', card_type || null)
      .eq('brand_type', brand_type || null)
      .eq('status', 'active')
      .maybeSingle()

    if (existing) {
      // Deactivate existing scheme first
      await supabase
        .from('partner_schemes')
        .update({ status: 'inactive' })
        .eq('id', existing.id)
    }

    // Insert new scheme
    const { data, error } = await supabase
      .from('partner_schemes')
      .insert({
        partner_id,
        mode,
        card_type: card_type || null,
        brand_type: brand_type || null,
        partner_mdr_t0,
        partner_mdr_t1,
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
