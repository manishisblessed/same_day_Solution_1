/**
 * Verhoeff Algorithm Implementation for Aadhaar Validation
 * 
 * Aadhaar numbers use the Verhoeff checksum algorithm.
 * This provides full implementation for validating Aadhaar numbers.
 */

// Multiplication table
const d: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

// Permutation table
const p: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

// Inverse table
const inv: number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/**
 * Validate Aadhaar number using Verhoeff algorithm
 * @param aadhaar - 12 digit Aadhaar number
 * @returns true if valid, false otherwise
 */
export function verhoeffValidate(aadhaar: string): boolean {
  // Remove spaces and validate format
  const cleaned = aadhaar.replace(/\s/g, '');
  
  if (!/^\d{12}$/.test(cleaned)) {
    return false;
  }

  // Aadhaar cannot start with 0 or 1
  if (cleaned[0] === '0' || cleaned[0] === '1') {
    return false;
  }

  let c = 0;
  const digits = cleaned.split('').reverse().map(Number);
  
  for (let i = 0; i < digits.length; i++) {
    c = d[c][p[i % 8][digits[i]]];
  }
  
  return c === 0;
}

/**
 * Generate Verhoeff check digit
 * @param number - The number to generate check digit for (11 digits for Aadhaar)
 * @returns The check digit (0-9)
 */
export function verhoeffGenerate(number: string): number {
  const cleaned = number.replace(/\s/g, '');
  
  if (!/^\d+$/.test(cleaned)) {
    throw new Error('Input must contain only digits');
  }

  let c = 0;
  const digits = (cleaned + '0').split('').reverse().map(Number);
  
  for (let i = 0; i < digits.length; i++) {
    c = d[c][p[i % 8][digits[i]]];
  }
  
  return inv[c];
}

/**
 * Validate Aadhaar with detailed error messages
 */
export interface AadhaarValidationResult {
  valid: boolean;
  error?: string;
  maskedAadhaar?: string;
}

export function validateAadhaar(aadhaar: string): AadhaarValidationResult {
  // Remove all whitespace
  const cleaned = aadhaar.replace(/\s/g, '');
  
  // Check length
  if (cleaned.length !== 12) {
    return {
      valid: false,
      error: 'Aadhaar must be exactly 12 digits',
    };
  }
  
  // Check if all digits
  if (!/^\d{12}$/.test(cleaned)) {
    return {
      valid: false,
      error: 'Aadhaar must contain only digits',
    };
  }
  
  // Aadhaar cannot start with 0 or 1 (UIDAI rule)
  if (cleaned[0] === '0' || cleaned[0] === '1') {
    return {
      valid: false,
      error: 'Invalid Aadhaar format (cannot start with 0 or 1)',
    };
  }
  
  // Verhoeff checksum validation
  if (!verhoeffValidate(cleaned)) {
    return {
      valid: false,
      error: 'Invalid Aadhaar checksum',
    };
  }
  
  return {
    valid: true,
    maskedAadhaar: `XXXX XXXX ${cleaned.slice(-4)}`,
  };
}

/**
 * Validate Indian mobile number
 */
export interface MobileValidationResult {
  valid: boolean;
  error?: string;
  formattedMobile?: string;
}

export function validateMobile(mobile: string): MobileValidationResult {
  // Remove all whitespace and country code
  let cleaned = mobile.replace(/\s/g, '').replace(/^\+91/, '').replace(/^91/, '');
  
  // Check length
  if (cleaned.length !== 10) {
    return {
      valid: false,
      error: 'Mobile number must be 10 digits',
    };
  }
  
  // Check if all digits
  if (!/^\d{10}$/.test(cleaned)) {
    return {
      valid: false,
      error: 'Mobile number must contain only digits',
    };
  }
  
  // Indian mobile numbers start with 6, 7, 8, or 9
  if (!/^[6-9]/.test(cleaned)) {
    return {
      valid: false,
      error: 'Invalid Indian mobile number (must start with 6, 7, 8, or 9)',
    };
  }
  
  return {
    valid: true,
    formattedMobile: cleaned,
  };
}

/**
 * Validate IFSC code
 */
export function validateIFSC(ifsc: string): { valid: boolean; error?: string } {
  const cleaned = ifsc.toUpperCase().trim();
  
  // IFSC is 11 characters: 4 letters + 0 + 6 alphanumeric
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleaned)) {
    return {
      valid: false,
      error: 'Invalid IFSC format (should be like HDFC0001234)',
    };
  }
  
  return { valid: true };
}

/**
 * Validate PAN number
 */
export function validatePAN(pan: string): { valid: boolean; error?: string; isIndividual?: boolean } {
  const cleaned = pan.toUpperCase().trim();
  
  // PAN is 10 characters: 5 letters + 4 digits + 1 letter
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cleaned)) {
    return {
      valid: false,
      error: 'Invalid PAN format (should be like ABCDE1234F)',
    };
  }
  
  // 4th character indicates entity type
  // P = Individual, C = Company, H = HUF, F = Firm, etc.
  const entityType = cleaned[3];
  const isIndividual = entityType === 'P';
  
  return {
    valid: true,
    isIndividual,
  };
}

/**
 * Validate bank account number
 */
export function validateBankAccount(accountNo: string): { valid: boolean; error?: string } {
  const cleaned = accountNo.replace(/\s/g, '');
  
  // Bank account numbers are typically 9-18 digits
  if (!/^\d{9,18}$/.test(cleaned)) {
    return {
      valid: false,
      error: 'Bank account number must be 9-18 digits',
    };
  }
  
  return { valid: true };
}

/**
 * Validate amount for AEPS transactions
 */
export function validateAmount(
  amount: number | string,
  transactionType: 'balance_inquiry' | 'cash_withdrawal' | 'cash_deposit' | 'mini_statement'
): { valid: boolean; error?: string; parsedAmount?: number } {
  // Balance inquiry and mini statement don't need amount
  if (transactionType === 'balance_inquiry' || transactionType === 'mini_statement') {
    return { valid: true, parsedAmount: 0 };
  }
  
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numAmount) || numAmount <= 0) {
    return {
      valid: false,
      error: 'Amount must be a positive number',
    };
  }
  
  // AEPS amount limits
  const minAmount = 100; // Minimum ₹100
  const maxAmount = transactionType === 'cash_withdrawal' ? 10000 : 50000; // Max per transaction
  
  if (numAmount < minAmount) {
    return {
      valid: false,
      error: `Minimum amount is ₹${minAmount}`,
    };
  }
  
  if (numAmount > maxAmount) {
    return {
      valid: false,
      error: `Maximum amount for ${transactionType === 'cash_withdrawal' ? 'withdrawal' : 'deposit'} is ₹${maxAmount}`,
    };
  }
  
  // Amount must be in multiples of 50 or 100 for AEPS
  if (numAmount % 50 !== 0) {
    return {
      valid: false,
      error: 'Amount must be in multiples of ₹50',
    };
  }
  
  return { valid: true, parsedAmount: numAmount };
}
