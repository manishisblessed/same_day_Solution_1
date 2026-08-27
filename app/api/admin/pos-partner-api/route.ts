import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner } from '@/lib/partner-access'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { parsePartnerKeyPermissions } from '@/lib/partner-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isPrivateUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    const hostname = url.hostname.toLowerCase()

    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      hostname.startsWith('fd') ||
      hostname.startsWith('fc') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    ) {
      return true
    }

    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      return true
    }

    return false
  } catch {
    return true
  }
}

function generateApiKey(prefix = 'pk_live_') {
  return prefix + crypto.randomBytes(24).toString('hex')
}
function generateApiSecret(prefix = 'sk_live_') {
  return prefix + crypto.randomBytes(32).toString('hex')
}
function generateWebhookSecret() {
  return 'whsec_' + crypto.randomBytes(32).toString('hex')
}

/** Event categories a webhook endpoint may subscribe to. */
const WEBHOOK_EVENT_CATEGORIES = ['pos', 'settlement', 'payout', 'rechargekit'] as const

/** Validate + normalize a webhook events array. Returns categories or an error. */
function normalizeWebhookEvents(events: unknown): { events?: string[]; error?: string } {
  if (!Array.isArray(events) || events.length === 0) {
    return { error: 'events must be a non-empty array (pos, settlement, payout, rechargekit)' }
  }
  const raw = events.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
  const invalid = raw.filter((e) => !WEBHOOK_EVENT_CATEGORIES.includes(e as any))
  if (invalid.length > 0) {
    return { error: `Invalid event(s): ${invalid.join(', ')}. Allowed: ${WEBHOOK_EVENT_CATEGORIES.join(', ')}` }
  }
  return { events: Array.from(new Set(raw)) }
}

/** Validate a webhook URL (format + public address). Returns an error or null. */
function validateWebhookUrl(url: string): string | null {
  try {
    new URL(url)
  } catch {
    return 'Invalid URL format'
  }
  if (isPrivateUrl(url)) {
    return 'Invalid webhook URL: private/internal addresses are not allowed'
  }
  return null
}

