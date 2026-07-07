/**
 * Razorpay POS merchant companies (webhook path slug + admin filters).
 * Used by partner API responses and optional merchant_slug filters.
 */
export const POS_MERCHANT_SLUGS = ['ashvam', 'teachway', 'newscenaric', 'lagoon', 'avika'] as const
export type POSMerchantSlug = (typeof POS_MERCHANT_SLUGS)[number]

const DISPLAY_NAMES: Record<string, string> = {
  ashvam: 'ASHVAM LEARNING PRIVATE LIMITED',
  teachway: 'Teachway Education Private Limited',
  newscenaric: 'New Scenaric Travels',
  lagoon: 'LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED',
  avika: 'Avika Departmental Private Limited',
}

const SHORT_NAMES: Record<string, string> = {
  ashvam: 'ASHVAM',
  teachway: 'Teachway',
  newscenaric: 'New Scenaric',
  lagoon: 'Lagoon',
  avika: 'Avika',
}

export interface PosCompany {
  slug: string
  name: string
  shortName: string
}

/** Canonical list of all POS merchant companies (slug, full name, short name). */
export function getPosCompanies(): PosCompany[] {
  return POS_MERCHANT_SLUGS.map((slug) => ({
    slug,
    name: DISPLAY_NAMES[slug],
    shortName: SHORT_NAMES[slug] || DISPLAY_NAMES[slug],
  }))
}

export function companyDisplayNameForSlug(slug: string | null | undefined): string {
  const key = (slug || 'ashvam').toLowerCase().trim()
  return DISPLAY_NAMES[key] || (slug ? String(slug) : DISPLAY_NAMES.ashvam)
}

export function isValidPOSMerchantSlug(value: string): boolean {
  const s = value.toLowerCase().trim()
  return (POS_MERCHANT_SLUGS as readonly string[]).includes(s)
}

/** API metadata for integrators */
export function posMerchantCompaniesMeta() {
  return POS_MERCHANT_SLUGS.map((slug) => ({
    merchant_slug: slug,
    company_name: DISPLAY_NAMES[slug],
  }))
}
