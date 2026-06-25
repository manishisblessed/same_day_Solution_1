export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Ensure .env.local vars are in process.env (Next.js/webpack may not load them)
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const fs = await import('fs')
        const path = await import('path')
        const envPath = path.join(process.cwd(), '.env.local')
        const content = fs.readFileSync(envPath, 'utf-8')
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eqIdx = trimmed.indexOf('=')
          if (eqIdx === -1) continue
          const key = trimmed.slice(0, eqIdx).trim()
          const val = trimmed.slice(eqIdx + 1).trim()
          if (!process.env[key]) {
            process.env[key] = val
          }
        }
        console.log('[Instrumentation] Loaded .env.local into process.env')
      } catch (err) {
        console.error('[Instrumentation] Failed to load .env.local:', err)
      }
    }
    const { initT1SettlementCron } = await import('@/lib/cron/t1-settlement-cron')
    const { initPartnerT1SettlementCron } = await import('@/lib/cron/t1-settlement-cron-partners')
    const { initSubscriptionAutoDebitCron } = await import('@/lib/cron/subscription-auto-debit-cron')
    const { initAEPSSettlementCheckCron } = await import('@/lib/cron/aeps-settlement-check-cron')

    try {
      await initT1SettlementCron()
      console.log('[Instrumentation] T+1 Settlement Cron initialized successfully')
    } catch (err) {
      console.error('[Instrumentation] Failed to initialize T+1 cron:', err)
    }

    try {
      await initPartnerT1SettlementCron()
      console.log('[Instrumentation] Partner T+1 Settlement Cron initialized successfully')
    } catch (err) {
      console.error('[Instrumentation] Failed to initialize Partner T+1 cron:', err)
    }

    try {
      await initSubscriptionAutoDebitCron()
      console.log('[Instrumentation] Subscription Auto-Debit Cron initialized successfully')
    } catch (err) {
      console.error('[Instrumentation] Failed to initialize Subscription cron:', err)
    }

    try {
      await initAEPSSettlementCheckCron()
      console.log('[Instrumentation] AEPS Settlement Check Cron initialized successfully')
    } catch (err) {
      console.error('[Instrumentation] Failed to initialize AEPS Settlement Check cron:', err)
    }
  }
}
