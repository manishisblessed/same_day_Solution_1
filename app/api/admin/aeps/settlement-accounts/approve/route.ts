import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/aeps/settlement-accounts/approve
 * Step 4: Admin approves or rejects an AEPS settlement account.
 * Body: { account_id, action: 'approve' | 'reject', remarks? }
 */
export async function POST(request: NextRequest) {
  try {
    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const body = await request.json()
    const { account_id, action, remarks } = body

    if (!account_id || !action) {
      return NextResponse.json({ error: 'account_id and action are required' }, { status: 400 })
    }
    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 })
    }

    // Fetch account
    const { data: account, error: fetchErr } = await supabase
      .from('aeps_settlement_accounts')
      .select('*')
      .eq('id', account_id)
      .single()

    if (fetchErr || !account) {
      return NextResponse.json({ error: 'Settlement account not found' }, { status: 404 })
    }

    if (account.admin_status !== 'pending_approval') {
      return NextResponse.json({
        error: `Account is already ${account.admin_status}. Cannot ${action}.`,
      }, { status: 400 })
    }

    if (account.verification_status !== 'verified') {
      return NextResponse.json({
        error: 'Account has not been verified. Cannot approve an unverified account.',
      }, { status: 400 })
    }

    const now = new Date().toISOString()
    const updateData: Record<string, any> = {
      admin_status: action === 'approve' ? 'approved' : 'rejected',
      approved_by: admin.id,
      admin_remarks: remarks || null,
    }

    if (action === 'approve') {
      updateData.approved_at = now
    } else {
      updateData.rejected_at = now
    }

    const { data: updated, error: updateErr } = await supabase
      .from('aeps_settlement_accounts')
      .update(updateData)
      .eq('id', account_id)
      .select()
      .single()

    if (updateErr) {
      console.error('[Admin AEPS Account Approve] Update error:', updateErr)
      return NextResponse.json({ error: 'Failed to update account status' }, { status: 500 })
    }

    // Audit log (fire-and-forget)
    try {
      await supabase.from('admin_audit_log').insert({
        admin_id: admin.id,
        action_type: action === 'approve' ? 'aeps_settlement_account_approve' : 'aeps_settlement_account_reject',
        target_user_id: account.user_id,
        target_user_role: account.user_role,
        ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
        user_agent: request.headers.get('user-agent') || 'unknown',
        remarks: `AEPS settlement account ${action}d — A/C ***${account.account_number.slice(-4)} (${account.ifsc_code})${remarks ? '. Remarks: ' + remarks : ''}`,
        metadata: { account_id, action, ifsc: account.ifsc_code },
      })
    } catch {}

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, admin, {
      activity_type: `admin_aeps_settle_account_${action}`,
      activity_category: 'admin',
      activity_description: `${action === 'approve' ? 'Approved' : 'Rejected'} AEPS settlement account for ${account.user_id}`,
      reference_id: account_id,
      reference_table: 'aeps_settlement_accounts',
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: `Settlement account ${action}d successfully`,
      account: updated,
    })
  } catch (err: any) {
    console.error('[Admin AEPS Account Approve] Error:', err)
    return NextResponse.json({ error: err.message || 'Failed to process approval' }, { status: 500 })
  }
}
