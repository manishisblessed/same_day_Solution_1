export async function register() {
  // Use bracket notation to bypass webpack DefinePlugin
  const env = process['env']
  if (env['NEXT_RUNTIME'] === 'nodejs') {
    // Always load .env.local to ensure vars are available (webpack may inline them as empty)
    try {
      const fs = await import('fs')
      const path = await import('path')
      const envPath = path.join(process.cwd(), '.env.local')
      const content = fs.readFileSync(envPath, 'utf-8')
      let loaded = 0
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx === -1) continue
        const key = trimmed.slice(0, eqIdx).trim()
        const val = trimmed.slice(eqIdx + 1).trim()
        if (key && val) {
          env[key] = val
          loaded++
        }
      }
      console.log(`[Instrumentation] Loaded ${loaded} env vars from .env.local`)
    } catch (err) {
      console.error('[Instrumentation] Failed to load .env.local:', err)
    }
    // In PM2 cluster mode every worker runs this file. Only instance 0 may
    // schedule crons, otherwise each worker fires the settlement at the same
    // minute and races to credit wallets.
    const pm2Instance = env['NODE_APP_INSTANCE']
    if (pm2Instance !== undefined && pm2Instance !== '0') {
      console.log(`[Instrumentation] PM2 instance ${pm2Instance}: skipping cron initialization (only instance 0 runs crons).`)
      return
    }

    const { initT1SettlementCron } = await import('@/lib/cron/t1-settlement-cron')
    const { initSubscriptionAutoDebitCron } = await import('@/lib/cron/subscription-auto-debit-cron')
    const { initAEPSSettlementCheckCron } = await import('@/lib/cron/aeps-settlement-check-cron')

    try {
      await initT1SettlementCron()
      console.log('[Instrumentation] T+1 Settlement Cron initialized successfully')
    } catch (err) {
      console.error('[Instrumentation] Failed to initialize T+1 cron:', err)
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

    try {
      const { initPinelabSyncCron } = await import('@/lib/cron/pinelab-sync-cron')
      await initPinelabSyncCron()
      console.log('[Instrumentation] Pinelab Sync Cron initialized successfully')
    } catch (err) {
      console.error('[Instrumentation] Failed to initialize Pinelab Sync cron:', err)
    }
  }
}
