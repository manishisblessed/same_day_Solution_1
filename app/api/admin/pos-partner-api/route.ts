import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function generateApiKey(prefix = 'pk_live_') {
  return prefix + crypto.randomBytes(24).toString('hex')
}
function generateApiSecret(prefix = 'sk_live_') {
  return prefix + crypto.randomBytes(32).toString('hex')
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

    // Combine data
    const enrichedPartners = (partners || []).map((p: any) => {
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
      return {
        ...p,
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
const VALID_KEY_PERMISSIONS = ['read', 'export', 'bbps', 'payout', 'all'] as const
const VALID_KEY_PERMISSIONS_SET: Record<string, true> = Object.fromEntries(
  VALID_KEY_PERMISSIONS.map((p) => [p, true])
) as any

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
        }

        const finalUrl = webhook_url && webhook_url.trim().length > 0 ? webhook_url.trim() : null

        const { error: wErr } = await supabase
          .from('partners')
          .update({ webhook_url: finalUrl, updated_at: new Date().toISOString() })
          .eq('id', partner_id)

        if (wErr) throw wErr

        return NextResponse.json({
          success: true,
          message: finalUrl ? `Webhook URL updated to ${finalUrl}` : 'Webhook URL removed',
          data: { partner_id, webhook_url: finalUrl },
        })
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

