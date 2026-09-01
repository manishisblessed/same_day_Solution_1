import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/partner-invoices/partners
 * Lightweight partner list for the invoice generation dropdown.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
    }

    const { data, error } = await supabaseAdmin
      .from('partners')
      .select('id, name, business_name, status')
      .order('name', { ascending: true })
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true, data: data || [] })
  } catch (error: any) {
    console.error('[Partner Invoices Partners] Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Internal server error' }, { status: 500 })
  }
}
