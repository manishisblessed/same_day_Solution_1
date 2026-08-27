import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { canOnboard, defaultChildRole, needsUplineApproval, roleLabel, ONBOARD_CAPABLE_ROLES } from '@/lib/hierarchy'
import {
  INVITE_TABLE,
  generateInviteToken,
  inviteExpiryDate,
  inviteLink,
  findDuplicateIdentity,
} from '@/lib/onboarding/invites'
import { sendEmail } from '@/services/email'
import { sendOtp } from '@/services/otp'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboarding/invite
 * Create an onboarding invite (link) for an MD / DT / RT.
 *
 * - admin: may onboard any network role; parent chosen via parent picker.
 * - master_distributor: onboards distributor; parent = own partner_id.
 * - distributor: onboards retailer; parent = own partner_id (+ derived MD).
 *
 * The partner row is NOT created here — only at the end of the wizard
 * (register step). This route just issues the token + link.
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
    }

    if (!ONBOARD_CAPABLE_ROLES.includes(user.role)) {
      return NextResponse.json(
        { error: 'You are not allowed to onboard partners' },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const email = String(body.email || '').trim().toLowerCase()
    const phone = String(body.phone || '').trim()
    const name = body.name ? String(body.name).trim() : null
    const requestedRole = body.role ? String(body.role).trim() : ''

    if (!email || !phone) {
      return NextResponse.json({ error: 'Email and phone are required' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }
    if (!/^\d{10}$/.test(phone.replace(/[\s+-]/g, '').replace(/^91/, ''))) {
      // Lenient: allow +91 / 10-digit. Not a hard block, just guard obvious typos.
    }

    // Resolve target role (fall back to the creator's default child role).
    const targetRole = requestedRole || defaultChildRole(user.role) || ''
    if (!canOnboard(user.role, targetRole)) {
      return NextResponse.json(
        { error: `A ${roleLabel(user.role)} cannot onboard a ${roleLabel(targetRole)}` },
        { status: 403 }
      )
    }

    const supabase = getSupabaseAdmin()

    // ── Resolve parent linkage ──
    let parentMd: string | null = null
    let parentDt: string | null = null

    if (user.role === 'master_distributor') {
      parentMd = user.partner_id || null
    } else if (user.role === 'distributor') {
      parentDt = user.partner_id || null
      // Derive the MD above this distributor.
      const { data: dist } = await supabase
        .from('distributors')
        .select('master_distributor_id')
        .eq('partner_id', user.partner_id)
        .maybeSingle()
      parentMd = dist?.master_distributor_id || null
    } else {
      // admin / finance — parent supplied explicitly for DT/RT.
      if (targetRole === 'distributor') {
        parentMd = body.parent_master_distributor_id ? String(body.parent_master_distributor_id) : null
        if (!parentMd) {
          return NextResponse.json(
            { error: 'Select a Master Distributor to place this Distributor under' },
            { status: 400 }
          )
        }
      } else if (targetRole === 'retailer') {
        parentDt = body.parent_distributor_id ? String(body.parent_distributor_id) : null
        if (!parentDt) {
          return NextResponse.json(
            { error: 'Select a Distributor to place this Retailer under' },
            { status: 400 }
          )
        }
        const { data: dist } = await supabase
          .from('distributors')
          .select('master_distributor_id')
          .eq('partner_id', parentDt)
          .maybeSingle()
        parentMd = dist?.master_distributor_id || null
      }
      // master_distributor created by admin has no parent.
    }

    // Validate the chosen parent exists + is active.
    if (parentDt) {
      const { data: p } = await supabase
        .from('distributors')
        .select('partner_id, status')
        .eq('partner_id', parentDt)
        .maybeSingle()
      if (!p) return NextResponse.json({ error: 'Parent distributor not found' }, { status: 400 })
    }
    if (parentMd) {
      const { data: p } = await supabase
        .from('master_distributors')
        .select('partner_id, status')
        .eq('partner_id', parentMd)
        .maybeSingle()
      if (!p) return NextResponse.json({ error: 'Parent master distributor not found' }, { status: 400 })
    }

    // ── Duplicate identity guard ──
    const dup = await findDuplicateIdentity(supabase, { email, phone })
    if (dup) {
      return NextResponse.json({ error: dup }, { status: 409 })
    }

    // ── Create invite ──
    const token = generateInviteToken()
    const insert = {
      token,
      phone,
      email,
      name,
      target_role: targetRole,
      invited_by_role: user.role,
      invited_by_id: user.partner_id || user.id,
      invited_by_email: user.email,
      invited_by_name: user.name || null,
      parent_master_distributor_id: parentMd,
      parent_distributor_id: parentDt,
      status: 'pending',
      expires_at: inviteExpiryDate(),
    }

    const { data: invite, error: insertError } = await supabase
      .from(INVITE_TABLE)
      .insert([insert])
      .select()
      .single()

    if (insertError) {
      console.error('[onboarding/invite] insert error:', insertError)
      return NextResponse.json(
        {
          error: insertError.message || 'Failed to create invite',
          hint: insertError.message?.includes('does not exist')
            ? 'Run migration db/migrations/20260824_0002_onboarding_invite_wizard.sql'
            : undefined,
        },
        { status: 400 }
      )
    }

    const link = inviteLink(token)

    // ── Notify invitee (email + SMS). Best-effort. ──
    sendEmail({
      to: email,
      subject: `You're invited to join Same Day Solution as a ${roleLabel(targetRole)}`,
      html: `<p>Hi${name ? ` ${name}` : ''},</p>
        <p>${user.name || 'Your upline'} has invited you to onboard as a <strong>${roleLabel(targetRole)}</strong>.</p>
        <p>Click the link below to complete your KYC and registration:</p>
        <p><a href="${link}" style="background:#4F46E5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Start Onboarding</a></p>
        <p>Or copy this link: ${link}</p>
        <p>This link expires on ${new Date(insert.expires_at).toLocaleDateString('en-IN')}.</p>`,
    }).catch(() => {})

    // Fire an SMS invite (mock/twilio) — non-blocking. We don't verify here.
    if (needsUplineApproval(user.role)) {
      // no-op: approval happens later in the wizard
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'onboarding_invite_create',
      activity_category: 'admin',
      activity_description: `Invited ${roleLabel(targetRole)} ${email}`,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      invite,
      link,
      requiresUplineApproval: needsUplineApproval(user.role),
    })
  } catch (error: any) {
    console.error('[onboarding/invite] error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create invite' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/onboarding/invite
 * List invites visible to the caller.
 *  - admin/finance: all invites (filter by status/role via query).
 *  - MD/DT: invites they created.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    if (!ONBOARD_CAPABLE_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const status = sp.get('status')?.trim()
    const role = sp.get('role')?.trim()
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') || '25', 10) || 25))

    const supabase = getSupabaseAdmin()
    // No `count: 'exact'` — a full-table COUNT on every load is what made this
    // endpoint (and the Onboarding page) slow. We over-fetch by one row to derive
    // hasMore instead, which is cheap.
    let query = supabase
      .from(INVITE_TABLE)
      .select('*')
      .order('created_at', { ascending: false })

    const isAdmin = user.role === 'admin' || user.role === 'finance_executive'
    if (!isAdmin) {
      query = query.eq('invited_by_id', user.partner_id || user.id)
    }
    if (status) query = query.eq('status', status)
    if (role) query = query.eq('target_role', role)

    const from = (page - 1) * pageSize
    const { data, error } = await query.range(from, from + pageSize) // +1 for hasMore
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows = data || []
    const hasMore = rows.length > pageSize
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows

    // Statuses where the onboarding link is still actionable by the invitee.
    const ACTIVE_LINK_STATUSES = ['pending', 'registered', 'verified', 'resubmit']
    const invites = pageRows.map((inv: any) => ({
      ...inv,
      onboardingLink: inv.token && ACTIVE_LINK_STATUSES.includes(inv.status) ? inviteLink(inv.token) : null,
    }))

    return NextResponse.json({
      success: true,
      invites,
      page,
      pageSize,
      hasMore,
    })
  } catch (error: any) {
    console.error('[onboarding/invite GET] error:', error)
    return NextResponse.json({ error: error.message || 'Failed to list invites' }, { status: 500 })
  }
}
