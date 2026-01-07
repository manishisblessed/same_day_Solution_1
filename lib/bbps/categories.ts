/**
 * BBPS Category List
 * Based on SparkUpTech BBPS API documentation
 */
export const BBPS_CATEGORIES = [
  'Broadband Postpaid',
  'Cable TV',
  'Clubs and Associations',
  'Credit Card',
  'Donation',
  'DTH',
  'Education Fees',
  'Electricity',
  'Fastag',
  'Gas',
  'Hospital',
  'Hospital and Pathology',
  'Housing Society',
  'Insurance',
  'Landline Postpaid',
  'Loan Repayment',
  'LPG Gas',
  'Mobile Postpaid',
  'Mobile Prepaid',
  'Municipal Services',
  'Municipal Taxes',
  'Recurring Deposit',
  'Rental',
  'Subscription',
  'Water',
  'NCMC Recharge',
  'NPS',
  'Prepaid meter',
] as const

export type BBPSCategory = typeof BBPS_CATEGORIES[number]

/**
 * Get all available BBPS categories
 */
export function getBBPSCategories(): string[] {
  return [...BBPS_CATEGORIES]
}

/**
 * Check if a category is valid
 */
export function isValidBBPSCategory(category: string): boolean {
  return BBPS_CATEGORIES.includes(category as BBPSCategory)
}

