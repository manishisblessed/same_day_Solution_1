/**
 * NPCI AEPS Response Code Mapping
 * Maps bank/NPCI error codes to merchant-friendly messages and action hints.
 */

export interface NPCIErrorInfo {
  code: string;
  message: string;
  action: 'none' | 'retry' | 'retry_biometric' | 'check_status' | 'wait' | 'escalate';
  retryable: boolean;
  customerFacing: string;
}

const NPCI_ERROR_MAP: Record<string, NPCIErrorInfo> = {
  '00': {
    code: '00',
    message: 'Transaction approved',
    action: 'none',
    retryable: false,
    customerFacing: 'Transaction successful',
  },
  '51': {
    code: '51',
    message: 'Insufficient funds in customer bank account',
    action: 'none',
    retryable: false,
    customerFacing: 'Insufficient balance in bank account. Please try a smaller amount or use another account.',
  },
  '55': {
    code: '55',
    message: 'Biometric mismatch / Incorrect PIN',
    action: 'retry_biometric',
    retryable: true,
    customerFacing: 'Fingerprint did not match. Please clean the sensor and try again.',
  },
  '61': {
    code: '61',
    message: 'Exceeds withdrawal amount limit',
    action: 'none',
    retryable: false,
    customerFacing: 'Amount exceeds bank withdrawal limit. Please try a smaller amount.',
  },
  '65': {
    code: '65',
    message: 'Exceeds withdrawal frequency limit',
    action: 'wait',
    retryable: false,
    customerFacing: 'Daily transaction limit reached. Please try again tomorrow.',
  },
  '68': {
    code: '68',
    message: 'Response not received within time / Timeout',
    action: 'check_status',
    retryable: false,
    customerFacing: 'Transaction timed out. Please check status before retrying.',
  },
  '75': {
    code: '75',
    message: 'Allowable PIN/biometric tries exceeded',
    action: 'wait',
    retryable: false,
    customerFacing: 'Too many failed attempts. Please wait 24 hours before trying again.',
  },
  '91': {
    code: '91',
    message: 'Issuer or switch inoperative',
    action: 'retry',
    retryable: true,
    customerFacing: 'Bank server is temporarily down. Please try again after some time.',
  },
  '92': {
    code: '92',
    message: 'Transaction routing error',
    action: 'retry',
    retryable: true,
    customerFacing: 'Unable to reach bank. Please try again.',
  },
  '94': {
    code: '94',
    message: 'Duplicate transaction',
    action: 'check_status',
    retryable: false,
    customerFacing: 'This transaction was already processed. Please check your balance.',
  },
  '96': {
    code: '96',
    message: 'System malfunction',
    action: 'retry',
    retryable: true,
    customerFacing: 'System error occurred. Please try again.',
  },
  'M0': {
    code: 'M0',
    message: 'Aadhaar number not registered with bank',
    action: 'none',
    retryable: false,
    customerFacing: 'Aadhaar not linked to this bank account. Please visit the bank branch.',
  },
  'M1': {
    code: 'M1',
    message: 'Biometric data did not match',
    action: 'retry_biometric',
    retryable: true,
    customerFacing: 'Biometric verification failed. Please ensure fingers are clean and dry.',
  },
  '06': {
    code: '06',
    message: 'Error / General error',
    action: 'retry',
    retryable: true,
    customerFacing: 'An error occurred. Please try again.',
  },
  '12': {
    code: '12',
    message: 'Invalid transaction',
    action: 'none',
    retryable: false,
    customerFacing: 'Invalid transaction. Please check details and try again.',
  },
  '14': {
    code: '14',
    message: 'Invalid card/account number',
    action: 'none',
    retryable: false,
    customerFacing: 'Bank account not found. Please verify the bank selection.',
  },
  '30': {
    code: '30',
    message: 'Format error',
    action: 'escalate',
    retryable: false,
    customerFacing: 'Technical error occurred. Please contact support.',
  },
};

/**
 * Parse provider error message to extract NPCI code.
 * Chagans often returns "51Insufficient fund..." or "code: 51, message: ..."
 */
export function parseNPCICode(providerMessage: string): string | null {
  if (!providerMessage) return null;

  // Pattern: leading numeric code (e.g. "51Insufficient fund")
  const leadingMatch = providerMessage.match(/^(\d{2,3})/);
  if (leadingMatch) return leadingMatch[1];

  // Pattern: "code: 51" or "responseCode: 51"
  const codeMatch = providerMessage.match(/(?:code|responseCode|respCode)\s*[:=]\s*['"]?(\w{2,3})['"]?/i);
  if (codeMatch) return codeMatch[1];

  return null;
}

/**
 * Get error info for a response code or provider message
 */
export function getErrorInfo(codeOrMessage: string): NPCIErrorInfo {
  // Direct code lookup
  if (NPCI_ERROR_MAP[codeOrMessage]) {
    return NPCI_ERROR_MAP[codeOrMessage];
  }

  // Try parsing from message
  const parsed = parseNPCICode(codeOrMessage);
  if (parsed && NPCI_ERROR_MAP[parsed]) {
    return NPCI_ERROR_MAP[parsed];
  }

  // Unknown code
  return {
    code: parsed || 'UNKNOWN',
    message: codeOrMessage,
    action: 'escalate',
    retryable: false,
    customerFacing: 'Transaction failed. Please try again or contact support.',
  };
}

/**
 * Clean provider message — strip leading numeric code
 */
export function cleanProviderMessage(message: string): string {
  if (!message) return 'Transaction failed';
  return message.replace(/^\d{2,3}\s*/, '').trim() || message;
}

/**
 * Format error for receipt display
 */
export function formatErrorForReceipt(providerMessage: string, providerCode?: string | number): {
  errorCode: string;
  errorMessage: string;
  action: string;
  retryable: boolean;
} {
  const code = providerCode?.toString() || parseNPCICode(providerMessage) || 'UNKNOWN';
  const info = getErrorInfo(code);

  // When code is unknown but provider sent a meaningful message, use it directly
  const isUnknown = info.code === 'UNKNOWN';
  const cleaned = cleanProviderMessage(providerMessage);
  const displayMessage = isUnknown && cleaned && cleaned !== 'Transaction failed'
    ? cleaned
    : info.customerFacing;

  return {
    errorCode: info.code,
    errorMessage: displayMessage,
    action: info.action,
    retryable: isUnknown ? true : info.retryable,
  };
}
