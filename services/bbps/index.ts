export * from './config'
export * from './helpers'
export * from './types'

import { getBillersByCategoryAndChannel as getBillersByCategoryAndChannelLive } from './getBillersByCategoryAndChannel'
import { getMockBillersByCategoryAndChannel } from './mocks/getBillersByCategoryAndChannel'
import type { GetBillersByCategoryAndChannelParams } from './getBillersByCategoryAndChannel'

export { getBillersByCategory } from './getBillersByCategory'
export type { GetBillersByCategoryParams } from './getBillersByCategory'

export async function getBillersByCategoryAndChannel(
  params: GetBillersByCategoryAndChannelParams
) {
  const useMock = process.env.USE_BBPS_MOCK === 'true'

  if (useMock) {
    return getMockBillersByCategoryAndChannel(
      params.fieldValue,
      params.paymentChannelName1,
      params.paymentChannelName2,
      params.paymentChannelName3
    )
  } else {
    return getBillersByCategoryAndChannelLive(params)
  }
}

export type { GetBillersByCategoryAndChannelParams }

export { fetchBillerInfo } from './fetchBillerInfo'
export type { FetchBillerInfoParams } from './fetchBillerInfo'

export { fetchBill } from './fetchBill'
export type { FetchBillParams } from './fetchBill'

export { payRequest } from './payRequest'
export type { PayRequestParams } from './payRequest'

export { transactionStatus } from './transactionStatus'
export type { TransactionStatusParams } from './transactionStatus'

export { complaintRegistration } from './complaintRegistration'
export type { ComplaintRegistrationParams } from './complaintRegistration'

export { complaintTracking } from './complaintTracking'
export type { ComplaintTrackingParams } from './complaintTracking'

export { getBBPSWalletBalance } from './getWalletBalance'
