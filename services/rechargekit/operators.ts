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

  return {
    ...raw,
    operator_id,
    operator_name,
    operator_code: String(raw.operator_code ?? raw.operatorCode ?? operator_id),
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

    if (!result.ok || !result.data) {
      return {
        success: false,
        error: result.error || 'Failed to fetch operators',
        raw: result.data,
      }
    }

    const list = extractList(result.data)
      .map(normalizeOperator)
      .filter((o): o is RechargekitOperator => o !== null)

    return { success: true, operators: list, raw: result.data }
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to fetch Rechargekit operators' }
  }
}
