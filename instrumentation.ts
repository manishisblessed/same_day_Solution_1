export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initT1SettlementCron } = await import('@/lib/cron/t1-settlement-cron')
    const { initPartnerT1SettlementCron } = await import('@/lib/cron/t1-settlement-cron-partners')
    const { initSubscriptionAutoDebitCron } = await import('@/lib/cron/subscription-auto-debit-cron')

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
  }
}
