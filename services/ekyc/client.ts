/**
 * eKYC Hub API Client
 * All verification methods for connect.ekychub.in
 */

import {
  getEkycBaseUrl,
  getEkycUsername,
  getEkycToken,
  getEkycTimeout,
  isEkycMockMode,
  validateEkycCredentials,
} from './config'
import type {
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

async function callEkycHub<T>(
  endpoint: string,
  params: Record<string, string> = {}
): Promise<T> {
  validateEkycCredentials()

  const baseUrl = getEkycBaseUrl()
  const url = new URL(`${baseUrl}/${endpoint}`)
  url.searchParams.set('username', getEkycUsername())
  url.searchParams.set('token', getEkycToken())

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value)
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), getEkycTimeout())

  try {
    console.log(`[eKYC Hub] Calling ${endpoint}`)
    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal,
    })

    const text = await response.text()
    let data: T

    try {
      data = JSON.parse(text)
    } catch {
      console.error(`[eKYC Hub] Invalid JSON from ${endpoint}:`, text.substring(0, 200))
      throw new Error('Invalid response from eKYC Hub API')
    }

    console.log(`[eKYC Hub] ${endpoint} status:`, (data as any).status)
    return data
  } finally {
    clearTimeout(timeoutId)
  }
}

// ─── Mock Responses ───

function getMockPANResponse(pan: string): PANVerificationResponse {
  return {
    status: 'Success',
    pan,
    type: 'Individual',
    registered_name: 'MOCK USER NAME',
    message: 'PAN verified successfully',
  }
}

function getMockPAN360Response(pan: string): PAN360Response {
  return {
    status: 'Success',
    pan,
    type: 'Individual or Person',
    registered_name: 'MOCK USER NAME',
    gender: 'MALE',
    date_of_birth: '01-01-1990',
    masked_aadhaar_number: 'XXXXXXXX1234',
    aadhaar_linked: true,
    message: 'PAN verified successfully',
  }
}

function getMockBankResponse(): BankSimpleResponse {
  return {
    status: 'Success',
    nameAtBank: 'MOCK ACCOUNT HOLDER',
    utr: 'MOCK_UTR_' + Date.now(),
    message: 'Bank Account details verified successfully',
  }
}

function getMockBankAdvanceResponse(): BankAdvanceResponse {
  return {
    status: 'Success',
    nameAtBank: 'MOCK ACCOUNT HOLDER',
    bankName: 'MOCK BANK LIMITED',
    utr: 'MOCK_UTR_' + Date.now(),
    city: 'MOCK CITY',
    branch: 'MOCK BRANCH',
    micr: 123456,
    message: 'Bank Account details verified successfully',
  }
}

function getMockGSTResponse(gst: string): GSTVerificationResponse {
  return {
    status: 'Success',
    GSTIN: gst,
    legal_name_of_business: 'MOCK BUSINESS NAME',
    trade_name_of_business: 'MOCK TRADE NAME',
    center_jurisdiction: 'MOCK RANGE',
    state_jurisdiction: 'MOCK STATE',
    constitution_of_business: 'Sole Proprietorship',
    taxpayer_type: 'Regular',
    gst_in_status: 'Active',
    last_update_date: '2024-01-01',
    principal_place_address: 'Mock Address, Mock City, 700001',
    message: 'GSTIN Exists',
  }
}

function getMockUPIResponse(): UPIVerificationResponse {
  return {
    status: 'Success',
    nameAtBank: 'MOCK UPI HOLDER',
    accountExists: 'YES',
    message: 'VPA verification successful',
  }
}

function getMockBalanceResponse(): BalanceResponse {
  return {
    status: 'Success',
    balance: '999.00',
  }
}

// ─── Public API Methods ───

export async function checkBalance(): Promise<BalanceResponse> {
  if (isEkycMockMode()) {
    return getMockBalanceResponse()
  }
  return callEkycHub<BalanceResponse>('verification/balance')
}

export async function verifyPAN(
  pan: string,
  orderid: string
): Promise<PANVerificationResponse> {
  if (isEkycMockMode()) {
    return getMockPANResponse(pan)
  }
  return callEkycHub<PANVerificationResponse>('verification/pan_verification', {
    pan,
    orderid,
  })
}

export async function verifyPAN360(
  pan: string,
  orderid: string
): Promise<PAN360Response> {
  if (isEkycMockMode()) {
    return getMockPAN360Response(pan)
  }
  return callEkycHub<PAN360Response>('verification/pan_360', {
    pan,
    orderid,
  })
}

export async function verifyGST(
  gst: string,
  orderid: string
): Promise<GSTVerificationResponse> {
  if (isEkycMockMode()) {
    return getMockGSTResponse(gst)
  }
  return callEkycHub<GSTVerificationResponse>('verification/gst_verification', {
    gst,
    orderid,
  })
}

export async function verifyBankAdvance(
  account_number: string,
  ifsc: string,
  orderid: string
): Promise<BankAdvanceResponse> {
  if (isEkycMockMode()) {
    return getMockBankAdvanceResponse()
  }
  return callEkycHub<BankAdvanceResponse>('verification/bank_verification', {
    account_number,
    ifsc,
    orderid,
  })
}

