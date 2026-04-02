import { getEzetapApiBaseUrl, getEzetapCredentials, type EzetapCredentials } from './config'

export type EzetapHttpResult = {
  ok: boolean
  status: number
  data: unknown
}

async function postEzetap(path: string, body: Record<string, unknown>): Promise<EzetapHttpResult> {
  const base = getEzetapApiBaseUrl().replace(/\/$/, '')
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { _raw: text }
  }
  return { ok: res.ok, status: res.status, data }
}

export function resolveDeviceId(deviceSerial?: string, deviceId?: string): string {
  const full = (deviceId || '').trim()
  if (full.includes('|')) return full
  const serial = (deviceSerial || '').trim()
  if (!serial) throw new Error('device_serial or device_id (serial|ezetap_android) is required')
  return serial.includes('|') ? serial : `${serial}|ezetap_android`
}

export type PayInput = {
  merchant_slug: string
  amount: string | number
  mode: string
  device_serial?: string
  device_id?: string
  customerMobile?: string
  customerMobileNumber?: string
  accountLabel?: string
  externalRefNumber?: string
  externalRefNumber2?: string
  externalRefNumber3?: string
  externalRefNumber4?: string
  externalRefNumber5?: string
  externalRefNumbers?: string[]
}

export async function ezetapPay(creds: EzetapCredentials, input: PayInput): Promise<EzetapHttpResult> {
  const deviceId = resolveDeviceId(input.device_serial, input.device_id)
  const body: Record<string, unknown> = {
    username: creds.username,
    appKey: creds.appKey,
    amount: String(input.amount),
    mode: input.mode,
    pushTo: { deviceId },
  }
  const optKeys = [
    'customerMobile',
    'customerMobileNumber',
    'accountLabel',
    'externalRefNumber',
    'externalRefNumber2',
    'externalRefNumber3',
    'externalRefNumber4',
    'externalRefNumber5',
  ] as const
  for (const k of optKeys) {
    const v = input[k]
    if (v != null && String(v).trim() !== '') body[k] = v
  }
  if (Array.isArray(input.externalRefNumbers) && input.externalRefNumbers.length > 0) {
    body.externalRefNumbers = input.externalRefNumbers
  }
  return postEzetap('/api/3.0/p2padapter/pay', body)
}

export async function ezetapPayWithSlug(input: PayInput): Promise<EzetapHttpResult> {
  const creds = getEzetapCredentials(input.merchant_slug)
  return ezetapPay(creds, input)
}

export async function ezetapStatus(
  merchant_slug: string,
  origP2pRequestId: string
): Promise<EzetapHttpResult> {
  const creds = getEzetapCredentials(merchant_slug)
  return postEzetap('/api/3.0/p2padapter/status', {
    username: creds.username,
    appKey: creds.appKey,
    origP2pRequestId,
  })
}

export async function ezetapCancel(
  merchant_slug: string,
  origP2pRequestId: string,
  device_serial?: string,
  device_id?: string
): Promise<EzetapHttpResult> {
  const creds = getEzetapCredentials(merchant_slug)
  const deviceId = resolveDeviceId(device_serial, device_id)
  return postEzetap('/api/3.0/p2p/cancel', {
    username: creds.username,
    appKey: creds.appKey,
    origP2pRequestId,
    pushTo: { deviceId },
  })
}

export type RefundInput = {
  merchant_slug: string
  amount: string | number
  externalRefNumber: string
  externalRefNumber2?: string
}

export async function ezetapRefund(input: RefundInput): Promise<EzetapHttpResult> {
  const creds = getEzetapCredentials(input.merchant_slug)
  const body: Record<string, unknown> = {
    username: creds.username,
    appKey: creds.appKey,
    amount: String(input.amount),
    externalRefNumber: input.externalRefNumber,
  }
  if (input.externalRefNumber2 != null && String(input.externalRefNumber2).trim() !== '') {
    body.externalRefNumber2 = input.externalRefNumber2
  }
  return postEzetap('/api/2.0/payment/refund', body)
}

export async function ezetapVoid(merchant_slug: string, txnId: string): Promise<EzetapHttpResult> {
  const creds = getEzetapCredentials(merchant_slug)
  return postEzetap('/api/2.0/payment/void', {
    username: creds.username,
    appKey: creds.appKey,
    txnId,
  })
}
