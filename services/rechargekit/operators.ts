/**
 * Rechargekit Operator List
 * GET /recharge/servicewiseOperatorFetch?operator_category=11
 */

import { rechargekitGet } from './client'
import type { RechargekitOperator } from './types'

export const RECHARGEKIT_CC_OPERATOR_CATEGORY = '11'

function normalizeOperator(raw: any): RechargekitOperator | null {
  if (!raw || typeof raw !== 'object') return null

  const operator_id = String(
    raw.operator_id ?? raw.operatorId ?? raw.id ?? raw.opid ?? raw.op_id ?? ''
  ).trim()
  const operator_name = String(
    raw.operator_name ??
      raw.operatorName ??
      raw.name ??
      raw.opname ??
      raw.op_name ??
      raw.operator ??
      ''
  ).trim()

  if (!operator_id || !operator_name) return null

  // Provider may return the CC IFSC under any of several key spellings.
  const operator_ifsc = String(
    raw.operator_ifsc ??
      raw.operatorIfsc ??
      raw.ifsc ??
      raw.IFSC ??
      raw.ifsc_code ??
      raw.ifscCode ??
      raw.bank_ifsc ??
      raw.bankIfsc ??
      raw.cc_ifsc ??
      raw.ccIfsc ??
      ''
  ).trim()

  return {
    ...raw,
    operator_id,
    operator_name,
    operator_code: String(raw.operator_code ?? raw.operatorCode ?? operator_id),
    operator_ifsc: operator_ifsc || undefined,
  }
}

function extractList(data: any): any[] {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data.operators)) return data.operators
  if (Array.isArray(data.operatorList)) return data.operatorList
  if (Array.isArray(data.operator_list)) return data.operator_list
  if (Array.isArray(data.result)) return data.result
  if (Array.isArray(data.list)) return data.list
  return []
}

export async function getRechargekitCcOperators(): Promise<{
  success: boolean
  operators?: RechargekitOperator[]
  error?: string
  raw?: unknown
}> {
  try {
    const result = await rechargekitGet<any>(
      'recharge/servicewiseOperatorFetch',
      { operator_category: RECHARGEKIT_CC_OPERATOR_CATEGORY }
    )

    // The operator-list endpoint uses `error === 0` success semantics (like
    // balanceCheck), NOT the payment status 1/2/3 codes. The generic client can
    // flag a valid list as a "business failure" when the body carries a non-1/2
    // `status` field, so always inspect the raw body for a list first.
    const body = result.data as any
    const list = extractList(body)
      .map(normalizeOperator)
      .filter((o): o is RechargekitOperator => o !== null)

    if (list.length > 0) {
      return { success: true, operators: list, raw: body }
    }

    // No list parsed. If the provider call failed (auth 401/403, 5xx, or a
    // business error such as "access denied" / "no operator found"), surface
    // the real reason instead of masking it as an empty catalogue.
    if (!result.ok) {
      return {
        success: false,
        error: result.error || 'Failed to fetch operators',
        raw: body,
      }
    }

    // HTTP-OK response with a genuinely empty catalogue for this category.
    console.warn(
      '[Rechargekit] Empty CC operator list for category',
      RECHARGEKIT_CC_OPERATOR_CATEGORY,
      body && typeof body === 'object'
        ? { error: body.error ?? body.status, msg: body.msg ?? body.message }
        : undefined
    )
    return { success: true, operators: [], raw: body }
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to fetch Rechargekit operators' }
  }
}
