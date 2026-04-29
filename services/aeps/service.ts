/**
 * AEPS Service — Business logic layer integrating API client with wallet system
 */

import { getAEPSClient, AEPSAPIError } from './client';
import { validateAadhaar, validateMobile, validateAmount } from '@/lib/validation';
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

    try {
      const txnId = crypto.randomUUID();

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
          bioType: 'FINGER',
          dc: '', ci: '', hmac: '', dpId: '', mc: '', pidDataType: '', mi: '',
          rdsId: '', sessionKey: '', fCount: '', errCode: '', pCount: '',
          fType: '', iCount: '', pType: '', srno: '', pidData: '', qScore: '',
          nmPoints: '', rdsVer: '',
        });

        return this.formatResponse(response);
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

      console.log('[AEPS Service] aepsPayment request:', {
        txnId,
        merchantId,
        type: apiType,
        amount: String(amount || 0),
        iin: bankIin,
        adhar: customerAadhaar?.substring(0, 4) + '****',
        cMobile: customerMobile,
        bioType: biometricData.bioType,
        srno: biometricData.srno,
        ci: biometricData.ci,
        fCount: biometricData.fCount,
        fType: biometricData.fType,
      });

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

      console.log('[AEPS Service] aepsPayment response:', JSON.stringify(response));

      return this.formatResponse(response);
    } catch (error) {
      if (error instanceof AEPSAPIError) {
        console.error('[AEPS Service] aepsPayment ERROR:', error.statusCode, error.message, JSON.stringify(error.data));
        return {
          success: false,
          status: 'failed',
          message: error.message,
          error: error.data?.code || 'API_ERROR',
        };
      }

      console.error('[AEPS Service] aepsPayment UNKNOWN ERROR:', error);
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
  private formatResponse(response: AEPSPaymentResponse): TransactionResult {
    if (response.success && response.data?.status === 'success') {
      return {
        success: true,
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
      orderId: response.data?.orderId,
      status: response.data?.status || 'failed',
      message: response.message || 'Transaction failed',
      error: response.code?.toString() || 'FAILED',
    };
  }

  /**
   * Check if service is in mock mode
   */
  isMockMode(): boolean {
    return this.client.isMockMode();
  }

  /**
   * Validate Aadhaar number format with full Verhoeff algorithm
   */
  validateAadhaarNumber(aadhaar: string): { valid: boolean; error?: string; maskedAadhaar?: string } {
    return validateAadhaar(aadhaar);
  }

  /**
   * Validate mobile number format
   */
  validateMobileNumber(mobile: string): { valid: boolean; error?: string; formattedMobile?: string } {
    return validateMobile(mobile);
  }

  /**
   * Validate transaction amount based on type
   */
  validateTransactionAmount(
    amount: number | string,
    transactionType: AEPSTransactionType
  ): { valid: boolean; error?: string; parsedAmount?: number } {
    const txnType = transactionType === 'aadhaar_to_aadhaar' ? 'cash_withdrawal' : transactionType;
    return validateAmount(amount, txnType as 'balance_inquiry' | 'cash_withdrawal' | 'cash_deposit' | 'mini_statement');
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
   * Validate all transaction inputs before processing
   */
  validateTransactionInputs(params: {
    customerAadhaar: string;
    customerMobile: string;
    amount?: number;
    transactionType: AEPSTransactionType;
    bankIin: string;
  }): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate Aadhaar
    const aadhaarResult = this.validateAadhaarNumber(params.customerAadhaar);
    if (!aadhaarResult.valid) {
      errors.push(aadhaarResult.error || 'Invalid Aadhaar');
    }

    // Validate Mobile
    const mobileResult = this.validateMobileNumber(params.customerMobile);
    if (!mobileResult.valid) {
      errors.push(mobileResult.error || 'Invalid mobile number');
    }

    // Validate Amount (for financial transactions)
    if (params.transactionType === 'cash_withdrawal' || params.transactionType === 'cash_deposit') {
      const amountResult = this.validateTransactionAmount(params.amount || 0, params.transactionType);
      if (!amountResult.valid) {
        errors.push(amountResult.error || 'Invalid amount');
      }
    }

    // Validate Bank IIN
    if (!params.bankIin || !/^\d{6}$/.test(params.bankIin)) {
      errors.push('Invalid bank IIN (must be 6 digits)');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
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
