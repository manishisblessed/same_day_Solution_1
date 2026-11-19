export interface LeegalityInvitee {
  name: string
  email?: string
  phone?: string
  signUrl?: string
  /** Sequential signing order (1 = first, 2 = second, etc.) */
  signingOrder?: number
}

export interface LeegalityStampConfig {
  /** Stamp series ID as configured in Leegality dashboard (e.g., "01") */
  seriesId: string
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
  /** e-Stamp paper configuration (optional) */
  stamp?: LeegalityStampConfig
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
