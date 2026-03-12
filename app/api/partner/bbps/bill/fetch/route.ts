import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError } from '@/lib/partner-auth'
import { fetchBill } from '@/services/bbps'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function POST(request: NextRequest) {
  try {
    let authResult
    try {
      authResult = await authenticatePartner(request)
    } catch (error) {
      const e = error as PartnerAuthError
      return NextResponse.json(
        { success: false, error: { code: e.code, message: e.message } },
        { status: e.status }
      )
    }

    const { partner } = authResult
    if (!partner.permissions.includes('bbps') && !partner.permissions.includes('all')) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Missing required permission: bbps' } },
        { status: 403 }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        { status: 400 }
      )
    }

    const { biller_id, consumer_number, input_params, init_channel, payment_mode, ip, mac } = body

    if (!biller_id) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'biller_id is required' } },
        { status: 400 }
      )
    }
    if (!input_params && !consumer_number) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'consumer_number or input_params is required' } },
        { status: 400 }
      )
    }

    let inputParams: Array<{ paramName: string; paramValue: string | number }> | undefined
    if (Array.isArray(input_params)) {
      inputParams = input_params.map((p: any) => ({ paramName: p.paramName, paramValue: p.paramValue }))
    }

    const paymentInfo = [{ infoName: 'Remarks', infoValue: 'Received' }]

    const billDetails = await fetchBill({
      billerId: biller_id,
      consumerNumber: consumer_number || (inputParams?.[0]?.paramValue?.toString() ?? ''),
      inputParams,
      paymentInfo,
      paymentMode: payment_mode || 'cash',
      initChannel: init_channel || 'AGT',
      ip: ip || '127.0.0.1',
      mac: mac || '01-23-45-67-89-ab',
    })

    return NextResponse.json({
      success: true,
      status: 'success',
      message: 'Bill fetched Successfully',
      data: {
        responseCode: billDetails.additional_info?.responseCode || '000',
        inputParams: billDetails.additional_info?.inputParams,
        billerResponse: billDetails.additional_info?.billerResponse || {
          billAmount: String(billDetails.bill_amount),
          billDate: billDetails.bill_date,
          customerName: billDetails.consumer_name,
          dueDate: billDetails.due_date,
        },
        additionalInfo: billDetails.additional_info?.additionalInfo,
      },
      reqId: billDetails.reqId,
      bill: billDetails,
    })
  } catch (error: any) {
    console.error('[Partner BBPS Fetch Bill] Error:', error)

    const msg = error.message || 'Failed to fetch bill details'
    const isInfo = msg.toLowerCase().includes('no bill due') || msg.toLowerCase().includes('already paid')
    const isTooMany = msg.toLowerCase().includes('too many request')

    return NextResponse.json(
      {
        success: isInfo,
        error: { code: isTooMany ? 'RATE_LIMIT' : 'FETCH_BILL_ERROR', message: msg },
      },
      { status: isTooMany ? 429 : isInfo ? 200 : 500 }
    )
  }
}
