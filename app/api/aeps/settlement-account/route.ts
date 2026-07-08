import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { verifyBankAccount } from '@/services/payout/verifyAccount'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET /api/aeps/settlement-account
 * Returns the current user's AEPS settlement accounts.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user?.partner_id) {
      return NextResponse.json({ error: 'Session expired', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const supabase = getSupabase()
    const { data: accounts, error } = await supabase
      .from('aeps_settlement_accounts')
      .select('*')
      .eq('user_id', user.partner_id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[AEPS Settle Account] List error:', error)
      return NextResponse.json({ success: true, accounts: [] })
    }

    return NextResponse.json({ success: true, accounts: accounts || [] })
  } catch (err: any) {
    console.error('[AEPS Settle Account] GET error:', err)
    return NextResponse.json({ error: err.message || 'Failed to fetch accounts' }, { status: 500 })
  }
}

/**
 * POST /api/aeps/settlement-account
 * Step 1+2: Retailer adds bank account → system verifies via penny-drop → saved as pending_approval
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user?.partner_id) {
      return NextResponse.json({ error: 'Session expired', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    if (!['retailer', 'distributor', 'master_distributor', 'partner'].includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { account_number, ifsc_code, bank_name } = body

    if (!account_number || !ifsc_code) {
      return NextResponse.json({ error: 'account_number and ifsc_code are required' }, { status: 400 })
    }

    const normalizedAccount = account_number.toString().replace(/\s+/g, '').trim()
    const normalizedIfsc = ifsc_code.toString().replace(/\s+/g, '').trim().toUpperCase()

    if (!/^\d{9,18}$/.test(normalizedAccount)) {
      return NextResponse.json({ error: 'Invalid account number (9-18 digits)' }, { status: 400 })
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizedIfsc)) {
      return NextResponse.json({ error: 'Invalid IFSC format' }, { status: 400 })
    }

    const supabase = getSupabase()

    // Check duplicate
    const { data: existing } = await supabase
      .from('aeps_settlement_accounts')
      .select('id, admin_status')
      .eq('user_id', user.partner_id)
      .eq('account_number', normalizedAccount)
      .eq('ifsc_code', normalizedIfsc)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({
        error: 'This account is already registered',
        existing_status: existing.admin_status,
      }, { status: 409 })
    }

    // Step 2: Verify via penny-drop
    let verificationStatus: 'verified' | 'failed' = 'failed'
    let verifiedName: string | null = null
    let verificationRef: string | null = null

    try {
      const result = await verifyBankAccount({
        accountNumber: normalizedAccount,
        ifscCode: normalizedIfsc,
        bankName: bank_name || undefined,
      })

      if (result.success && result.is_valid) {
        verificationStatus = 'verified'
        verifiedName = result.account_holder_name || null
        verificationRef = result.reference_id || result.transaction_id || null
      }
    } catch (verifyErr) {
      console.error('[AEPS Settle Account] Verification error:', verifyErr)
    }

    if (verificationStatus === 'failed') {
      return NextResponse.json({
        error: 'Account verification failed. Please check bank details and try again.',
        verification_status: 'failed',
      }, { status: 400 })
    }

    // Step 3: Insert as pending_approval
    const { data: account, error: insertErr } = await supabase
      .from('aeps_settlement_accounts')
      .insert({
        user_id: user.partner_id,
        user_role: user.role,
        account_number: normalizedAccount,
        ifsc_code: normalizedIfsc,
        account_holder_name: verifiedName || bank_name || 'Account Holder',
        bank_name: bank_name || normalizedIfsc.substring(0, 4) + ' Bank',
        verification_status: 'verified',
        verified_account_name: verifiedName,
        verification_reference_id: verificationRef,
        verified_at: new Date().toISOString(),
        admin_status: 'pending_approval',
      })
      .select()
      .single()

    if (insertErr || !account) {
      console.error('[AEPS Settle Account] Insert error:', insertErr)
      return NextResponse.json({ error: 'Failed to save account' }, { status: 500 })
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'aeps_settlement_account_add',
      activity_category: 'aeps',
      activity_description: `Added AEPS settlement account (${normalizedIfsc}) — pending admin approval`,
      reference_id: account.id,
      reference_table: 'aeps_settlement_accounts',
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: 'Account verified and submitted for admin approval',
      account,
    })
  } catch (err: any) {
    console.error('[AEPS Settle Account] POST error:', err)
    return NextResponse.json({ error: err.message || 'Failed to add account' }, { status: 500 })
  }
}

/**
 * DELETE /api/aeps/settlement-account?id=<uuid>
 * Retailer can delete their own non-approved account (or any account).
 */
export async function DELETE(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user?.partner_id) {
      return NextResponse.json({ error: 'Session expired', code: 'SESSION_EXPIRED' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'Account id is required' }, { status: 400 })
    }

    const supabase = getSupabase()
    const { error } = await supabase
      .from('aeps_settlement_accounts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.partner_id)

    if (error) {
      console.error('[AEPS Settle Account] Delete error:', error)
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Account deleted' })
  } catch (err: any) {
    console.error('[AEPS Settle Account] DELETE error:', err)
    return NextResponse.json({ error: err.message || 'Failed to delete account' }, { status: 500 })
  }
}
