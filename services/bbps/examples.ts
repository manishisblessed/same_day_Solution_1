/**
 * BBPS API Usage Examples
 * 
 * This file demonstrates how to use each BBPS service
 * These are examples only - not meant to be executed directly
 */

import {
  getBillersByCategory,
  fetchBillerInfo,
  fetchBill,
  payRequest,
  transactionStatus,
  complaintRegistration,
  complaintTracking,
  generateAgentTransactionId,
  generateReqId,
} from './index'

/**
 * Example 1: Get Billers by Category
 */
export async function exampleGetBillers() {
  try {
    const billers = await getBillersByCategory({
      category: 'Electricity',
      limit: 100,
    })

    console.log(`Found ${billers.length} billers`)
    billers.forEach((biller) => {
      console.log(`- ${biller.biller_name} (${biller.biller_id})`)
    })

    return billers
  } catch (error: any) {
    console.error('Error fetching billers:', error.message)
    throw error
  }
}

/**
 * Example 2: Fetch Biller Information
 */
export async function exampleFetchBillerInfo(billerId: string) {
  try {
    const billerInfo = await fetchBillerInfo({ billerId })

    console.log('Biller Information:')
    console.log(`- Name: ${billerInfo.billerName}`)
    console.log(`- Category: ${billerInfo.billerCategory}`)
    console.log(`- Supports Bill Fetch: ${billerInfo.supportBillFetch}`)
    console.log(`- Amount Exactness: ${billerInfo.amountExactness}`)
    console.log(`- Input Params:`, billerInfo.billerInputParams)

    return billerInfo
  } catch (error: any) {
    console.error('Error fetching biller info:', error.message)
    throw error
  }
}

/**
 * Example 3: Fetch Bill Details
 */
export async function exampleFetchBill(billerId: string, consumerNumber: string) {
  try {
    const billDetails = await fetchBill({
      billerId,
      consumerNumber,
      inputParams: [
        { paramName: 'Consumer Number', paramValue: consumerNumber },
      ],
    })

    console.log('Bill Details:')
    console.log(`- Bill Amount: ₹${billDetails.bill_amount}`)
    console.log(`- Due Date: ${billDetails.due_date}`)
    console.log(`- Bill Date: ${billDetails.bill_date}`)
    console.log(`- Bill Number: ${billDetails.bill_number}`)
    console.log(`- Consumer Name: ${billDetails.consumer_name}`)
    console.log(`- Request ID: ${billDetails.reqId}`)

    return billDetails
  } catch (error: any) {
    console.error('Error fetching bill:', error.message)
    throw error
  }
}

/**
 * Example 4: Pay Bill
 */
export async function examplePayBill(
  billerId: string,
  consumerNumber: string,
  amount: number,
  retailerId: string
) {
  try {
    // Generate unique agent transaction ID
    const agentTxnId = generateAgentTransactionId(retailerId)

    const paymentResponse = await payRequest({
      billerId,
      consumerNumber,
      amount,
      agentTransactionId: agentTxnId,
      inputParams: [
        { paramName: 'Consumer Number', paramValue: consumerNumber },
      ],
    })

    if (paymentResponse.success) {
      console.log('✅ Payment Successful!')
      console.log(`- Transaction ID: ${paymentResponse.transaction_id}`)
      console.log(`- Agent Txn ID: ${paymentResponse.agent_transaction_id}`)
      console.log(`- Amount Paid: ₹${paymentResponse.amount_paid}`)
      console.log(`- Status: ${paymentResponse.status}`)
    } else {
      console.error('❌ Payment Failed!')
      console.error(`- Error Code: ${paymentResponse.error_code}`)
      console.error(`- Error Message: ${paymentResponse.error_message}`)
    }

    return paymentResponse
  } catch (error: any) {
    console.error('Error processing payment:', error.message)
    throw error
  }
}

/**
 * Example 5: Check Transaction Status
 */
export async function exampleTransactionStatus(transactionId: string) {
  try {
    const status = await transactionStatus({
      transactionId,
      trackType: 'TRANS_REF_ID',
    })

    console.log('Transaction Status:')
    console.log(`- Transaction ID: ${status.transaction_id}`)
    console.log(`- Status: ${status.status}`)
    console.log(`- Payment Status: ${status.payment_status}`)
    console.log(`- Amount: ₹${status.amount}`)
    console.log(`- Response Code: ${status.response_code}`)
    console.log(`- Response Reason: ${status.response_reason}`)

    return status
  } catch (error: any) {
    console.error('Error fetching transaction status:', error.message)
    throw error
  }
}

/**
 * Example 6: Register Complaint
 */
