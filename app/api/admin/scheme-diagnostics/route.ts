/**
 * API: /api/admin/scheme-diagnostics
 * GET - Diagnose scheme resolution for a given retailer
 * 
 * Query params:
 *   user_id: retailer partner_id (required)
 *   amount: number (optional, for charge calculation test)
 *   transfer_mode: IMPS|NEFT (optional)
 *   category: string (optional)
 * 
 * Returns comprehensive diagnostic data about scheme resolution
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function GET(request: NextRequest) {
  try {
    // Admin auth check - try standard auth first, then service_role key check
    const { user: adminUser } = await getCurrentUserWithFallback(request)
    const isServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY && 
      request.headers.get('authorization') === `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    const adminKey = request.nextUrl.searchParams.get('admin_key')
    const isAdminKey = adminKey && adminKey === process.env.ADMIN_DIAGNOSTIC_KEY
    
    if (!isServiceRole && !isAdminKey && (!adminUser || adminUser.role !== 'admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('user_id')
    const amount = parseFloat(searchParams.get('amount') || '1000')
    const transferMode = searchParams.get('transfer_mode') || 'IMPS'
    const category = searchParams.get('category') || null

    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
    }

    const diagnostics: any = {
      user_id: userId,
      test_amount: amount,
      test_transfer_mode: transferMode,
      test_category: category,
      timestamp: new Date().toISOString(),
      steps: [],
    }

    // Step 1: Check if retailer exists
    const { data: retailer, error: retailerError } = await supabaseAdmin
      .from('retailers')
      .select('partner_id, name, email, distributor_id, master_distributor_id, business_name')
      .eq('partner_id', userId)
      .maybeSingle()

    diagnostics.steps.push({
      step: 1,
      name: 'Retailer Lookup',
      success: !!retailer,
      data: retailer ? {
        partner_id: retailer.partner_id,
        name: retailer.name,
        business_name: retailer.business_name,
        distributor_id: retailer.distributor_id,
        master_distributor_id: retailer.master_distributor_id,
      } : null,
      error: retailerError?.message || null,
    })

    if (!retailer) {
      diagnostics.conclusion = 'Retailer not found in database'
      return NextResponse.json(diagnostics)
    }

    const distributorId = retailer.distributor_id || null
    const mdId = retailer.master_distributor_id || null

    // Step 2: Check ALL scheme_mappings for this retailer (active or not)
    const { data: allMappings, error: mappingsError } = await supabaseAdmin
      .from('scheme_mappings')
      .select(`
        id, scheme_id, entity_id, entity_role, service_type, priority, status,
        effective_from, effective_to, assigned_by_id, assigned_by_role,
        created_at
      `)
      .eq('entity_id', userId)
      .order('status')
      .order('priority')

    diagnostics.steps.push({
      step: 2,
      name: 'All Scheme Mappings for Retailer',
      success: !mappingsError,
      count: allMappings?.length || 0,
      data: allMappings || [],
      error: mappingsError?.message || null,
    })

    // Step 3: For each active mapping, check the scheme details
    const activeMappings = (allMappings || []).filter((m: any) => m.status === 'active')
    const schemeDetails: any[] = []

    for (const mapping of activeMappings) {
      const { data: scheme, error: schemeError } = await supabaseAdmin
        .from('schemes')
        .select('id, name, scheme_type, service_scope, status, priority, effective_from, effective_to')
        .eq('id', mapping.scheme_id)
        .maybeSingle()

      const now = new Date()
      const mappingEffective = new Date(mapping.effective_from) <= now
      const mappingNotExpired = !mapping.effective_to || new Date(mapping.effective_to) > now
      const schemeActive = scheme?.status === 'active'
      const schemeEffective = scheme ? new Date(scheme.effective_from) <= now : false
      const schemeNotExpired = scheme ? (!scheme.effective_to || new Date(scheme.effective_to) > now) : false

      // Check service_type matching
      const bbpsMatch = !mapping.service_type || mapping.service_type === 'bbps' || mapping.service_type === 'all'
      const payoutMatch = !mapping.service_type || mapping.service_type === 'payout' || mapping.service_type === 'all'

      // Fetch BBPS slabs for this scheme
      const { data: bbpsSlabs } = await supabaseAdmin
        .from('scheme_bbps_commissions')
        .select('*')
        .eq('scheme_id', mapping.scheme_id)
        .eq('status', 'active')
        .order('min_amount')

      // Fetch payout slabs for this scheme
      const { data: payoutSlabs } = await supabaseAdmin
        .from('scheme_payout_charges')
        .select('*')
        .eq('scheme_id', mapping.scheme_id)
        .eq('status', 'active')
        .order('transfer_mode')
        .order('min_amount')

      schemeDetails.push({
        mapping_id: mapping.id,
        mapping_service_type: mapping.service_type,
        mapping_effective: mappingEffective,
        mapping_not_expired: mappingNotExpired,
        scheme: scheme,
        scheme_active: schemeActive,
        scheme_effective: schemeEffective,
        scheme_not_expired: schemeNotExpired,
        bbps_service_type_match: bbpsMatch,
        payout_service_type_match: payoutMatch,
        bbps_slabs: bbpsSlabs || [],
        payout_slabs: payoutSlabs || [],
        would_resolve_bbps: mappingEffective && mappingNotExpired && schemeActive && schemeEffective && schemeNotExpired && bbpsMatch,
        would_resolve_payout: mappingEffective && mappingNotExpired && schemeActive && schemeEffective && schemeNotExpired && payoutMatch,
        error: schemeError?.message || null,
      })
    }

    diagnostics.steps.push({
      step: 3,
      name: 'Scheme Details for Active Mappings',
      count: schemeDetails.length,
      data: schemeDetails,
    })

    // Step 4: Test resolve_scheme_for_user RPC
    const rpcTests: any = {}

    for (const serviceType of ['bbps', 'payout', 'all']) {
      try {
        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('resolve_scheme_for_user', {
          p_user_id: userId,
          p_user_role: 'retailer',
          p_service_type: serviceType,
          p_distributor_id: distributorId,
          p_md_id: mdId,
        })

        rpcTests[serviceType] = {
          success: !rpcError && rpcResult && rpcResult.length > 0,
          result: rpcResult || [],
          error: rpcError?.message || null,
        }
      } catch (err: any) {
        rpcTests[serviceType] = {
          success: false,
          result: [],
          error: err.message,
        }
      }
    }

    diagnostics.steps.push({
      step: 4,
      name: 'resolve_scheme_for_user RPC Tests',
      data: rpcTests,
    })

    // Step 5: Test charge calculation if scheme was resolved
    const chargeTests: any = {}

    if (rpcTests.bbps?.success && rpcTests.bbps.result.length > 0) {
      const schemeId = rpcTests.bbps.result[0].scheme_id
      try {
        const { data: chargeResult, error: chargeError } = await supabaseAdmin.rpc('calculate_bbps_charge_from_scheme', {
          p_scheme_id: schemeId,
          p_amount: amount,
          p_category: category,
        })

        chargeTests.bbps = {
          scheme_id: schemeId,
          amount: amount,
          category: category,
          success: !chargeError,
          result: chargeResult || [],
          error: chargeError?.message || null,
        }
      } catch (err: any) {
        chargeTests.bbps = { success: false, error: err.message }
      }
    } else {
      chargeTests.bbps = { success: false, error: 'No scheme resolved for BBPS' }
    }

    if (rpcTests.payout?.success && rpcTests.payout.result.length > 0) {
      const schemeId = rpcTests.payout.result[0].scheme_id
      try {
        const { data: chargeResult, error: chargeError } = await supabaseAdmin.rpc('calculate_payout_charge_from_scheme', {
          p_scheme_id: schemeId,
          p_amount: amount,
          p_transfer_mode: transferMode,
        })

        chargeTests.payout = {
          scheme_id: schemeId,
          amount: amount,
          transfer_mode: transferMode,
          success: !chargeError,
          result: chargeResult || [],
          error: chargeError?.message || null,
        }
      } catch (err: any) {
        chargeTests.payout = { success: false, error: err.message }
      }
    } else {
      chargeTests.payout = { success: false, error: 'No scheme resolved for Payout' }
    }

    diagnostics.steps.push({
      step: 5,
      name: 'Charge Calculation Tests',
      data: chargeTests,
    })

    // Step 6: Direct table query fallback test (bypasses RPC entirely)
    const directQueryTests: any = {}

    try {
      // Direct BBPS charge lookup
      const { data: directBbps, error: directBbpsError } = await supabaseAdmin
        .from('scheme_mappings')
        .select(`
          scheme_id,
          service_type,
          status,
          effective_from,
          effective_to,
          scheme:schemes!inner (
            id, name, scheme_type, status, effective_from, effective_to,
            bbps_commissions:scheme_bbps_commissions (
              id, category, min_amount, max_amount, retailer_charge, retailer_charge_type, status
            )
          )
        `)
        .eq('entity_id', userId)
        .eq('entity_role', 'retailer')
        .eq('status', 'active')
        .order('priority', { ascending: true })
        .limit(5)

      directQueryTests.bbps_direct = {
        success: !directBbpsError,
        count: directBbps?.length || 0,
        data: directBbps || [],
        error: directBbpsError?.message || null,
      }
    } catch (err: any) {
      directQueryTests.bbps_direct = { success: false, error: err.message }
    }

    diagnostics.steps.push({
      step: 6,
      name: 'Direct Table Query Tests (bypass RPC)',
      data: directQueryTests,
    })

    // Step 7: Check DB function security type
    try {
      const { data: funcInfo, error: funcError } = await supabaseAdmin.rpc('check_function_security' as any)
      diagnostics.steps.push({
        step: 7,
        name: 'Function Security Check (may not exist)',
        data: funcInfo || null,
        error: funcError?.message || 'check_function_security RPC does not exist - run PRODUCTION-FIX-V2 SQL',
      })
    } catch {
      diagnostics.steps.push({
        step: 7,
        name: 'Function Security Check',
        data: null,
        error: 'Could not check function security type - this is OK',
      })
    }

    // Conclusion
    const bbpsResolved = rpcTests.bbps?.success
    const payoutResolved = rpcTests.payout?.success
    const bbpsChargeOk = chargeTests.bbps?.success && chargeTests.bbps?.result?.length > 0 && parseFloat(chargeTests.bbps.result[0]?.retailer_charge) > 0
    const payoutChargeOk = chargeTests.payout?.success && chargeTests.payout?.result?.length > 0 && parseFloat(chargeTests.payout.result[0]?.retailer_charge) > 0

    const issues: string[] = []
    if (!bbpsResolved) issues.push('BBPS scheme resolution FAILED - resolve_scheme_for_user returns empty')
    if (!payoutResolved) issues.push('Payout scheme resolution FAILED - resolve_scheme_for_user returns empty')
    if (bbpsResolved && !bbpsChargeOk) issues.push('BBPS charge calculation returned 0 - check BBPS slabs match amount/category')
    if (payoutResolved && !payoutChargeOk) issues.push('Payout charge calculation returned 0 - check payout slabs match amount/transfer_mode')
    if (activeMappings.length === 0) issues.push('No ACTIVE scheme mappings found for this retailer')
    if (schemeDetails.length > 0 && !schemeDetails.some((s: any) => s.would_resolve_bbps)) {
      issues.push('No scheme mapping passes all conditions for BBPS (check dates, status, service_type)')
    }
    if (schemeDetails.length > 0 && !schemeDetails.some((s: any) => s.would_resolve_payout)) {
      issues.push('No scheme mapping passes all conditions for Payout (check dates, status, service_type)')
    }

    diagnostics.conclusion = {
      bbps_working: bbpsResolved && bbpsChargeOk,
      payout_working: payoutResolved && payoutChargeOk,
      issues: issues.length > 0 ? issues : ['All checks passed - scheme resolution working correctly'],
      fix_suggestion: !bbpsResolved || !payoutResolved
        ? 'Run PRODUCTION-FIX-V2-RUN-IN-SUPABASE.sql in Supabase SQL Editor to fix SECURITY DEFINER. If already run, check scheme_mappings dates and status.'
        : bbpsResolved && !bbpsChargeOk
          ? 'Scheme resolves but charge slabs don\'t match. Check min_amount/max_amount/category in scheme_bbps_commissions.'
          : payoutResolved && !payoutChargeOk
            ? 'Scheme resolves but payout slabs don\'t match. Check min_amount/max_amount/transfer_mode in scheme_payout_charges.'
            : 'Everything looks correct. Check browser console logs for frontend errors.',
    }

    return NextResponse.json(diagnostics)
  } catch (err: any) {
    console.error('[Scheme Diagnostics]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