/**
 * GET /api/admin/pos-partner-api
 * List all POS API partners with their API keys (masked secrets)
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
    
    // Log authentication details for debugging
    console.log('[POS Partner API] Auth method:', method)
    console.log('[POS Partner API] User:', user ? { id: user.id, email: user.email, role: user.role } : 'null')
    
    if (!user) {
      console.error('[POS Partner API] No user found - authentication failed')
      return NextResponse.json({ 
        error: 'Authentication required. Please log in again.',
        code: 'AUTH_REQUIRED'
      }, { status: 401 })
    }

    const access = authorizeSubPartner(user, 'api-management')
    if (!access.ok) return access.response

    const isAdmin = user.role === 'admin'
    const isPartner = user.role === 'partner' && user.partner_id
    if (!isAdmin && !isPartner) {
      console.error('[POS Partner API] User is not admin or partner:', user.role)
      return NextResponse.json({
        error: 'Access denied. Admin or partner login required.',
        code: 'FORBIDDEN',
      }, { status: 403 })
    }

    let partnersQuery = supabase.from('partners').select('*').order('created_at', { ascending: false })
    if (isPartner) {
      partnersQuery = partnersQuery.eq('id', user.partner_id)
    }
    const { data: partners, error } = await partnersQuery

    if (error) throw error

    let keysQuery = supabase
      .from('partner_api_keys')
      .select('id, partner_id, api_key, api_secret, label, permissions, is_active, expires_at, last_used_at, created_at')
      .order('created_at', { ascending: false })
    if (isPartner) {
      keysQuery = keysQuery.eq('partner_id', user.partner_id)
    }
    const { data: apiKeys, error: keysError } = await keysQuery

    if (keysError) throw keysError

    let exportLimitsQuery = supabase.from('partner_export_limits').select('*')
    if (isPartner) {
      exportLimitsQuery = exportLimitsQuery.eq('partner_id', user.partner_id)
    }
    const { data: exportLimits } = await exportLimitsQuery

    let merchantLinksQuery = supabase
      .from('partner_merchant_links')
      .select('partner_id, merchant_id, is_active, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    if (isPartner) {
      merchantLinksQuery = merchantLinksQuery.eq('partner_id', user.partner_id)
    }
    const { data: merchantLinks } = await merchantLinksQuery

    let webhooksQuery = supabase
      .from('partner_webhooks')
      .select('id, partner_id, url, events, label, is_active, created_at, updated_at')
      .order('created_at', { ascending: true })
    if (isPartner) {
      webhooksQuery = webhooksQuery.eq('partner_id', user.partner_id)
    }
    const { data: webhooks } = await webhooksQuery

    // Combine data
    const enrichedPartners = (partners || []).map((p: any) => {
      // Never expose the raw webhook signing secret in the list view — only a
      // masked hint. Use the rotate_webhook_secret action to reveal a new one.
      const { webhook_secret, ...partnerRest } = p
      const keys = (apiKeys || [])
        .filter((k: any) => k.partner_id === p.id)
        .map((k: any) => ({
          ...k,
          api_secret_masked: k.api_secret ? k.api_secret.substring(0, 12) + '••••••••' : null,
        }))
      const limits = (exportLimits || []).find((l: any) => l.partner_id === p.id)
      const linked_merchants = (merchantLinks || [])
        .filter((m: any) => m.partner_id === p.id)
        .map((m: any) => m.merchant_id)
      const partnerWebhooks = (webhooks || []).filter((w: any) => w.partner_id === p.id)
      return {
        ...partnerRest,
        webhook_secret_masked: webhook_secret ? webhook_secret.substring(0, 11) + '••••••••' : null,
        has_webhook_secret: !!webhook_secret,
        webhooks: partnerWebhooks,
        api_keys: keys,
        export_limit: limits?.daily_limit || 10,
        linked_merchants,
      }
    })

    return NextResponse.json({ success: true, data: enrichedPartners })
  } catch (error: any) {
    console.error('Error fetching POS partners:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

/** Permissions accepted on partner API keys (see /api/partner/* routes). */
const VALID_KEY_PERMISSIONS = ['read', 'export', 'bbps', 'bbps2', 'payout', 'settlement', 'aeps', 'rechargekit', 'all'] as const
const VALID_KEY_PERMISSIONS_SET: Record<string, true> = Object.fromEntries(
  VALID_KEY_PERMISSIONS.map((p) => [p, true])
) as any

function syncActiveKeyPermissions(
  supabase: any,
  partnerId: string,
  opts: { bbps?: boolean; bbps2?: boolean; settlement?: boolean; settlement2?: boolean; rechargekit?: boolean }
) {
  return (async () => {
    const { data: keys } = await supabase
      .from('partner_api_keys')
      .select('id, permissions')
      .eq('partner_id', partnerId)
      .eq('is_active', true)

    for (const key of (keys || []) as Array<{ id: string; permissions: any }>) {
      let perms = parsePartnerKeyPermissions(key.permissions)
      if (perms.includes('all')) continue

      if (opts.bbps === true && !perms.includes('bbps')) perms.push('bbps')
      if (opts.bbps === false) perms = perms.filter((p) => p !== 'bbps')

      if (opts.bbps2 === true && !perms.includes('bbps2')) perms.push('bbps2')
      if (opts.bbps2 === false) perms = perms.filter((p) => p !== 'bbps2')

      if (opts.settlement === true && !perms.includes('payout')) perms.push('payout')
      if (opts.settlement === false) perms = perms.filter((p) => p !== 'payout')

      if (opts.settlement2 === true && !perms.includes('settlement')) perms.push('settlement')
      if (opts.settlement2 === false) perms = perms.filter((p) => p !== 'settlement')

      if (opts.rechargekit === true && !perms.includes('rechargekit')) perms.push('rechargekit')
      if (opts.rechargekit === false) perms = perms.filter((p) => p !== 'rechargekit')

      if (!perms.includes('read')) perms.unshift('read')
      perms = Array.from(new Set(perms))

      await supabase
        .from('partner_api_keys')
        .update({ permissions: perms, updated_at: new Date().toISOString() })
        .eq('id', key.id)
    }
  })()
}

