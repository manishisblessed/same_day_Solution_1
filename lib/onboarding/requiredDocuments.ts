/**
 * Required onboarding documents per role.
 *
 * Ported from NEXTGEN src/lib/onboarding/requiredDocuments.ts. The wizard gates
 * registration on every `required: true` document being uploaded. Optional docs
 * (GST cert, shop establishment) can be uploaded but do not block registration.
 */

export interface DocSpec {
  type: string
  label: string
  required: boolean
  /** Requires live GPS capture at upload time. */
  gps?: boolean
  /** A prefilled template can be downloaded before signing/uploading. */
  hasTemplate?: boolean
}

export const ONBOARD_DOCUMENTS: DocSpec[] = [
  { type: 'SIGNATURE', label: 'Signature', required: true },
  { type: 'ELECTRICITY_BILL', label: 'Electricity Bill', required: true },
  { type: 'CANCEL_CHEQUE', label: 'Cancelled Cheque', required: true },
  { type: 'ADDITIONAL_ID', label: 'Additional ID (DL / Voter / Passport)', required: true },
  { type: 'FAMILY_REFERENCE', label: 'Family Reference KYC', required: true },
  { type: 'PG_FORM', label: 'Personal Guarantee Form', required: true, hasTemplate: true },
  { type: 'GPS_PHOTO_OUTSIDE', label: 'Shop Photo (Outside)', required: true, gps: true },
  { type: 'GPS_PHOTO_INSIDE', label: 'Shop Photo (Inside)', required: true, gps: true },
  { type: 'GPS_SELFIE_DISTRIBUTOR', label: 'Selfie at Shop', required: true, gps: true },
  // Optional
  { type: 'GST_CERT', label: 'GST Certificate', required: false },
  { type: 'SHOP_ESTABLISHMENT', label: 'Shop Establishment License', required: false },
  { type: 'GUMASTA_LICENSE', label: 'Gumasta License', required: false },
]

export const SELF_DECLARATION_TYPE = 'SELF_DECLARATION'

/**
 * Canonical mandatory document types for a given role. Currently identical for
 * all network roles (matches NEXTGEN), but kept role-parameterised so it can be
 * tuned later.
 */
export function getRequiredDocTypes(_role: string): string[] {
  return ONBOARD_DOCUMENTS.filter((d) => d.required).map((d) => d.type)
}

export function docLabel(type: string): string {
  const spec = ONBOARD_DOCUMENTS.find((d) => d.type === type)
  return spec ? spec.label : type
}

export function isGpsDoc(type: string): boolean {
  return !!ONBOARD_DOCUMENTS.find((d) => d.type === type)?.gps
}
