import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { pay2newFetchBill } from '@/services/pay2new'
import { getBillersByCategoryAndChannel, fetchBillerInfo, fetchBill } from '@/services/bbps'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

async function bbpsFallbackFetch(productName: string, number: string, optional1: string) {
  console.log('[Pay2New→BBPS Fallback] Attempting bill fetch for:', productName)

  const billers = await getBillersByCategoryAndChannel({
    fieldValue: 'Credit Card',
    paymentChannelName1: 'INT',
    paymentChannelName2: 'AGT',
    paymentChannelName3: '',
  })

  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const match = billers.find(b => normalise(b.biller_name) === normalise(productName))
  if (!match) {
    throw new Error(`No BBPS biller found matching "${productName}"`)
  }

  const billerInfo = await fetchBillerInfo({ billerId: match.biller_id, skipCache: true })
  const enquiryId = (billerInfo as any).enquiryId

  const paramInfo: Array<{ paramName: string; dataType?: string; isOptional?: boolean }> =
    billerInfo.billerInputParams?.paramInfo || []

  const inputParams: Array<{ paramName: string; paramValue: string }> = []
  for (const p of paramInfo) {
    const nameLower = p.paramName.toLowerCase()
    if (nameLower.includes('mobile') || nameLower.includes('phone')) {
      inputParams.push({ paramName: p.paramName, paramValue: optional1 || number })
    } else {
      inputParams.push({ paramName: p.paramName, paramValue: number })
    }
  }

  if (inputParams.length === 0) {
    inputParams.push({ paramName: 'Card Number', paramValue: number })
  }

  console.log('[Pay2New→BBPS Fallback] biller_id:', match.biller_id, 'inputParams:', inputParams)

  const billResult = await fetchBill({
    billerId: match.biller_id,
    consumerNumber: number,
    enquiryId,
    inputParams,
  })

  const billAmount = billResult.bill_amount ? billResult.bill_amount / 100 : 0

  return {
    success: true,
    data: {
      customer_name: billResult.consumer_name || '',
      amount: String(billAmount),
      bill_date: billResult.bill_date || '',
      bill_due_date: billResult.due_date || '',
      bill_number: billResult.bill_number || '',
      dueDate: billResult.due_date || '',
      billDate: billResult.bill_date || '',
    },
    order_id: billResult.reqId || null,
    fallback: 'bbps',
    biller_id: match.biller_id,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const { user } = await getCurrentUserWithFallback(request)

    if (!user) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    const { number, product_code, product_name, optional1, optional2, optional3, optional4, customer_number, pincode } = body

    if (!number || !product_code || !customer_number) {
      const response = NextResponse.json(
        { success: false, error: 'Missing required fields: number, product_code, customer_number' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const request_id = `SDS${Date.now()}`

    const result = await pay2newFetchBill({
      number,
      product_code: String(product_code),
      request_id,
      optional1: optional1 || '',
      optional2: optional2 || '',
      optional3: optional3 || '',
      optional4: optional4 || '',
      customer_number,
      pincode: pincode || '414002',
    })

    if (!result.success) {
      const errMsg = (result.error || '').toLowerCase()
      const shouldFallback = errMsg.includes('mandatory input parameter') ||
        errMsg.includes('payment mode cash is disable') ||
        errMsg.includes('input parameter not present') ||
        errMsg.includes('per day limit') ||
        errMsg.includes('limit expired')

      if (shouldFallback && product_name) {
        try {
          const fallbackResult = await bbpsFallbackFetch(product_name, number, optional1 || customer_number)
          console.log('[Pay2New→BBPS Fallback] Bill fetch succeeded for:', product_name)
          const response = NextResponse.json({ ...fallbackResult, request_id })
          return addCorsHeaders(request, response)
        } catch (fbErr: any) {
          console.error('[Pay2New→BBPS Fallback] Also failed:', fbErr.message)
        }
      }

      const response = NextResponse.json(
        { success: false, error: result.error, request_id },
        { status: 200 }
      )
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      data: result.data,
      order_id: result.order_id,
      request_id,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Pay2New Bill Fetch] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Bill fetch failed' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
