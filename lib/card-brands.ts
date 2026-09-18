/**
 * Canonical card brand list for scheme MDR slabs.
 *
 * The VALUE stored on a scheme rate must match what the settlement engine
 * derives from a transaction (see normalizeBrandType in lib/mdr-scheme/
 * scheme.service.ts). Storing the canonical uppercase form guarantees a slab
 * added here resolves at settlement time for that brand.
 *
 * NOTE: "Business", "Corporate Card", "International" are card CLASSIFICATIONS,
 * not brands — they live in the Classification dimension, never here.
 */
export interface BrandOption {
  /** Stored value — canonical, matches normalizeBrandType output. */
  value: string
  /** Human-friendly label shown in dropdowns. */
  label: string
}

export const CARD_BRANDS: BrandOption[] = [
  { value: 'VISA', label: 'Visa' },
  { value: 'MASTERCARD', label: 'MasterCard' },
  { value: 'RUPAY', label: 'RuPay' },
  { value: 'AMEX', label: 'American Express (Amex)' },
  { value: 'DINERS', label: 'Diners Club' },
  { value: 'MAESTRO', label: 'Maestro' },
  { value: 'JCB', label: 'JCB' },
  { value: 'DISCOVER', label: 'Discover' },
]

const LABEL_BY_VALUE = new Map(CARD_BRANDS.map((b) => [b.value, b.label]))

/** Friendly label for a stored brand value (falls back to the raw value). */
export function brandLabel(value: string | null | undefined): string {
  if (!value) return '-'
  return LABEL_BY_VALUE.get(value.toUpperCase()) || value
}

/**
 * Brand values selectable for a given mode + card type. Every real card network
 * is offered for every card type so a slab can be added per brand.
 */
export function getSchemeBrandValues(mode: string, cardType: string): string[] {
  if (mode === 'UPI') {
    const ct = cardType || 'UPI'
    if (ct === 'UPI') return ['UPI']
    if (ct === 'CREDIT') return ['RUPAY']
    return []
  }
  if (mode === 'CARD') {
    return CARD_BRANDS.map((b) => b.value)
  }
  return []
}
