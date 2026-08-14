import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  sendDefaultPii: true,

  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.02,

  // NOTE: `includeLocalVariables` and `enableLogs` were the root cause of the
  // Aug-14 OOM. On this backend a large share of requests throw (auth misses,
  // DB constraint errors, webhook 404s); the V8 inspector-based local-variable
  // capture fired on every exception (retained frames + steady CPU), and log
  // buffering held our very verbose console output (huge TID/serial arrays) in
  // the Sentry scope. Both are disabled in production.
  includeLocalVariables: process.env.NODE_ENV === 'development',

  enableLogs: false,

  // Cap breadcrumb retention and drop noisy console breadcrumbs so the per-isolate
  // scope can't grow unbounded under sustained logging.
  maxBreadcrumbs: 20,

  beforeBreadcrumb(breadcrumb) {
    return breadcrumb.category === 'console' ? null : breadcrumb
  },
})