/**
 * POST /api/admin/pos-partner-api
 * Actions: generate_key, update_key_permissions, update_whitelist, update_status, update_export_limit, revoke_key
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user, method } = await getCurrentUserWithFallback(request)
    
    // Log authentication details for debugging
    console.log('[POS Partner API] Auth method:', method)
    console.log('[POS Partner API] User:', user ? { id: user.id, email: user.email, role: user.role } : 'null')
    
    if (!user) {
      console.error('[POS Partner API] No user found - authentication failed')
      return NextResponse.json({ 
        error: 'Authentication required. Please log in again.',
        code: 'AUTH_REQUIRED'
      }, { status: 401 })
    }

    const access = authorizeSubPartner(user, 'api-management')
    if (!access.ok) return access.response

    const isAdmin = user.role === 'admin'
    const isPartner = user.role === 'partner' && user.partner_id
    if (!isAdmin && !isPartner) {
      console.error('[POS Partner API] User is not admin or partner:', user.role)
      return NextResponse.json({
        error: 'Access denied. Admin or partner login required.',
        code: 'FORBIDDEN',
      }, { status: 403 })
    }

    const body = await request.json()
    const { action } = body

    const assertPartnerScope = (partnerId: string | undefined) => {
      if (isPartner && partnerId && partnerId !== user.partner_id) {
        return NextResponse.json({ error: 'You can only manage your own partner account' }, { status: 403 })
      }
      return null
    }

    switch (action) {

      // ─── GENERATE API KEY ───────────────────────────────
      case 'generate_key': {
        let { partner_id, label = 'default', permissions = ['read', 'export'] } = body
        if (isPartner) {
          partner_id = user.partner_id
          // Partners cannot self-issue keys with money-moving permissions.
          const PRIVILEGED_PERMS = new Set(['all', 'payout', 'settlement'])
          const requested = Array.isArray(permissions) ? permissions.map((p: unknown) => String(p).toLowerCase()) : []
          if (requested.some((p: string) => PRIVILEGED_PERMS.has(p))) {
            return NextResponse.json(
              { error: 'Only an administrator can issue keys with payout/settlement permissions.' },
              { status: 403 }
            )
          }
        }
        if (!partner_id) {
          return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
        }
        const scopeErr = assertPartnerScope(partner_id)
        if (scopeErr) return scopeErr

        // Verify partner exists
        const { data: partner, error: pErr } = await supabase
          .from('partners')
          .select('id, name')
          .eq('id', partner_id)
          .single()
        if (pErr || !partner) {
          return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
        }

        const apiKey = generateApiKey()
        const apiSecret = generateApiSecret()

        const { data: keyRecord, error: kErr } = await supabase
          .from('partner_api_keys')
          .insert({
            partner_id,
            api_key: apiKey,
            api_secret: apiSecret,
            label,
            permissions: JSON.stringify(permissions),
            is_active: true,
          })
          .select()
          .single()

        if (kErr) throw kErr

        return NextResponse.json({
          success: true,
          message: 'API key generated. Save the secret — it cannot be retrieved again.',
          data: {
            key_id: keyRecord.id,
            api_key: apiKey,
            api_secret: apiSecret,
            label,
            partner_name: partner.name,
          },
        })
      }

      // ─── UPDATE KEY PERMISSIONS (e.g. enable payout for Payout Partner API) ─
      case 'update_key_permissions': {
        const { key_id, permissions } = body
        if (!key_id) {
          return NextResponse.json({ error: 'key_id is required' }, { status: 400 })
        }
        if (!Array.isArray(permissions) || permissions.length === 0) {
          return NextResponse.json({ error: 'permissions must be a non-empty array' }, { status: 400 })
        }

        const raw = permissions.map((p: unknown) => String(p).trim().toLowerCase()).filter(Boolean)
        const invalid = raw.filter((p: string) => !VALID_KEY_PERMISSIONS_SET[p])
        if (invalid.length > 0) {
          return NextResponse.json(
            { error: `Invalid permission(s): ${invalid.join(', ')}. Allowed: ${VALID_KEY_PERMISSIONS.join(', ')}` },
            { status: 400 }
          )
        }

        const normalized = raw.includes('all') ? ['all'] : Array.from(new Set(raw))

        // Partners may NOT self-grant privileged (money-moving) permissions —
        // only an admin can enable payout/settlement/all on a key.
        const PRIVILEGED_PERMS = new Set(['all', 'payout', 'settlement'])
        if (isPartner && normalized.some((p: string) => PRIVILEGED_PERMS.has(p))) {
          return NextResponse.json(
            { error: 'Only an administrator can grant payout/settlement permissions. Contact support.' },
            { status: 403 }
          )
        }

        const { data: existing, error: findErr } = await supabase
          .from('partner_api_keys')
          .select('id, api_key, partner_id')
          .eq('id', key_id)
          .maybeSingle()

        if (findErr || !existing) {
          return NextResponse.json({ error: 'API key not found' }, { status: 404 })
        }
        if (isPartner && existing.partner_id !== user.partner_id) {
          return NextResponse.json({ error: 'API key not found' }, { status: 404 })
        }

        const { error: upErr } = await supabase
          .from('partner_api_keys')
          .update({
            permissions: normalized,
            updated_at: new Date().toISOString(),
          })
          .eq('id', key_id)

        if (upErr) throw upErr

        return NextResponse.json({
          success: true,
          message: 'API key permissions updated',
          data: { key_id, api_key: existing.api_key, permissions: normalized },
        })
      }

      // ─── UPDATE PARTNER SERVICES (BBPS / Settlement) ─────
      case 'update_partner_services': {
        if (isPartner) {
          return NextResponse.json({ error: 'Only administrators can change partner services' }, { status: 403 })
        }
        const { partner_id, bbps_enabled, bbps2_pay2new_enabled, credit_card1_plus_enabled, settlement_enabled, settlement2_enabled, aeps_enabled, rechargekit_cc_enabled } = body
        if (!partner_id) {
          return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
        }
        if (bbps_enabled === undefined && bbps2_pay2new_enabled === undefined && credit_card1_plus_enabled === undefined && settlement_enabled === undefined && settlement2_enabled === undefined && aeps_enabled === undefined && rechargekit_cc_enabled === undefined) {
          return NextResponse.json(
            { error: 'At least one service flag is required (bbps_enabled, bbps2_pay2new_enabled, credit_card1_plus_enabled, settlement_enabled, settlement2_enabled, aeps_enabled, rechargekit_cc_enabled)' },
            { status: 400 }
          )
        }

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (typeof bbps_enabled === 'boolean') updates.bbps_enabled = bbps_enabled
        if (typeof bbps2_pay2new_enabled === 'boolean') updates.bbps2_pay2new_enabled = bbps2_pay2new_enabled
        if (typeof credit_card1_plus_enabled === 'boolean') updates.credit_card1_plus_enabled = credit_card1_plus_enabled
        if (typeof settlement_enabled === 'boolean') updates.settlement_enabled = settlement_enabled
        if (typeof settlement2_enabled === 'boolean') updates.settlement2_enabled = settlement2_enabled
        if (typeof aeps_enabled === 'boolean') updates.aeps_enabled = aeps_enabled
        if (typeof rechargekit_cc_enabled === 'boolean') updates.rechargekit_cc_enabled = rechargekit_cc_enabled

        const { error: svcErr } = await supabase.from('partners').update(updates).eq('id', partner_id)
        if (svcErr) throw svcErr

        await syncActiveKeyPermissions(supabase, partner_id, {
          bbps: typeof bbps_enabled === 'boolean' ? bbps_enabled : undefined,
          bbps2: typeof bbps2_pay2new_enabled === 'boolean' ? bbps2_pay2new_enabled : undefined,
          settlement: typeof settlement_enabled === 'boolean' ? settlement_enabled : undefined,
          settlement2: typeof settlement2_enabled === 'boolean' ? settlement2_enabled : undefined,
          rechargekit: typeof rechargekit_cc_enabled === 'boolean' ? rechargekit_cc_enabled : undefined,
        })

        return NextResponse.json({
          success: true,
          message: 'Partner API services updated',
          data: { partner_id, bbps_enabled, bbps2_pay2new_enabled, credit_card1_plus_enabled, settlement_enabled, settlement2_enabled, rechargekit_cc_enabled },
        })
      }

      // ─── UPDATE IP WHITELIST ────────────────────────────
      case 'update_whitelist': {
        let { partner_id, ip_whitelist } = body
        if (isPartner) {
          partner_id = user.partner_id
        }
        if (!partner_id) {
          return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
        }
        const wlScope = assertPartnerScope(partner_id)
        if (wlScope) return wlScope

        // Validate IPs
        const ips = Array.isArray(ip_whitelist) ? ip_whitelist : []
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/
        const invalidIps = ips.filter((ip: string) => !ipRegex.test(ip))
        if (invalidIps.length > 0) {
          return NextResponse.json({ error: `Invalid IP addresses: ${invalidIps.join(', ')}` }, { status: 400 })
        }

        const { error: uErr } = await supabase
          .from('partners')
          .update({ ip_whitelist: ips, updated_at: new Date().toISOString() })
          .eq('id', partner_id)

        if (uErr) throw uErr

        return NextResponse.json({
          success: true,
          message: `IP whitelist updated with ${ips.length} IP(s)`,
          data: { partner_id, ip_whitelist: ips },
        })
      }

      // ─── UPDATE PARTNER STATUS ──────────────────────────
      case 'update_status': {
        if (isPartner) {
          return NextResponse.json({ error: 'Only administrators can change partner status' }, { status: 403 })
        }
        const { partner_id, status } = body
        if (!partner_id || !status) {
          return NextResponse.json({ error: 'partner_id and status required' }, { status: 400 })
        }
        if (!['active', 'inactive', 'suspended'].includes(status)) {
          return NextResponse.json({ error: 'Status must be: active, inactive, suspended' }, { status: 400 })
        }

        const { error: sErr } = await supabase
          .from('partners')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', partner_id)

        if (sErr) throw sErr

        return NextResponse.json({ success: true, message: `Partner status updated to ${status}` })
      }

      // ─── UPDATE EXPORT LIMIT ────────────────────────────
      case 'update_export_limit': {
        if (isPartner) {
          return NextResponse.json({ error: 'Only administrators can change export limits' }, { status: 403 })
        }
        const { partner_id, daily_limit = 10 } = body
        if (!partner_id) {
          return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
        }

        const { error: eErr } = await supabase
          .from('partner_export_limits')
          .upsert({
            partner_id,
            daily_limit: Math.max(1, Math.min(100, daily_limit)),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'partner_id' })

        if (eErr) throw eErr

        return NextResponse.json({ success: true, message: `Daily export limit set to ${daily_limit}` })
      }

      // ─── UPDATE WEBHOOK URL ──────────────────────────────
      case 'update_webhook_url': {
        let { partner_id, webhook_url } = body
        if (isPartner) {
          partner_id = user.partner_id
        }
        if (!partner_id) {
          return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
        }
        const whScope = assertPartnerScope(partner_id)
        if (whScope) return whScope

        if (webhook_url && typeof webhook_url === 'string' && webhook_url.trim().length > 0) {
          try {
            new URL(webhook_url.trim())
          } catch {
            return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
          }
          if (isPrivateUrl(webhook_url.trim())) {
            return NextResponse.json({ error: 'Invalid webhook URL: private/internal addresses are not allowed' }, { status: 400 })
          }
        }

        const finalUrl = webhook_url && webhook_url.trim().length > 0 ? webhook_url.trim() : null

        const updatePayload: Record<string, unknown> = {
          webhook_url: finalUrl,
          updated_at: new Date().toISOString(),
        }

        // Auto-provision a signing secret the first time a URL is set so signed
        // delivery works immediately. Returned once here (and via rotate).
        let generatedSecret: string | null = null
        if (finalUrl) {
          const { data: existingP } = await supabase
            .from('partners')
            .select('webhook_secret')
            .eq('id', partner_id)
            .maybeSingle()
          if (!existingP?.webhook_secret) {
            generatedSecret = generateWebhookSecret()
            updatePayload.webhook_secret = generatedSecret
          }
        }

        const { error: wErr } = await supabase
          .from('partners')
          .update(updatePayload)
          .eq('id', partner_id)

        if (wErr) throw wErr

        return NextResponse.json({
          success: true,
          message: finalUrl ? `Webhook URL updated to ${finalUrl}` : 'Webhook URL removed',
          data: {
            partner_id,
            webhook_url: finalUrl,
            ...(generatedSecret
              ? {
                  webhook_secret: generatedSecret,
                  secret_note: 'Save this signing secret — it is shown only once. Share it securely with the partner.',
                }
              : {}),
          },
        })
      }

      // ─── UPDATE RECHARGEKIT (CC) WEBHOOK URL ─────────────
      case 'update_rechargekit_webhook_url': {
        let { partner_id, webhook_url } = body
        if (isPartner) {
          partner_id = user.partner_id
        }
        if (!partner_id) {
          return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
        }
        const rkScope = assertPartnerScope(partner_id)
        if (rkScope) return rkScope

        if (webhook_url && typeof webhook_url === 'string' && webhook_url.trim().length > 0) {
          try {
            new URL(webhook_url.trim())
          } catch {
            return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
          }
          if (isPrivateUrl(webhook_url.trim())) {
            return NextResponse.json({ error: 'Invalid webhook URL: private/internal addresses are not allowed' }, { status: 400 })
          }
        }

        const finalUrl = webhook_url && webhook_url.trim().length > 0 ? webhook_url.trim() : null

        const updatePayload: Record<string, unknown> = {
          rechargekit_webhook_url: finalUrl,
          updated_at: new Date().toISOString(),
        }

        // Reuse the same webhook_secret as POS callbacks. Auto-provision one if
        // the partner has none yet, so signed delivery works immediately.
        let generatedSecret: string | null = null
        if (finalUrl) {
          const { data: existingP } = await supabase
            .from('partners')
            .select('webhook_secret')
            .eq('id', partner_id)
            .maybeSingle()
          if (!existingP?.webhook_secret) {
            generatedSecret = generateWebhookSecret()
            updatePayload.webhook_secret = generatedSecret
          }
        }

        const { error: rkErr } = await supabase
          .from('partners')
          .update(updatePayload)
          .eq('id', partner_id)

        if (rkErr) throw rkErr

        return NextResponse.json({
          success: true,
          message: finalUrl ? `RechargeKit webhook URL updated to ${finalUrl}` : 'RechargeKit webhook URL removed',
          data: {
            partner_id,
            rechargekit_webhook_url: finalUrl,
            ...(generatedSecret
              ? {
                  webhook_secret: generatedSecret,
                  secret_note: 'Save this signing secret — it is shown only once. Share it securely with the partner.',
                }
              : {}),
          },
        })
      }

      // ─── ROTATE WEBHOOK SIGNING SECRET ───────────────────
      case 'rotate_webhook_secret': {
        let { partner_id } = body
        if (isPartner) {
          partner_id = user.partner_id
        }
        if (!partner_id) {
          return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
        }
        const rsScope = assertPartnerScope(partner_id)
        if (rsScope) return rsScope

        const newSecret = generateWebhookSecret()
        const { error: rsErr } = await supabase
          .from('partners')
          .update({ webhook_secret: newSecret, updated_at: new Date().toISOString() })
          .eq('id', partner_id)

        if (rsErr) throw rsErr

        return NextResponse.json({
          success: true,
          message: 'Webhook signing secret rotated. Save it — it is shown only once and old signatures will stop validating.',
          data: {
            partner_id,
            webhook_secret: newSecret,
            secret_note: 'Share this securely with the partner. It will not be shown again.',
          },
        })
      }

      // ─── ADD WEBHOOK ENDPOINT ────────────────────────────
      case 'add_webhook': {
        let { partner_id, url, events, label } = body
        if (isPartner) {
          partner_id = user.partner_id
        }
        if (!partner_id) {
          return NextResponse.json({ error: 'partner_id is required' }, { status: 400 })
        }
        const awScope = assertPartnerScope(partner_id)
        if (awScope) return awScope

        const cleanUrl = typeof url === 'string' ? url.trim() : ''
        if (!cleanUrl) {
          return NextResponse.json({ error: 'url is required' }, { status: 400 })
        }
        const urlErr = validateWebhookUrl(cleanUrl)
        if (urlErr) return NextResponse.json({ error: urlErr }, { status: 400 })

        const { events: normEvents, error: evErr } = normalizeWebhookEvents(events)
        if (evErr) return NextResponse.json({ error: evErr }, { status: 400 })

        // Auto-provision the shared signing secret the first time any endpoint is
        // added so signed delivery works immediately. One secret per partner.
        let generatedSecret: string | null = null
        const { data: existingP } = await supabase
          .from('partners')
          .select('webhook_secret')
          .eq('id', partner_id)
          .maybeSingle()
        if (!existingP?.webhook_secret) {
          generatedSecret = generateWebhookSecret()
          await supabase
            .from('partners')
            .update({ webhook_secret: generatedSecret, updated_at: new Date().toISOString() })
            .eq('id', partner_id)
        }

        const { data: created, error: awErr } = await supabase
          .from('partner_webhooks')
          .insert({
            partner_id,
            url: cleanUrl,
            events: normEvents,
            label: typeof label === 'string' && label.trim() ? label.trim() : null,
            is_active: true,
          })
          .select('id, partner_id, url, events, label, is_active, created_at, updated_at')
          .single()

        if (awErr) throw awErr

        return NextResponse.json({
          success: true,
          message: 'Webhook endpoint added',
          data: {
            webhook: created,
            ...(generatedSecret
              ? {
                  webhook_secret: generatedSecret,
                  secret_note: 'Save this signing secret — it is shown only once. It signs ALL of this partner\'s webhook endpoints.',
                }
              : {}),
          },
        })
      }

      // ─── UPDATE WEBHOOK ENDPOINT ─────────────────────────
      case 'update_webhook': {
        let { partner_id, webhook_id, url, events, label, is_active } = body
        if (isPartner) {
          partner_id = user.partner_id
        }
        if (!partner_id || !webhook_id) {
          return NextResponse.json({ error: 'partner_id and webhook_id are required' }, { status: 400 })
        }
        const uwScope = assertPartnerScope(partner_id)
        if (uwScope) return uwScope

        // Ownership: the webhook must belong to this partner.
        const { data: existingWh } = await supabase
          .from('partner_webhooks')
          .select('id, partner_id')
          .eq('id', webhook_id)
          .maybeSingle()
        if (!existingWh || existingWh.partner_id !== partner_id) {
          return NextResponse.json({ error: 'Webhook endpoint not found' }, { status: 404 })
        }

        const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() }

        if (url !== undefined) {
          const cleanUrl = typeof url === 'string' ? url.trim() : ''
          if (!cleanUrl) {
            return NextResponse.json({ error: 'url cannot be empty' }, { status: 400 })
          }
          const urlErr = validateWebhookUrl(cleanUrl)
          if (urlErr) return NextResponse.json({ error: urlErr }, { status: 400 })
          updatePayload.url = cleanUrl
        }

        if (events !== undefined) {
          const { events: normEvents, error: evErr } = normalizeWebhookEvents(events)
          if (evErr) return NextResponse.json({ error: evErr }, { status: 400 })
          updatePayload.events = normEvents
        }

        if (label !== undefined) {
          updatePayload.label = typeof label === 'string' && label.trim() ? label.trim() : null
        }

        if (typeof is_active === 'boolean') {
          updatePayload.is_active = is_active
        }

        const { data: updated, error: upWhErr } = await supabase
          .from('partner_webhooks')
          .update(updatePayload)
          .eq('id', webhook_id)
          .select('id, partner_id, url, events, label, is_active, created_at, updated_at')
          .single()

        if (upWhErr) throw upWhErr

        return NextResponse.json({ success: true, message: 'Webhook endpoint updated', data: { webhook: updated } })
      }

      // ─── DELETE WEBHOOK ENDPOINT ─────────────────────────
      case 'delete_webhook': {
        let { partner_id, webhook_id } = body
        if (isPartner) {
          partner_id = user.partner_id
        }
        if (!partner_id || !webhook_id) {
          return NextResponse.json({ error: 'partner_id and webhook_id are required' }, { status: 400 })
        }
        const dwScope = assertPartnerScope(partner_id)
        if (dwScope) return dwScope

        const { data: existingWh } = await supabase
          .from('partner_webhooks')
          .select('id, partner_id')
          .eq('id', webhook_id)
          .maybeSingle()
        if (!existingWh || existingWh.partner_id !== partner_id) {
          return NextResponse.json({ error: 'Webhook endpoint not found' }, { status: 404 })
        }

        const { error: delErr } = await supabase
          .from('partner_webhooks')
          .delete()
          .eq('id', webhook_id)

        if (delErr) throw delErr

        return NextResponse.json({ success: true, message: 'Webhook endpoint removed', data: { webhook_id } })
      }

      // ─── REVOKE API KEY ─────────────────────────────────
      case 'revoke_key': {
        const { key_id } = body
        if (!key_id) {
          return NextResponse.json({ error: 'key_id is required' }, { status: 400 })
        }

        if (isPartner) {
          const { data: row } = await supabase
            .from('partner_api_keys')
            .select('partner_id')
            .eq('id', key_id)
            .maybeSingle()
          if (!row || row.partner_id !== user.partner_id) {
            return NextResponse.json({ error: 'API key not found' }, { status: 404 })
          }
        }

        const { error: rErr } = await supabase
          .from('partner_api_keys')
          .update({ is_active: false })
          .eq('id', key_id)

        if (rErr) throw rErr

        return NextResponse.json({ success: true, message: 'API key revoked successfully' })
      }

      // ─── LINK MERCHANT TO PARTNER (Payout scoping) ──────
      case 'link_merchant': {
        let { partner_id, merchant_id } = body
        if (isPartner) {
          partner_id = user.partner_id
        }
        if (!partner_id || !merchant_id) {
          return NextResponse.json({ error: 'partner_id and merchant_id are required' }, { status: 400 })
        }
        const lmScope = assertPartnerScope(partner_id)
        if (lmScope) return lmScope

        const mid = String(merchant_id).trim()
        if (!mid) {
          return NextResponse.json({ error: 'merchant_id cannot be empty' }, { status: 400 })
        }

        // Verify partner exists
        const { data: lPartner } = await supabase
          .from('partners')
          .select('id, name')
          .eq('id', partner_id)
          .single()
        if (!lPartner) {
          return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
        }

        // Optionally verify retailer exists (warn but still allow pre-linking)
        const { data: retailer } = await supabase
          .from('retailers')
          .select('partner_id, name')
          .eq('partner_id', mid)
          .maybeSingle()

        const { error: linkErr } = await supabase
          .from('partner_merchant_links')
          .upsert(
            { partner_id, merchant_id: mid, is_active: true, updated_at: new Date().toISOString() },
            { onConflict: 'partner_id,merchant_id' }
          )

        if (linkErr) throw linkErr

        return NextResponse.json({
          success: true,
          message: retailer
            ? `Merchant "${retailer.name}" (${mid}) linked to partner "${lPartner.name}"`
            : `Merchant ${mid} linked to partner "${lPartner.name}" (retailer not yet onboarded — link saved for when they are)`,
          data: { partner_id, merchant_id: mid, retailer_exists: !!retailer },
        })
      }

      // ─── UNLINK MERCHANT FROM PARTNER ─────────────────────
      case 'unlink_merchant': {
        let { partner_id, merchant_id } = body
        if (isPartner) {
          partner_id = user.partner_id
        }
        if (!partner_id || !merchant_id) {
          return NextResponse.json({ error: 'partner_id and merchant_id are required' }, { status: 400 })
        }
        const umScope = assertPartnerScope(partner_id)
        if (umScope) return umScope

        const { error: ulErr } = await supabase
          .from('partner_merchant_links')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('partner_id', partner_id)
          .eq('merchant_id', String(merchant_id).trim())

        if (ulErr) throw ulErr

        return NextResponse.json({ success: true, message: `Merchant ${merchant_id} unlinked from partner` })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

  } catch (error: any) {
    console.error('Error in POS partner admin API:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

