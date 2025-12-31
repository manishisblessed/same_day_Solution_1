import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// This route should be protected in production
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, role, tableName, userData } = body

    if (!email || !password || !role || !tableName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Use service role key for admin operations
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    // Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError) {
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      )
    }

    // Validate hierarchy requirements
    if (tableName === 'distributors') {
      if (!userData.master_distributor_id) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Master Distributor is required to create a Distributor' },
          { status: 400 }
        )
      }
      
      // Verify master distributor exists and is active
      const { data: masterDist, error: masterError } = await supabaseAdmin
        .from('master_distributors')
        .select('id, partner_id, status')
        .eq('partner_id', userData.master_distributor_id)
        .single()

      if (masterError || !masterDist) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Master Distributor not found' },
          { status: 400 }
        )
      }

      if (masterDist.status !== 'active') {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Master Distributor must be active' },
          { status: 400 }
        )
      }
    }

    if (tableName === 'retailers') {
      if (!userData.distributor_id) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Distributor is required to create a Retailer' },
          { status: 400 }
        )
      }

      // Verify distributor exists and is active
      const { data: distributor, error: distError } = await supabaseAdmin
        .from('distributors')
        .select('id, partner_id, status, master_distributor_id')
        .eq('partner_id', userData.distributor_id)
        .single()

      if (distError || !distributor) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Distributor not found' },
          { status: 400 }
        )
      }

      if (distributor.status !== 'active') {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: 'Distributor must be active' },
          { status: 400 }
        )
      }

      // Set master_distributor_id from distributor if not provided
      if (!userData.master_distributor_id && distributor.master_distributor_id) {
        userData.master_distributor_id = distributor.master_distributor_id
      }

      // Verify master distributor exists if provided
      if (userData.master_distributor_id) {
        const { data: masterDist, error: masterError } = await supabaseAdmin
          .from('master_distributors')
          .select('id, partner_id, status')
          .eq('partner_id', userData.master_distributor_id)
          .single()

        if (masterError || !masterDist) {
          await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
          return NextResponse.json(
            { error: 'Master Distributor not found' },
            { status: 400 }
          )
        }

        // Verify distributor belongs to the master distributor
        if (distributor.master_distributor_id !== userData.master_distributor_id) {
          await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
          return NextResponse.json(
            { error: 'Distributor does not belong to the selected Master Distributor' },
            { status: 400 }
          )
        }
      }
    }

    // Insert into appropriate table
    const { data: tableData, error: tableError } = await supabaseAdmin
      .from(tableName)
      .insert([userData])
      .select()
      .single()

    if (tableError) {
      // Rollback: delete auth user if table insert fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json(
        { error: tableError.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      user: tableData,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to create user' },
      { status: 500 }
    )
  }
}