export async function verifyBankSimple(
  account_number: string,
  ifsc: string,
  orderid: string
): Promise<BankSimpleResponse> {
  if (isEkycMockMode()) {
    return getMockBankResponse()
  }
  return callEkycHub<BankSimpleResponse>('verification/bank_verification_simple', {
    account_number,
    ifsc,
    orderid,
  })
}

export async function verifyBankPennyLess(
  account_number: string,
  ifsc: string,
  orderid: string
): Promise<BankSimpleResponse> {
  if (isEkycMockMode()) {
    return getMockBankResponse()
  }
  return callEkycHub<BankSimpleResponse>('verification/penny_less', {
    account_number,
    ifsc,
    orderid,
  })
}

export async function verifyBankPennyDrop(
  account_number: string,
  ifsc: string,
  orderid: string
): Promise<BankSimpleResponse> {
  if (isEkycMockMode()) {
    return getMockBankResponse()
  }
  return callEkycHub<BankSimpleResponse>('verification/penny_drop', {
    account_number,
    ifsc,
    orderid,
  })
}

export async function verifyUPI(
  upi: string,
  orderid: string
): Promise<UPIVerificationResponse> {
  if (isEkycMockMode()) {
    return getMockUPIResponse()
  }
  return callEkycHub<UPIVerificationResponse>('verification/verify_upi', {
    upi,
    orderid,
  })
}

export async function verifyDrivingLicense(
  dl_number: string,
  dob: string,
  orderid: string
): Promise<DLVerificationResponse> {
  if (isEkycMockMode()) {
    return {
      status: 'Success',
      dl_number,
      dob,
      name: 'MOCK DL HOLDER',
      dl_status: 'ACTIVE',
      class_of_vehicle: 'LMV',
      message: 'Driving License Verified successfully',
    }
  }
  return callEkycHub<DLVerificationResponse>('verification/driving', {
    dl_numner: dl_number, // API uses this spelling
    dob,
    orderid,
  })
}

export async function verifyPassport(
  file_number: string,
  dob: string,
  orderid: string
): Promise<PassportVerificationResponse> {
  if (isEkycMockMode()) {
    return {
      status: 'Success',
      file_number,
      name: 'MOCK PASSPORT HOLDER',
      dob,
      application_type: 'NORMAL',
      message: 'Passport Verification done successfully',
    }
  }
  return callEkycHub<PassportVerificationResponse>('verification/passport', {
    file_number,
    dob,
    orderid,
  })
}

export async function verifyVoterCard(
  epic_number: string,
  orderid: string
): Promise<VoterVerificationResponse> {
  if (isEkycMockMode()) {
    return {
      status: 'Success',
      message: 'verification done successfully',
      data: {
        epic_number,
        status: 'VALID',
        name: 'MOCK VOTER NAME',
        gender: 'Male',
        state: 'MOCK STATE',
      },
    }
  }
  return callEkycHub<VoterVerificationResponse>('verification/voter', {
    epic_number,
    orderid,
  })
}

export async function verifyCIN(
  cin: string,
  orderid: string
): Promise<CINVerificationResponse> {
  if (isEkycMockMode()) {
    return {
      status: 'Success',
      company_name: 'MOCK COMPANY PVT LTD',
      message: 'CIN Verification done successfully',
      data: {
        cin,
        company_name: 'MOCK COMPANY PVT LTD',
        cin_status: 'ACTIVE',
        status: 'VALID',
        incorporation_date: '2020-01-01',
        email: 'mock@company.com',
        incorporation_country: 'INDIA',
        director_details: [],
      },
    }
  }
  return callEkycHub<CINVerificationResponse>('verification/cin', {
    cin,
    orderid,
  })
}

export async function createDigilockerURL(
  type: 'aadhaar' | 'pan',
  redirect_url: string,
  orderid: string
): Promise<DigilockerCreateURLResponse> {
  if (isEkycMockMode()) {
    return {
      status: 'Success',
      verification_id: 'MOCK_VID_' + Date.now(),
      reference_id: Date.now(),
      url: 'https://mock-digilocker.example.com/redirect',
      document_requested: [type === 'aadhaar' ? 'AADHAAR' : 'PAN'],
      user_flow: 'signup',
      redirect_url,
      message: 'Digilocker URL is created',
      txid: Date.now(),
    }
  }
  const endpoint =
    type === 'aadhaar'
      ? 'digilocker/create_url_aadhaar'
      : 'digilocker/create_url_pan'
  return callEkycHub<DigilockerCreateURLResponse>(endpoint, {
    redirect_url,
    orderid,
  })
}

export async function getDigilockerDocument(
  verification_id: string,
  reference_id: string,
  orderid: string,
  document_type: 'AADHAAR' | 'PAN'
): Promise<DigilockerAadhaarResponse> {
  if (isEkycMockMode()) {
    return {
      status: 'Success',
      verification_id,
      name: 'MOCK DIGILOCKER USER',
      uid: 'XXXX XXXX 1234',
      dob: '01-01-1990',
      gender: 'M',
      address: 'Mock Address, Mock City, 700001',
      message: 'Aadhaar Card Exists',
    }
  }
  return callEkycHub<DigilockerAadhaarResponse>('digilocker/get_document', {
    verification_id,
    reference_id,
    orderid,
    document_type,
  })
}
