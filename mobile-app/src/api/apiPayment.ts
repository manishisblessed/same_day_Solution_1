import { api } from '@/lib/api';

export function apiPaymentSale(input: { amount: number; paymentMode?: 'Card' | 'QR' | 'All' }) {
  return api.post<{
    success: boolean; merchantTransactionId: string; amountInPaise: number; amountInRupees: number;
    paymentMode: string; resultStatus: string; resultCode: string; resultMsg: string;
  }>('/api/api-payment/sale', { paymentMode: 'All', ...input }, { idempotent: true });
}

export function apiPaymentStatus(merchantTransactionId: string) {
  return api.post<{
    success: boolean; isFinal: boolean; merchantTransactionId: string; resultStatus: string;
    resultCode: string; resultMsg: string; transactionId?: string; amount?: number; paymentMode?: string;
    rrn?: string; cardNumber?: string; cardType?: string; cardScheme?: string; bankName?: string; authCode?: string;
  }>('/api/api-payment/status', { merchantTransactionId });
}

export function apiPaymentAbort(merchantTransactionId: string) {
  return api.post<any>('/api/api-payment/abort', { merchantTransactionId });
}
