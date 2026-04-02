import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/razorpay-transactions/fix-merchant-slugs
 *
 * One-time migration: scans razorpay_pos_transactions where merchant_slug is
 * 'ashvam' (or NULL) and re-detects the correct slug from the Ezetap username
 * stored in the row or inside raw_data.
 *
 * Only admin users may call this.  Dry-run by default; pass { "commit": true }
 * in the body to actually update rows.
 */
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin || admin.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const commit = body.commit === true

    // Build username → slug map from env
    const usernameToSlug: Record<string, string> = {}
    try {
      const raw = process.env.EZETAP_MERCHANT_CREDENTIALS_JSON?.trim()
      if (raw) {
        const creds = JSON.parse(raw) as Record<string, { username?: string }>
        for (const [slug, v] of Object.entries(creds)) {
          if (v?.username) usernameToSlug[String(v.username).trim()] = slug.toLowerCase()
        }
      }
    } catch { /* ignore */ }

    // Also check single-credential fallback
    const fallbackUser = process.env.EZETAP_USERNAME?.trim()
    const defSlug = process.env.EZETAP_DEFAULT_MERCHANT_SLUG?.trim().toLowerCase() || 'newscenaric'
    if (fallbackUser && !usernameToSlug[fallbackUser]) {
      usernameToSlug[fallbackUser] = defSlug
    }

    if (Object.keys(usernameToSlug).length === 0) {
      return NextResponse.json({
        error: 'No Ezetap credentials configured — cannot detect merchants',
        hint: 'Set EZETAP_MERCHANT_CREDENTIALS_JSON in env',
      }, { status: 400 })
    }

    // Fetch transactions with merchant_slug = ashvam or NULL (potential mis-attributed)
    const { data: candidates, error: fetchErr } = await supabase
      .from('razorpay_pos_transactions')
      .select('id, txn_id, username, merchant_slug, merchant_name, raw_data')
      .or('merchant_slug.eq.ashvam,merchant_slug.is.null')
      .order('transaction_time', { ascending: false })
      .limit(5000)

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }

    const fixes: { txn_id: string; old_slug: string | null; new_slug: string; matched_by: string }[] = []

    for (const row of candidates || []) {
      const rowUsername = row.username || row.raw_data?.username
      if (!rowUsername) continue

      const correctSlug = usernameToSlug[String(rowUsername).trim()]
      if (!correctSlug || correctSlug === 'ashvam') continue

      const currentSlug = row.merchant_slug || null
      if (currentSlug === correctSlug) continue

      fixes.push({
        txn_id: row.txn_id,
        old_slug: currentSlug,
        new_slug: correctSlug,
        matched_by: `username=${rowUsername}`,
      })

      if (commit) {
        const merchantNames: Record<string, string> = {
          ashvam: 'ASHVAM LEARNING PRIVATE LIMITED',
          teachway: 'Teachway Education Private Limited',
          newscenaric: 'New Scenaric Travels',
          lagoon: 'LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED',
        }
        await supabase
          .from('razorpay_pos_transactions')
          .update({
            merchant_slug: correctSlug,
            merchant_name: merchantNames[correctSlug] || row.merchant_name,
            updated_at: new Date().toISOString(),
          })
          .eq('txn_id', row.txn_id)
      }
    }

    return NextResponse.json({
      success: true,
      mode: commit ? 'committed' : 'dry_run',
      total_scanned: candidates?.length || 0,
      fixes_needed: fixes.length,
      fixes,
      hint: commit
        ? `${fixes.length} transactions updated.`
        : 'Pass { "commit": true } to apply these changes.',
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
