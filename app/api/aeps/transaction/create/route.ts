/**
 * @deprecated REMOVED — This route has been disabled.
 * Use POST /api/aeps/transact instead.
 */

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      error: 'This endpoint has been permanently removed.',
      migrated_to: '/api/aeps/transact',
      code: 'ENDPOINT_REMOVED',
    },
    { status: 410 }
  )
}
