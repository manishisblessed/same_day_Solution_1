/**
 * /api/knteer-payout/accounts
 *
 * Manages saved beneficiary accounts for Settlement-1 (Knteer).
 * Registration calls Knteer's /payout/v1/add-bene — free, no penny drop.
 * Accounts are cached in knteer_beneficiaries.
 *
 * GET    — list accounts for the current user
 * POST   — register new account via Knteer add-bene
 * DELETE — remove account (?id=<uuid>)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { normalizeMasterPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getOrCreateBeneCode } from '@/services/knteer-payout/beneficiary'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function OPTIONS(request: NextRequest) {
  const res = handleCorsPreflight(request)
  return res || new NextResponse(null, { status: 204 })
}

// ── GET — list accounts ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    normalizeMasterPartner(user)

    if (!user?.partner_id) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 }))
    }
    if (!['retailer', 'partner', 'admin'].includes(user.role || '')) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 }))
    }

    const { data, error } = await supabaseAdmin
      .from('knteer_beneficiaries')
      .select('id, account_number, ifsc_code, bene_name, bank_name, mobile, email, bene_code, is_active, created_at')
      .eq('retailer_id', user.partner_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[Knteer Accounts] List error:', error.message)
      return addCorsHeaders(request, NextResponse.json({ success: true, accounts: [] }))
    }

    // Map to the shape KnteerPayoutTransfer expects
    const accounts = (data || []).map(a => ({
      id: a.id,
      account_number: a.account_number,
      ifsc_code: a.ifsc_code,
      account_holder_name: a.bene_name,
      bank_name: a.bank_name || a.ifsc_code?.substring(0, 4),
      bene_code: a.bene_code,
      mobile: a.mobile,
      is_registered: true,
      created_at: a.created_at,
    }))

    return addCorsHeaders(request, NextResponse.json({ success: true, accounts }))
  } catch (err: any) {
    console.error('[Knteer Accounts] GET error:', err)
    return addCorsHeaders(request, NextResponse.json({ success: false, error: err.message }, { status: 500 }))
  }
}

// ── POST — register account via Knteer add-bene ───────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    normalizeMasterPartner(user)

    if (!user?.partner_id) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 }))
    }
    if (!['retailer', 'partner'].includes(user.role || '')) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 }))
    }

    const body = await request.json()
    const { account_number, ifsc_code, account_holder_name, bank_name, mobile, email } = body

    // Validate
    if (!account_number || account_number.length < 9) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Enter a valid account number (min 9 digits)' }, { status: 400 }))
    }
    if (!ifsc_code || !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifsc_code)) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Enter a valid IFSC code (e.g. SBIN0001234)' }, { status: 400 }))
    }
    const cleanName = (account_holder_name || '').trim().replace(/\s+/g, ' ')
    if (cleanName.length < 3) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Account holder name must be at least 3 characters' }, { status: 400 }))
    }
    if (!mobile || !/^[6-9]\d{9}$/.test(String(mobile))) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Enter a valid 10-digit mobile number' }, { status: 400 }))
    }

    // Check for existing account
    const { data: existing } = await supabaseAdmin
      .from('knteer_beneficiaries')
      .select('id, bene_code, bene_name')
      .eq('retailer_id', user.partner_id)
      .eq('account_number', account_number)
      .eq('ifsc_code', ifsc_code.toUpperCase())
      .eq('is_active', true)
      .maybeSingle()

    if (existing) {
      return addCorsHeaders(request, NextResponse.json({
        success: true,
        already_exists: true,
        message: 'This account is already registered.',
        account: {
          id: existing.id,
          account_number,
          ifsc_code: ifsc_code.toUpperCase(),
          account_holder_name: existing.bene_name,
          bene_code: existing.bene_code,
          is_registered: true,
        },
      }))
    }

    const derivedBankName = bank_name?.trim() || ifsc_code.substring(0, 4).toUpperCase()
    const derivedEmail = email?.trim() || `${user.partner_id}@knteer.bene`

    // Register with Knteer
    const result = await getOrCreateBeneCode(supabaseAdmin, user.partner_id, {
      accountNumber: account_number,
      ifsc: ifsc_code.toUpperCase(),
      beneName: cleanName,
      bankName: derivedBankName,
      mobile: String(mobile),
      email: derivedEmail,
    })

    if (!result.success || !result.beneCode) {
      return addCorsHeaders(request, NextResponse.json({
        success: false,
        error: result.error || 'Failed to register account with Knteer',
      }, { status: 502 }))
    }

    // Fetch the saved record
    const { data: saved } = await supabaseAdmin
      .from('knteer_beneficiaries')
      .select('id, account_number, ifsc_code, bene_name, bank_name, bene_code, created_at')
      .eq('retailer_id', user.partner_id)
      .eq('account_number', account_number)
      .eq('ifsc_code', ifsc_code.toUpperCase())
      .maybeSingle()

    return addCorsHeaders(request, NextResponse.json({
      success: true,
      account: {
        id: saved?.id,
        account_number,
        ifsc_code: ifsc_code.toUpperCase(),
        account_holder_name: cleanName,
        bank_name: derivedBankName,
        bene_code: result.beneCode,
        is_registered: true,
      },
    }))
  } catch (err: any) {
    console.error('[Knteer Accounts] POST error:', err)
    return addCorsHeaders(request, NextResponse.json({ success: false, error: err.message }, { status: 500 }))
  }
}

// ── DELETE — remove account ───────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    normalizeMasterPartner(user)

    if (!user?.partner_id) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 }))
    }

    const id = new URL(request.url).searchParams.get('id')
    if (!id) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'id required' }, { status: 400 }))
    }

    const { error } = await supabaseAdmin
      .from('knteer_beneficiaries')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('retailer_id', user.partner_id)

    if (error) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: error.message }, { status: 500 }))
    }

    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ success: false, error: err.message }, { status: 500 }))
  }
}
