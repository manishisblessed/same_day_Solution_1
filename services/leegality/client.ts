import { getLeegalityBaseUrl, getLeegalityAuthToken, getLeegalityTimeout } from './config'
import type {
  LeegalityCreateRequest,
  LeegalityCreateResponse,
  LeegalityDocumentDetails,
  DocumentDownloadType,
} from './types'

async function leegalityFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const baseUrl = getLeegalityBaseUrl()
  const url = `${baseUrl}/${endpoint}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), getLeegalityTimeout())

  try {
    console.log(`[Leegality] ${options.method || 'GET'} ${endpoint}`)

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': getLeegalityAuthToken(),
        ...options.headers,
      },
    })

    const text = await response.text()
    let data: T

    try {
      data = JSON.parse(text)
    } catch {
      console.error(`[Leegality] Invalid JSON from ${endpoint}:`, text.substring(0, 300))
      throw new Error('Invalid response from Leegality API')
    }

    if (!response.ok) {
      console.error(`[Leegality] ${response.status} from ${endpoint}:`, data)
      throw new Error(
        `Leegality API error ${response.status}: ${(data as any)?.message || (data as any)?.error || 'Unknown error'}`
      )
    }

    return data
  } finally {
    clearTimeout(timeoutId)
  }
}

/** Create an eSigning request */
export async function createSigningRequest(
  payload: LeegalityCreateRequest
): Promise<LeegalityCreateResponse> {
  return leegalityFetch<LeegalityCreateResponse>('v3.0/sign/request', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Fetch document details and status */
export async function getDocumentDetails(
  documentId: string,
  options?: { file?: boolean; auditTrail?: boolean }
): Promise<LeegalityDocumentDetails> {
  const params = new URLSearchParams({ documentId })
  if (options?.file) params.set('file', 'true')
  if (options?.auditTrail) params.set('auditTrail', 'true')

  return leegalityFetch<LeegalityDocumentDetails>(
    `v3.3/document/details?${params.toString()}`,
    { method: 'GET' }
  )
}

/** Download document, audit trail, or attachments */
export async function fetchDocument(
  documentId: string,
  downloadType: DocumentDownloadType,
  options?: { supportDocumentUrl?: string; index?: number }
): Promise<{ url: string }> {
  const params = new URLSearchParams({ documentId, documentDownloadType: downloadType })
  if (options?.supportDocumentUrl) params.set('supportDocumentUrl', options.supportDocumentUrl)
  if (options?.index !== undefined) params.set('index', String(options.index))

  return leegalityFetch<{ url: string }>(
    `v3.3/document/fetchDocument?${params.toString()}`,
    { method: 'GET' }
  )
}

/** Delete a document */
export async function deleteDocument(documentId: string): Promise<void> {
  await leegalityFetch(`v3.0/sign/request?documentId=${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  })
}

/** Delete a specific invitation */
export async function deleteInvitation(signUrl: string): Promise<void> {
  await leegalityFetch(
    `v3.0/sign/request/invitation?signUrl=${encodeURIComponent(signUrl)}`,
    { method: 'DELETE' }
  )
}

/** Reactivate an expired document (within 30 days) */
export async function reactivateDocument(
  documentId: string,
  expiryDays?: number
): Promise<void> {
  await leegalityFetch('v3.0/sign/request/reactivate', {
    method: 'POST',
    body: JSON.stringify({ documentId, ...(expiryDays && { expiryDays }) }),
  })
}

/** Resend signing notification */
export async function resendNotification(signUrls: string[]): Promise<void> {
  await leegalityFetch('v3.0/sign/request/resend', {
    method: 'POST',
    body: JSON.stringify({ signUrls }),
  })
}

/** Mark document as complete (must have no active invitations) */
export async function markDocumentComplete(documentId: string): Promise<void> {
  await leegalityFetch('v3.0/sign/request/complete', {
    method: 'POST',
    body: JSON.stringify({ documentId }),
  })
}

/** Activate an inactive invitation */
export async function activateInvitation(signUrl: string): Promise<void> {
  await leegalityFetch(
    `v3.1/invitation/activate?signUrl=${encodeURIComponent(signUrl)}`,
    { method: 'PUT' }
  )
}

/** eSign a DocSigner invitation */
export async function eSignDocSigner(
  signUrl: string,
  profileId: string
): Promise<void> {
  const consent =
    'By using this authenticated API and the ProfileID associated with this Document Signer Certificate, I agree that the Document Signer Certificate saved in this Account will be used to eSign documents for me. I also understand that recipients of such electronic documents will be able to see my signing details.'

  await leegalityFetch('v3.0/sign/docSigner/invitation', {
    method: 'POST',
    body: JSON.stringify({ signUrl, profileId, consent }),
  })
}
