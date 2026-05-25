/**
 * eKYC Hub API Response Types
 * Based on connect.ekychub.in API documentation
 */

export interface EkycBaseResponse {
  status: 'Success' | 'Failure'
  message?: string
}

// Balance Check
export interface BalanceResponse extends EkycBaseResponse {
  balance?: string
}

// PAN Verification
export interface PANVerificationResponse extends EkycBaseResponse {
  pan?: string
  type?: string
  registered_name?: string
}

// PAN 360
export interface PAN360Response extends EkycBaseResponse {
  pan?: string
  type?: string
  registered_name?: string
  gender?: string
  date_of_birth?: string
  masked_aadhaar_number?: string
  aadhaar_linked?: boolean
}

// GST Verification
export interface GSTVerificationResponse extends EkycBaseResponse {
  GSTIN?: string
  legal_name_of_business?: string
  trade_name_of_business?: string
  center_jurisdiction?: string
  state_jurisdiction?: string
  constitution_of_business?: string
  taxpayer_type?: string
  gst_in_status?: string
  last_update_date?: string
  principal_place_address?: string
}

// Bank Verification (Advance)
export interface BankAdvanceResponse extends EkycBaseResponse {
  nameAtBank?: string
  bankName?: string
  utr?: string
  city?: string
  branch?: string
  micr?: number
}

// Bank Verification (Simple / Penny Less / Penny Drop) - same shape
export interface BankSimpleResponse extends EkycBaseResponse {
  'Account Number'?: string
  'Ifsc Code'?: string
  nameAtBank?: string
  utr?: string
}

// UPI Verification
export interface UPIVerificationResponse extends EkycBaseResponse {
  nameAtBank?: string | null
  accountExists?: string | null
}

// Driving License
export interface DLVerificationResponse extends EkycBaseResponse {
  dl_number?: string
  dob?: string
  class_of_vehicle?: string
  non_transport_from?: string
  non_transport_to?: string
  hazardous_valid_till?: string | null
  transport_from?: string | null
  transport_to?: string | null
  hill_valid_till?: string | null
  date_of_issue?: string
  dl_status?: string
  name?: string
  father_or_husband_name?: string
  complete_address?: string
}

// Passport Verification
export interface PassportVerificationResponse extends EkycBaseResponse {
  file_number?: string
  name?: string
  dob?: string
  application_type?: string
  application_received_date?: string
}

// Voter Card Verification
export interface VoterVerificationResponse extends EkycBaseResponse {
  data?: {
    verification_id?: string
    reference_id?: number
    epic_number?: string
    status?: string
    name?: string
    name_in_regional_lang?: string
    age?: string
    relation_type?: string
    relation_name?: string
    relation_name_in_regional_lang?: string
    father_name?: string
    dob?: string
    gender?: string
    state?: string
    assembly_constituency_number?: string
    assembly_constituency?: string
    parliamentary_constituency_number?: string
    parliamentary_constituency?: string
    part_number?: string
    part_name?: string
    serial_number?: string
    polling_station?: string
    address?: string
    photo?: string | null
    split_address?: {
      district?: string[]
      state?: string[][]
      city?: string[]
      pincode?: string
      country?: string[]
      address_line?: string
    }
  }
}

// Company CIN Verification
export interface CINVerificationResponse extends EkycBaseResponse {
  company_name?: string
  data?: {
    verification_id?: string
    reference_id?: number
    status?: string
    cin?: string
    company_name?: string
    registration_number?: number
    incorporation_date?: string
    cin_status?: string
    email?: string
    incorporation_country?: string
    director_details?: Array<{
      dob?: string
      designation?: string
      address?: string
      din?: string
      name?: string
    }>
  }
}

// DigiLocker Create URL
export interface DigilockerCreateURLResponse extends EkycBaseResponse {
  verification_id?: string
  reference_id?: number
  url?: string
  document_requested?: string[]
  user_flow?: string
  redirect_url?: string
  txid?: number
  type?: string
  code?: string
}

// DigiLocker Get Document (Aadhaar)
export interface DigilockerAadhaarResponse extends EkycBaseResponse {
  reference_id?: number
  verification_id?: string
  name?: string
  uid?: string
  dob?: string
  gender?: string
  care_of?: string
  address?: string
  split_address?: {
    country?: string
    dist?: string
    house?: string
    landmark?: string
    pincode?: string
    po?: string
    state?: string
    street?: string
    subdist?: string
    vtc?: string
  }
  year_of_birth?: string
  photo_link?: string
  xml_file?: string
}
