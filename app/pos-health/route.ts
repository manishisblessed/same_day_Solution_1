import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

/**
 * GET /pos-health
 * Public health check endpoint for POS Partner API.
 * Matches the contract documented in the Postman collection.
 */
export async function GET() {
  const startTime = Date.now()

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    let dbStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'
    let latencyMs: number | null = null

    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey)
      const dbStart = Date.now()
      const { error } = await supabase.from('partners').select('id').limit(1)
      latencyMs = Date.now() - dbStart

      if (error) {
        dbStatus = 'degraded'
      }
    } else {
      dbStatus = 'unhealthy'
    }

    const statusCode = dbStatus === 'healthy' ? 200 : 503

    return NextResponse.json(
      {
        status: dbStatus,
        service: 'pos-partner-api',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: Math.round(process.uptime()),
        database: {
          status: dbStatus,
          latency_ms: latencyMs,
        },
      },
      { status: statusCode }
    )
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        service: 'pos-partner-api',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: Math.round(process.uptime()),
        database: { status: 'unhealthy', latency_ms: null },
        error: error.message,
      },
      { status: 503 }
    )
  }
}