export async function exampleRegisterComplaint(transactionId: string) {
  try {
    const complaint = await complaintRegistration({
      transactionId,
      complaintType: 'Transaction',
      description: 'Amount deducted multiple times',
      complaintDisposition: 'Amount deducted multiple times',
    })

    if (complaint.success) {
      console.log('✅ Complaint Registered!')
      console.log(`- Complaint ID: ${complaint.complaint_id}`)
      console.log(`- Transaction ID: ${complaint.transaction_id}`)
      console.log(`- Status: ${complaint.status}`)
      console.log(`- Message: ${complaint.message}`)
    } else {
      console.error('❌ Complaint Registration Failed!')
      console.error(`- Error Code: ${complaint.error_code}`)
      console.error(`- Error Message: ${complaint.error_message}`)
    }

    return complaint
  } catch (error: any) {
    console.error('Error registering complaint:', error.message)
    throw error
  }
}

/**
 * Example 7: Track Complaint
 */
export async function exampleTrackComplaint(complaintId: string) {
  try {
    const complaintStatus = await complaintTracking({
      complaintId,
      complaintType: 'Service',
    })

    console.log('Complaint Status:')
    console.log(`- Complaint ID: ${complaintStatus.complaint_id}`)
    console.log(`- Status: ${complaintStatus.status}`)
    console.log(`- Type: ${complaintStatus.complaint_type}`)
    console.log(`- Description: ${complaintStatus.description}`)
    if (complaintStatus.resolution) {
      console.log(`- Resolution: ${complaintStatus.resolution}`)
    }

    return complaintStatus
  } catch (error: any) {
    console.error('Error tracking complaint:', error.message)
    throw error
  }
}

/**
 * Example 8: Complete Payment Flow
 * 
 * This demonstrates the complete flow from biller selection to payment
 */
export async function exampleCompletePaymentFlow(
  category: string,
  consumerNumber: string,
  retailerId: string
) {
  try {
    console.log('🚀 Starting Complete Payment Flow...\n')

    // Step 1: Get billers for category
    console.log('Step 1: Fetching billers...')
    const billers = await getBillersByCategory({ category })
    if (billers.length === 0) {
      throw new Error('No billers found for category')
    }
    const selectedBiller = billers[0]
    console.log(`✅ Selected biller: ${selectedBiller.biller_name}\n`)

    // Step 2: Fetch biller info (optional but recommended)
    console.log('Step 2: Fetching biller information...')
    const billerInfo = await fetchBillerInfo({ billerId: selectedBiller.biller_id })
    console.log(`✅ Biller supports bill fetch: ${billerInfo.supportBillFetch}\n`)

    // Step 3: Fetch bill details
    console.log('Step 3: Fetching bill details...')
    const billDetails = await fetchBill({
      billerId: selectedBiller.biller_id,
      consumerNumber,
    })
    console.log(`✅ Bill Amount: ₹${billDetails.bill_amount}`)
    console.log(`✅ Due Date: ${billDetails.due_date}\n`)

    // Step 4: Process payment
    console.log('Step 4: Processing payment...')
    const agentTxnId = generateAgentTransactionId(retailerId)
    const paymentResponse = await payRequest({
      billerId: selectedBiller.biller_id,
      consumerNumber,
      amount: billDetails.bill_amount,
      agentTransactionId: agentTxnId,
      inputParams: [
        { paramName: 'Consumer Number', paramValue: consumerNumber },
      ],
      billerResponse: billDetails.additional_info,
    })

    if (!paymentResponse.success) {
      throw new Error(paymentResponse.error_message || 'Payment failed')
    }
    console.log(`✅ Payment successful! Transaction ID: ${paymentResponse.transaction_id}\n`)

    // Step 5: Verify transaction status
    console.log('Step 5: Verifying transaction status...')
    const status = await transactionStatus({
      transactionId: paymentResponse.transaction_id!,
    })
    console.log(`✅ Transaction Status: ${status.status}\n`)

    console.log('🎉 Payment flow completed successfully!')

    return {
      success: true,
      transactionId: paymentResponse.transaction_id,
      status: status.status,
      billDetails,
      paymentResponse,
    }
  } catch (error: any) {
    console.error('❌ Payment flow error:', error.message)
    throw error
  }
}

/**
 * Example 9: Error Handling Pattern
 */
export async function exampleErrorHandling() {
  try {
    // This will fail if category is invalid
    const billers = await getBillersByCategory({ category: '' })
    return billers
  } catch (error: any) {
    // Handle specific error types
    if (error.message.includes('required')) {
      console.error('Validation error:', error.message)
      // Return user-friendly error
      return { error: 'Please provide a valid category' }
    } else if (error.message.includes('credentials')) {
      console.error('Configuration error:', error.message)
      // Return system error
      return { error: 'BBPS API is not configured properly' }
    } else {
      console.error('Unexpected error:', error.message)
      // Return generic error
      return { error: 'An unexpected error occurred' }
    }
  }
}

