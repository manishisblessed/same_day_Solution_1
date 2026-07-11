/**
 * Rechargekit Credit Card Payment
 * POST /rkitcc/v3/ccPayment
 */

import { rechargekitPost } from './client'
import { RECHARGEKIT_STATUS, type RechargekitCcPaymentRequest, type RechargekitCcPaymentResponse } from './types'

export interface CcPaymentParams {
  mobile_no: string
  account_no: string
  ifsc: string
  bank_name: string
  beneficiary_name: string
  amount: number
  partner_request_id: string
  operator_code: string
}

export async function rechargekitCcPayment(params: CcPaymentParams): Promise<{
  success: boolean
  pending?: boolean
  txn_id?: string
  operator_reference?: string
  amount?: number | string
  message?: string
  error?: string
  providerStatus?: number
  raw?: RechargekitCcPaymentResponse
}> {
  const payload: RechargekitCcPaymentRequest = {
    mobile_no: params.mobile_no,
    account_no: params.account_no,
    ifsc: params.ifsc,
    bank_name: params.bank_name,
    beneficiary_name: params.beneficiary_name,
    amount: params.amount,
    partner_request_id: params.partner_request_id,
    operator_code: params.operator_code,
  }

  const maskedCard =
    params.account_no.length > 4
      ? `****${params.account_no.slice(-4)}`
      : params.account_no

  console.log(
    '[Rechargekit] CC Payment request_id:',
    params.partner_request_id,
    'operator:',
    params.operator_code,
    'amount:',
    params.amount,
    'card:',
    maskedCard
  )

  try {
    // Doc shows /rkitcc//v3/ccPayment — normalize to single slash
    const result = await rechargekitPost<RechargekitCcPaymentResponse>(
      'rkitcc/v3/ccPayment',
      payload as unknown as Record<string, unknown>
    )

    const resp = result.data
    const providerStatus = result.providerStatus ?? Number(resp?.status)

    if (!result.ok || !resp) {
      console.error('[Rechargekit] CC Payment failed:', result.error)
      return {
        success: false,
        error: result.error || 'Credit card payment failed',
        providerStatus,
        raw: resp,
      }
    }

    const txn_id = String(
      resp.txn_id ?? resp.transaction_id ?? resp.partner_request_id ?? params.partner_request_id
    )
    const operator_reference = String(
      resp.operator_ref ?? resp.operator_reference ?? txn_id
    )

    if (providerStatus === RECHARGEKIT_STATUS.PENDING) {
      console.log('[Rechargekit] CC Payment pending:', txn_id)
      return {
        success: true,
        pending: true,
        txn_id,
        operator_reference,
        amount: resp.amount ?? params.amount,
        message: resp.message || 'Payment pending',
        providerStatus,
        raw: resp,
      }
    }

    console.log('[Rechargekit] CC Payment success:', txn_id)
    return {
      success: true,
      pending: false,
      txn_id,
      operator_reference,
      amount: resp.amount ?? params.amount,
      message: resp.message || 'Payment successful',
      providerStatus,
      raw: resp,
    }
  } catch (e: any) {
    console.error('[Rechargekit] CC Payment error:', e)
    return { success: false, error: e?.message || 'Rechargekit CC payment error' }
  }
}
