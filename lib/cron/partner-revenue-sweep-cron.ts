/**
 * Partner revenue sweep: guarantees one company-revenue entry per successful
 * partner transaction (Pay2New, Rechargekit, Settlement-2, Payout), regardless of
 * which code path (inline, status-poll, callback, reconcile cron) finalised it.
 *
 * Idempotent (deterministic `<PREFIX>-REV-<ref>` ledger refs) and bounded to a
 * recent window so it never mass-backfills history — historical backfill is a
 * manual admin action (POST /api/admin/reports/revenue/sync-partners).
 */

import cron, { ScheduledTask } from 'node-cron'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { sweepPartnerRevenue } from '@/lib/commission/partner-revenue'

const CRON_EXPRESSION = process.env.PARTNER_REVENUE_SWEEP_CRON || '*/10 * * * *'
const WINDOW_HOURS = Number(process.env.PARTNER_REVENUE_SWEEP_WINDOW_HOURS) > 0
  ? Number(process.env.PARTNER_REVENUE_SWEEP_WINDOW_HOURS)
  : 48
const MAX_BOOK = Number(process.env.PARTNER_REVENUE_SWEEP_MAX_BOOK) > 0 ? Number(process.env.PARTNER_REVENUE_SWEEP_MAX_BOOK) : 500
const ENABLED = process.env.PARTNER_REVENUE_SWEEP_ENABLED !== 'false'

const g = globalThis as any
if (!g.__partnerRevenueSweepState) g.__partnerRevenueSweepState = { task: null as ScheduledTask | null, running: false }
const state = g.__partnerRevenueSweepState

async function run() {
  if (state.running) return
  state.running = true
  try {
    const now = Date.now()
    const results = await sweepPartnerRevenue({
      supabase: getSupabaseAdmin(),
      from: new Date(now - WINDOW_HOURS * 3_600_000).toISOString(),
      // Give inline/status handlers a moment to book first.
      to: new Date(now - 2 * 60_000).toISOString(),
      dryRun: false,
      maxBook: MAX_BOOK,
    })
    for (const r of results) {
      if (r.booked || r.failed) {
        console.log(`[Partner-Revenue-Sweep] ${r.service}: missing=${r.missing} booked=${r.booked} failed=${r.failed}${r.capped ? ' (capped)' : ''}`)
      }
    }
  } catch (e: any) {
    console.error('[Partner-Revenue-Sweep] run error:', e?.message)
  } finally {
    state.running = false
  }
}

export async function initPartnerRevenueSweepCron(): Promise<void> {
  if (!ENABLED) {
    console.log('[Partner-Revenue-Sweep] disabled (PARTNER_REVENUE_SWEEP_ENABLED=false)')
    return
  }
  if (state.task) {
    state.task.stop()
    state.task = null
  }
  state.task = cron.schedule(CRON_EXPRESSION, run, { timezone: 'Asia/Kolkata' })
  console.log(`[Partner-Revenue-Sweep] scheduled (${CRON_EXPRESSION}) window=${WINDOW_HOURS}h maxBook=${MAX_BOOK}`)
}
