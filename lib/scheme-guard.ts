/**
 * Centralized guard for scheme (pricing) enforcement.
 *
 * FINANCIAL SAFETY: A user must have a pricing scheme resolved before any
 * charge-based transaction (BBPS, Pay2New, Rechargekit, Payout, Settlement-2)
 * is allowed. Without a scheme, charges resolve to ₹0 and the transaction would
 * effectively be FREE — a direct revenue loss. All such routes must block the
 * transaction with SCHEME_NOT_ASSIGNED instead of falling back to a free/₹0 charge.
 */

export const SCHEME_NOT_ASSIGNED = {
  success: false,
  error:
    'No pricing scheme is assigned to your account, so this transaction cannot be processed. Please contact your distributor or support to get a scheme assigned.',
  code: 'SCHEME_NOT_ASSIGNED',
} as const

export const SCHEME_NOT_ASSIGNED_STATUS = 403
