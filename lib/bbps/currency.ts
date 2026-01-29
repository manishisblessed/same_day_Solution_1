/**
 * BBPS Currency Utilities
 * 
 * BBPS Fetch Bill API returns monetary amounts in paise (smallest currency unit).
 * This module provides utilities to convert between paise and rupees for display purposes.
 * 
 * IMPORTANT: Sparkup Pay Request API expects amounts in RUPEES (not paise).
 * - Fetch Bill API: Returns amounts in paise (e.g., 20000 = ₹200)
 * - Pay Request API: Expects amounts in rupees (e.g., 200 = ₹200)
 * 
 * Always convert paise to rupees before calling payRequest.
 */

/**
 * Convert paise to rupees for display purposes
 * 
 * BBPS APIs return amounts in paise (e.g., 10182344 paise).
 * This function converts to rupees by dividing by 100 (e.g., 101823.44 rupees).
 * 
 * @param paise - Amount in paise (number or string)
 * @returns Amount in rupees as a number (e.g., 101823.44)
 * 
 * @example
 * paiseToRupees(10182344) // Returns 101823.44
 * paiseToRupees("10182344") // Returns 101823.44
 * paiseToRupees("1,01,82,344") // Returns 101823.44 (handles formatted strings)
 */
export function paiseToRupees(paise: number | string | undefined | null): number {
  if (paise === undefined || paise === null) return 0
  
  // Handle number input
  if (typeof paise === 'number') {
    return paise / 100
  }
  
  // Handle string input - remove formatting (commas, spaces, currency symbols)
  const cleaned = String(paise).replace(/[,\s₹]/g, '')
  const parsed = parseFloat(cleaned)
  
  if (isNaN(parsed)) {
    console.warn(`[paiseToRupees] Invalid input: ${paise}, returning 0`)
    return 0
  }
  
  return parsed / 100
}

/**
 * Format rupees amount for display with Indian number formatting
 * 
 * @param rupees - Amount in rupees (number)
 * @param options - Formatting options
 * @returns Formatted string (e.g., "₹1,01,823.44")
 * 
 * @example
 * formatRupees(101823.44) // Returns "₹1,01,823.44"
 */
export function formatRupees(
  rupees: number,
  options: {
    showCurrency?: boolean
    minimumFractionDigits?: number
    maximumFractionDigits?: number
  } = {}
): string {
  const {
    showCurrency = true,
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
  } = options

  const formatted = rupees.toLocaleString('en-IN', {
    minimumFractionDigits,
    maximumFractionDigits,
  })

  return showCurrency ? `₹${formatted}` : formatted
}

/**
 * Convert paise to rupees and format for display
 * Convenience function that combines paiseToRupees and formatRupees
 * 
 * @param paise - Amount in paise (number or string)
 * @param options - Formatting options
 * @returns Formatted string (e.g., "₹1,01,823.44")
 * 
 * @example
 * formatPaiseAsRupees(10182344) // Returns "₹1,01,823.44"
 */
export function formatPaiseAsRupees(
  paise: number | string | undefined | null,
  options: {
    showCurrency?: boolean
    minimumFractionDigits?: number
    maximumFractionDigits?: number
  } = {}
): string {
  const rupees = paiseToRupees(paise)
  return formatRupees(rupees, options)
}

