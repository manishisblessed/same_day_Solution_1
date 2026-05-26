/**
 * BBPS Category Groups — aligned to Chagans 27 categories.
 * Single source of truth for retailer/partner dashboards and BBPSPayment UI.
 */

export interface BBPSCategoryGroup {
  id: string
  label: string
  description: string
  icon: string
  color: string
  categories: string[]
  prepaid?: boolean
}

export const BBPS_CATEGORY_GROUPS: BBPSCategoryGroup[] = [
  {
    id: 'recharge',
    label: 'Recharge',
    description: 'Mobile, DTH, Fastag, EV, NCMC',
    icon: '📱',
    color: 'from-blue-500 to-blue-600',
    categories: [
      'Mobile Prepaid',
      'DTH',
      'Fastag',
      'EV Recharge',
      'Fleet Card Recharge',
      'NCMC Recharge',
    ],
    prepaid: true,
  },
  {
    id: 'postpaid',
    label: 'Postpaid & Telecom',
    description: 'Mobile, Landline, Broadband, Cable',
    icon: '📞',
    color: 'from-cyan-500 to-cyan-600',
    categories: [
      'Mobile Postpaid',
      'Landline Postpaid',
      'Broadband Postpaid',
      'Cable TV',
    ],
  },
  {
    id: 'utilities',
    label: 'Utility Bills',
    description: 'Electricity, Gas, Water, Society',
    icon: '💡',
    color: 'from-green-500 to-green-600',
    categories: [
      'Electricity',
      'Gas',
      'Water',
      'Housing Society',
      'Municipal Taxes',
      'Municipal Services',
      'Rental',
    ],
  },
  {
    id: 'creditcard',
    label: 'Credit Card',
    description: 'Credit Card Bill Payment',
    icon: '💳',
    color: 'from-purple-500 to-purple-600',
    categories: ['Credit Card'],
  },
  {
    id: 'others',
    label: 'More Services',
    description: 'Insurance, Loan, eChallan, NPS',
    icon: '📋',
    color: 'from-orange-500 to-orange-600',
    categories: [
      'Education Fee',
      'Insurance',
      'Donation',
      'Loan Repayment',
      'Subscription',
      'eChallan',
      'Clubs and Associations',
      'National Pension System',
    ],
  },
]

/** Flat list of all prepaid category names */
export const PREPAID_CATEGORY_NAMES = BBPS_CATEGORY_GROUPS
  .filter((g) => g.prepaid)
  .flatMap((g) => g.categories)

/** Check if a category is prepaid (no bill fetch needed) */
export function isPrepaidCategoryName(category: string): boolean {
  const lower = category.toLowerCase()
  return PREPAID_CATEGORY_NAMES.some(
    (pc) => pc.toLowerCase() === lower || lower.includes(pc.toLowerCase())
  )
}

/** Get group for a category name */
export function getCategoryGroup(category: string): BBPSCategoryGroup | undefined {
  const lower = category.toLowerCase()
  return BBPS_CATEGORY_GROUPS.find((g) =>
    g.categories.some((c) => c.toLowerCase() === lower || lower.includes(c.toLowerCase()))
  )
}

/** Get all category names from a group id */
export function getCategoriesByGroupId(groupId: string): string[] {
  return BBPS_CATEGORY_GROUPS.find((g) => g.id === groupId)?.categories || []
}
