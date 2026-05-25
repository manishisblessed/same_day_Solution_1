export {
  checkBalance,
  verifyPAN,
  verifyPAN360,
  verifyGST,
  verifyBankAdvance,
  verifyBankSimple,
  verifyBankPennyLess,
  verifyBankPennyDrop,
  verifyUPI,
  verifyDrivingLicense,
  verifyPassport,
  verifyVoterCard,
  verifyCIN,
  createDigilockerURL,
  getDigilockerDocument,
} from './client'

export {
  getEkycUsername,
  getEkycToken,
  getEkycBaseUrl,
  isEkycMockMode,
  getEkycTimeout,
  validateEkycCredentials,
  generateOrderId,
} from './config'

export type {
  EkycBaseResponse,
  BalanceResponse,
  PANVerificationResponse,
  PAN360Response,
  GSTVerificationResponse,
  BankAdvanceResponse,
  BankSimpleResponse,
  UPIVerificationResponse,
  DLVerificationResponse,
  PassportVerificationResponse,
  VoterVerificationResponse,
  CINVerificationResponse,
  DigilockerCreateURLResponse,
  DigilockerAadhaarResponse,
} from './types'
