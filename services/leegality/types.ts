export interface LeegalityInvitee {
  name: string
  email?: string
  phone?: string
  signUrl?: string
  /** Sequential signing order (1 = first, 2 = second, etc.) */
  signingOrder?: number
}

export interface LeegalityCreateRequest {
  profileId: string
  invitees: LeegalityInvitee[]
  file?: {
    name: string
    file: string  // base64-encoded PDF
  }
  fields?: Record<string, string>
  irn?: string
  expiry?: number
  /** e-Stamp series ID (e.g., "01") — confirmed from Leegality dashboard network payload */
  stampSeries?: string
  /** e-Stamp paper details — party names shown on the stamp certificate */
  stampPaperDetails?: {
    firstPartyName?: string
    secondPartyName?: string
    stampDutyPaidBy?: string
    descriptionOfDocument?: string
    considerationPrice?: number
    stampDutyAmount?: number
  }
  /** Webhook URL for signing events — explicitly passed to ensure Leegality calls it */
  webhook?: string
  /** Error webhook URL */
  errorWebhook?: string
  /** Webhook version (e.g., "2.1") */
  webhookVersion?: string
}

export interface LeegalityCreateResponse {
  documentId: string
  irn: string
  invitees: {
    name: string
    email: string
    phone: string
    signUrl: string
    status: string
  }[]
}

export interface LeegalityInviteeDetails {
  name: string
  email: string
  phone: string
  signUrl: string
  status: string
  signedAt?: string
  signType?: string
}

export interface LeegalityDocumentDetails {
  documentId: string
  irn: string
  name: string
  status: 'IN PROGRESS' | 'COMPLETED' | 'EXPIRED' | 'DELETED'
  createdAt: string
  completedAt?: string
  invitees: LeegalityInviteeDetails[]
  file?: string
  auditTrail?: string
}

export interface LeegalityWebhookPayload {
  documentId: string
  irn: string
  status: string
  invitee?: {
    name: string
    email: string
    signUrl: string
    signType: string
  }
  file?: string
  auditTrail?: string
}

export type DocumentDownloadType = 'DOCUMENT' | 'AUDIT_TRAIL' | 'ATTACHMENT' | 'SUPPORTING_DOCUMENT'
