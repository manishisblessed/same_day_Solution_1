export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initT1SettlementCron } = await import('@/lib/cron/t1-settlement-cron')

    try {
      await initT1SettlementCron()
      console.log('[Instrumentation] T+1 Settlement Cron initialized successfully')
    } catch (err) {
      console.error('[Instrumentation] Failed to initialize T+1 cron:', err)
    }
  }
}
