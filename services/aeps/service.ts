/**
 * AEPS Service — Business logic layer integrating API client with wallet system
 */

import { getAEPSClient, AEPSAPIError } from './client';
import type {
  AEPSTransactionType,
  AEPSPaymentResponse,
  AEPSBank,
  AEPSWalletInfo,
  MiniStatementEntry,
} from '@/types/aeps.types';

interface TransactionParams {
  userId: string;
  userRole: string;
  merchantId: string;
  transactionType: AEPSTransactionType;
  amount?: number;
  customerAadhaar: string;
  customerMobile: string;
  bankIin: string;
  bankName?: string;
  // Biometric data (for real transactions)
  biometricData?: {
    wadh: string;
    bioType: 'FINGER' | 'FACE';
    dc: string;
    ci: string;
    hmac: string;
    dpId: string;
    mc: string;
    pidDataType: string;
    mi: string;
    rdsId: string;
    sessionKey: string;
    fCount: string;
    errCode: string;
    pCount: string;
    fType: string;
    iCount: string;
    pType: string;
    srno: string;
    pidData: string;
    qScore: string;
    nmPoints: string;
    rdsVer: string;
  };
}

interface TransactionResult {
  success: boolean;
  transactionId?: string;
  orderId?: string;
  utr?: string;
  status: 'success' | 'failed' | 'pending';
  message: string;
  data?: {
    bankName?: string;
    accountNumber?: string;
    amount?: number;
    balance?: string;
    miniStatement?: MiniStatementEntry[];
  };
  error?: string;
}

class AEPSService {
  private client = getAEPSClient();

  /**
   * Get available banks for AEPS transactions
   */
  async getBanks(merchantId: string): Promise<AEPSBank[]> {
    return this.client.getBankList(merchantId);
  }

  /**
   * Get session wadh for biometric operations
   */
  async getSessionWadh(merchantId: string, type: 'deposit' | 'withdraw' = 'withdraw'): Promise<string | null> {
    return this.client.getWadh(merchantId, type);
  }

  /**
   * Check AEPS login status
   */
  async checkLoginStatus(merchantId: string, type: 'deposit' | 'withdraw') {
    return this.client.checkLoginStatus({ merchantId, type });
  }

  /**
   * Process AEPS transaction
   */
  async processTransaction(params: TransactionParams): Promise<TransactionResult> {
    const {
      merchantId,
      transactionType,
      amount,
      customerAadhaar,
      customerMobile,
      bankIin,
      biometricData,
    } = params;

    // Map transaction type to API type
    const typeMap: Record<AEPSTransactionType, string> = {
      balance_inquiry: 'balance',
      cash_withdrawal: 'withdraw',
      cash_deposit: 'deposit',
      mini_statement: 'miniStatement',
      aadhaar_to_aadhaar: 'withdraw', // A2A uses withdraw flow
    };

    const apiType = typeMap[transactionType] as 'balance' | 'withdraw' | 'deposit' | 'miniStatement';
    const txnId = this.generateTxnId();

    try {
      // If using mock mode, simplified request
      if (this.client.isMockMode()) {
        const response = await this.client.aepsPayment({
          txnId,
          merchantId,
          type: apiType,
          amount: String(amount || 0),
          iin: bankIin,
          adhar: customerAadhaar,
          cMobile: customerMobile,
          // Placeholder biometric data for mock
          wadh: '',
          bioType: 'FINGER',
          dc: '', ci: '', hmac: '', dpId: '', mc: '', pidDataType: '', mi: '',
          rdsId: '', sessionKey: '', fCount: '', errCode: '', pCount: '',
          fType: '', iCount: '', pType: '', srno: '', pidData: '', qScore: '',
          nmPoints: '', rdsVer: '',
        });

        return this.formatResponse(response, txnId);
      }

      // Real transaction requires biometric data
      if (!biometricData) {
        return {
          success: false,
          status: 'failed',
          message: 'Biometric data required for real transactions',
          error: 'BIOMETRIC_REQUIRED',
        };
      }

      const response = await this.client.aepsPayment({
        txnId,
        merchantId,
        type: apiType,
        amount: String(amount || 0),
        iin: bankIin,
        adhar: customerAadhaar,
        cMobile: customerMobile,
        ...biometricData,
      });

      return this.formatResponse(response, txnId);
    } catch (error) {
      if (error instanceof AEPSAPIError) {
        return {
          success: false,
          status: 'failed',
          message: error.message,
          error: error.data?.code || 'API_ERROR',
        };
      }

      return {
        success: false,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        error: 'UNKNOWN_ERROR',
      };
    }
  }

