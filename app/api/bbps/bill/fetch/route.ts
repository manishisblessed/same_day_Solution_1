import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { fetchBill } from '@/services/bbps'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Helper to get Supabase client at runtime (not build time)
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables not configured')
  }
  
  return createClient(supabaseUrl, supabaseAnonKey)
}

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  // Declare variables at function scope so they're accessible in catch block
  let biller_id: string | undefined
  let consumer_number: string | undefined
  let additional_params: any
  let input_params: any
  let payment_info: any
  let payment_mode: string | undefined
  let init_channel: string | undefined
  let ip: string | undefined
  let mac: string | undefined

  try {
    const body = await request.json() as any
    
    // Try cookie-based auth first
    let user = await getCurrentUserFromRequest(request)
    
    // If cookie auth fails, try to verify user from request body (fallback)
    // This is needed because Supabase cookie-based auth may not work reliably in all cases
    if (!user && body.user_id) {
      const supabase = getSupabaseClient()
      // Verify the user_id exists in retailers table
      const { data: retailer } = await supabase
        .from('retailers')
        .select('partner_id, name, email')
        .eq('partner_id', body.user_id)
        .maybeSingle()
      
      if (retailer) {
        user = {
          id: body.user_id,
          email: retailer.email,
          role: 'retailer',
          partner_id: retailer.partner_id,
          name: retailer.name,
        }
        // Fallback auth active (cross-origin — no Supabase cookies)
      }
    }
    
    if (!user) {
      console.error('BBPS Bill Fetch: No authenticated user found')
      const response = NextResponse.json(
        { error: 'Unauthorized', message: 'Please log in to fetch bills' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    // Only retailers can fetch bills
    if (user.role !== 'retailer') {
      const response = NextResponse.json(
        { error: 'Forbidden: Only retailers can access this endpoint' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }
    
    // Destructure request body
    ({
      biller_id, 
      consumer_number, 
      additional_params, 
      input_params,
      payment_info,
      payment_mode,
      init_channel,
      ip,
      mac,
    } = body)

    if (!biller_id) {
      const response = NextResponse.json(
        { error: 'biller_id is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // consumer_number is required only if input_params are not provided
    if (!input_params && !consumer_number) {
      const response = NextResponse.json(
        { error: 'consumer_number or input_params is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    // Support both input_params (array format) and additional_params (object format)
    const params = input_params || additional_params || {}
    
    // Convert params to inputParams array format if needed
    let inputParams: Array<{ paramName: string; paramValue: string | number }> | undefined
    if (Array.isArray(params)) {
      inputParams = params.map(param => ({
        paramName: param.paramName,
        paramValue: param.paramValue,
      }))
    } else if (typeof params === 'object' && params !== null) {
      inputParams = Object.entries(params).map(([key, value]) => ({
        paramName: key,
        paramValue: value as string | number,
      }))
    }

    // Normalize parameter names for Credit Card billers to match API expectations
    // The API might expect specific names, but we'll use the names from biller metadata
    // This ensures compatibility with different biller implementations
    if (inputParams && (biller_id.includes('CREDIT') || biller_id.includes('CC') || biller_id.includes('AXIS') || biller_id.includes('AUBA'))) {
      inputParams = inputParams.map(param => {
        // Normalize common variations
        let normalizedName = param.paramName
        if (normalizedName.includes('Last 4') && normalizedName.includes('Credit Card')) {
          // Keep the exact name from biller metadata, but ensure it's consistent
          // Some billers use "Last 4 Digits of Credit Card" vs "Last 4 digits of Credit Card Number"
          // We'll use whatever the biller metadata specifies
        }
        if (normalizedName.includes('Mobile') && !normalizedName.includes('Number')) {
          // Some use "Registered Mobile No" vs "Registered Mobile Number"
          // Keep as is - the API should accept both
        }
        return {
          paramName: normalizedName,
          paramValue: param.paramValue,
        }
      })
    }

    // Convert payment_info to array format if needed
    let paymentInfo: Array<{ infoName: string; infoValue: string }> | undefined
    if (payment_info) {
      if (Array.isArray(payment_info)) {
        paymentInfo = payment_info
      } else if (typeof payment_info === 'object' && payment_info !== null) {
        paymentInfo = Object.entries(payment_info).map(([key, value]) => ({
          infoName: key,
          infoValue: String(value),
        }))
      }
    }

    // For Credit Card billers, if inputParams are not provided, construct them from consumer_number
    // This is a fallback - the frontend should now send inputParams directly
    if (!inputParams && consumer_number && (biller_id.includes('CREDIT') || biller_id.includes('CC') || biller_id.includes('AXIS') || biller_id.includes('AUBA'))) {
      // Use consumer_number as mobile number, and extract last 4 digits if possible
      const mobileNumber = consumer_number.trim()
      // If consumer_number is 10 digits, use it as mobile; otherwise try to extract
      const last4Digits = mobileNumber.length >= 4 ? mobileNumber.slice(-4) : '0000'
      
      inputParams = [
        {
          paramName: 'Last 4 digits of Credit Card Number',
          paramValue: last4Digits,
        },
        {
          paramName: 'Registered Mobile Number',
          paramValue: mobileNumber.length === 10 ? mobileNumber : mobileNumber.padStart(10, '0'),
        },
      ]
    }

    // Use first input param value as consumer_number if not provided, or use consumer_number
    // This is for backward compatibility - the actual API call will use inputParams
    let effectiveConsumerNumber = consumer_number
    if (!effectiveConsumerNumber || effectiveConsumerNumber.trim() === '') {
      if (inputParams && inputParams.length > 0) {
        // Use the first input param value as consumer number for backward compatibility
        effectiveConsumerNumber = String(inputParams[0].paramValue || '')
      }
      // If still empty, use a placeholder (won't be used if inputParams are provided)
      if (!effectiveConsumerNumber || effectiveConsumerNumber.trim() === '') {
        effectiveConsumerNumber = inputParams && inputParams.length > 0 ? 'N/A' : ''
      }
    }

    console.log('[BBPS API Route] Fetching bill:', {
      biller_id,
      consumer_number: effectiveConsumerNumber,
      inputParams,
      inputParamsCount: inputParams?.length || 0,
    })

    // Ensure paymentInfo is set with default if not provided (matches working Postman format)
    const finalPaymentInfo = paymentInfo || [
      {
        infoName: 'Remarks',
        infoValue: 'Received',
      },
    ]

    // Ensure initChannel is set (default to 'AGT' as per working Postman)
    const finalInitChannel = init_channel || 'AGT'

    // Ensure paymentMode is set (default to 'cash' lowercase as per working Postman)
    const finalPaymentMode = payment_mode || 'cash'

    console.log('[BBPS API Route] Calling fetchBill with:', {
      billerId: biller_id,
      consumerNumber: effectiveConsumerNumber,
      inputParams,
      paymentInfo: finalPaymentInfo,
      paymentMode: finalPaymentMode,
      initChannel: finalInitChannel,
    })

    const billDetails = await fetchBill({
      billerId: biller_id,
      consumerNumber: effectiveConsumerNumber,
      inputParams,
      paymentInfo: finalPaymentInfo,
      paymentMode: finalPaymentMode,
      initChannel: finalInitChannel,
      ip: ip || '127.0.0.1',
      mac: mac || '01-23-45-67-89-ab',
    })

    // Return response matching API structure, but also include 'bill' for backward compatibility
    const response = NextResponse.json({
      success: true,
      status: 'success',
      message: 'Bill fetched Successfully',
      data: {
        responseCode: billDetails.additional_info?.responseCode || '000',
        inputParams: billDetails.additional_info?.inputParams || {
          input: inputParams?.map(p => ({
            paramName: p.paramName,
            paramValue: String(p.paramValue).replace(/(.{2}).*(.{2})/, '$1XX$2'), // Mask values
          })) || [],
        },
        billerResponse: billDetails.additional_info?.billerResponse || {
          billAmount: String(billDetails.bill_amount),
          billDate: billDetails.bill_date || new Date().toISOString().split('T')[0],
          billNumber: billDetails.bill_number || '',
          billPeriod: billDetails.additional_info?.billPeriod || 'NA',
          customerName: billDetails.consumer_name || '',
          dueDate: billDetails.due_date || '',
        },
        additionalInfo: billDetails.additional_info?.additionalInfo || undefined,
      },
      reqId: billDetails.reqId,
      // Also include 'bill' for backward compatibility with frontend
      bill: billDetails,
    })
    
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('Error fetching bill details:', error)
    console.error('Error stack:', error.stack)
    console.error('Request body was:', {
      biller_id,
      consumer_number,
      input_params,
      hasInputParams: !!input_params && input_params.length > 0,
    })
    
    // Extract user-friendly error message
    const errorMessage = error.message || 'Failed to fetch bill details'
    
    // Determine if this is an informational message (not an error)
    const isInfoMessage = errorMessage.toLowerCase().includes('no bill due') || 
                         errorMessage.toLowerCase().includes('payment received') ||
                         errorMessage.toLowerCase().includes('already paid')
    
    // Determine appropriate status code
    // 200 for informational messages (like "no bill due" - this is actually good news!)
    // 400 for business logic errors (like "invalid consumer number", etc.)
    // 429 for rate limit (e.g. "Too many request for that Biller" from Sparkup)
    // 500 for actual server/network errors
    let statusCode = 500
    let messageType = 'error'
    let userMessage = errorMessage

    if (isInfoMessage) {
      statusCode = 200 // Treat as success - it's informational
      messageType = 'info'
    } else if (errorMessage.toLowerCase().includes('too many request')) {
      statusCode = 429
      messageType = 'error'
      userMessage = 'Too many requests for this biller. Please wait 1–2 minutes before fetching the bill again.'
    } else if (errorMessage.includes('invalid') || 
               errorMessage.includes('not found') ||
               errorMessage.includes('required')) {
      statusCode = 400
      messageType = 'error'
    }
    
    const response = NextResponse.json(
      { 
        success: isInfoMessage, // true for info messages, false for errors
        messageType: messageType, // 'info' or 'error'
        error: userMessage,
        message: userMessage, // User-friendly message (e.g. rate limit)
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: statusCode }
    )
    return addCorsHeaders(request, response)
  }
}