  /**
   * Balance inquiry shortcut
   */
  async balanceInquiry(params: Omit<TransactionParams, 'transactionType' | 'amount'>): Promise<TransactionResult> {
    return this.processTransaction({
      ...params,
      transactionType: 'balance_inquiry',
      amount: 0,
    });
  }

  /**
   * Cash withdrawal shortcut
   */
  async cashWithdrawal(params: Omit<TransactionParams, 'transactionType'> & { amount: number }): Promise<TransactionResult> {
    if (!params.amount || params.amount <= 0) {
      return {
        success: false,
        status: 'failed',
        message: 'Valid amount required for withdrawal',
        error: 'INVALID_AMOUNT',
      };
    }

    return this.processTransaction({
      ...params,
      transactionType: 'cash_withdrawal',
    });
  }

  /**
   * Cash deposit shortcut
   */
  async cashDeposit(params: Omit<TransactionParams, 'transactionType'> & { amount: number }): Promise<TransactionResult> {
    if (!params.amount || params.amount <= 0) {
      return {
        success: false,
        status: 'failed',
        message: 'Valid amount required for deposit',
        error: 'INVALID_AMOUNT',
      };
    }

    return this.processTransaction({
      ...params,
      transactionType: 'cash_deposit',
    });
  }

  /**
   * Mini statement shortcut
   */
  async miniStatement(params: Omit<TransactionParams, 'transactionType' | 'amount'>): Promise<TransactionResult> {
    return this.processTransaction({
      ...params,
      transactionType: 'mini_statement',
      amount: 0,
    });
  }

  /**
   * Format API response to standard result
   */
  private formatResponse(response: AEPSPaymentResponse, txnId: string): TransactionResult {
    if (response.success && response.data?.status === 'success') {
      return {
        success: true,
        transactionId: txnId,
        orderId: response.data.orderId,
        utr: response.data.utr,
        status: 'success',
        message: response.message || 'Transaction successful',
        data: {
          bankName: response.data.bankName,
          accountNumber: response.data.accountNumber,
          amount: response.data.amount,
          balance: response.data.bankAccountBalance || undefined,
          miniStatement: response.data.miniStatement,
        },
      };
    }

    return {
      success: false,
      transactionId: txnId,
      orderId: response.data?.orderId,
      status: response.data?.status || 'failed',
      message: response.message || 'Transaction failed',
      error: response.code?.toString() || 'FAILED',
    };
  }

  /**
   * Generate unique transaction ID
   */
  private generateTxnId(): string {
    return `AEPS${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  }

  /**
   * Check if service is in mock mode
   */
  isMockMode(): boolean {
    return this.client.isMockMode();
  }

  /**
   * Validate Aadhaar number format
   */
  validateAadhaar(aadhaar: string): { valid: boolean; error?: string } {
    const cleanAadhaar = aadhaar.replace(/\s/g, '');
    
    if (!/^\d{12}$/.test(cleanAadhaar)) {
      return { valid: false, error: 'Aadhaar must be exactly 12 digits' };
    }

    // Verhoeff algorithm check (simplified)
    // In production, implement full Verhoeff validation
    return { valid: true };
  }

  /**
   * Validate mobile number format
   */
  validateMobile(mobile: string): { valid: boolean; error?: string } {
    const cleanMobile = mobile.replace(/\s/g, '');
    
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      return { valid: false, error: 'Mobile must be valid 10-digit Indian number' };
    }

    return { valid: true };
  }

  /**
   * Mask Aadhaar for display
   */
  maskAadhaar(aadhaar: string): string {
    const clean = aadhaar.replace(/\s/g, '');
    if (clean.length !== 12) return aadhaar;
    return `XXXX XXXX ${clean.slice(-4)}`;
  }

  /**
   * Format amount for display
   */
  formatAmount(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(amount);
  }
}

// Singleton instance
let aepsServiceInstance: AEPSService | null = null;

export function getAEPSService(): AEPSService {
  if (!aepsServiceInstance) {
    aepsServiceInstance = new AEPSService();
  }
  return aepsServiceInstance;
}

export { AEPSService };
