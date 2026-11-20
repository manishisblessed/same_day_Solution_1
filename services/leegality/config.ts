export function getLeegalityBaseUrl(): string {
  return process.env.LEEGALITY_BASE_URL || 'https://sandbox.leegality.com/api'
}

export function getLeegalityAuthToken(): string {
  const token = process.env.LEEGALITY_AUTH_TOKEN
  if (!token) throw new Error('LEEGALITY_AUTH_TOKEN not configured')
  return token
}

export function getLeegalityWorkflowId(): string {
  const id = process.env.LEEGALITY_WORKFLOW_ID
  if (!id) throw new Error('LEEGALITY_WORKFLOW_ID not configured')
  return id
}

export function getLeegalityTimeout(): number {
  return parseInt(process.env.LEEGALITY_TIMEOUT || '30000', 10)
}

export function isLeegalitySandbox(): boolean {
  return getLeegalityBaseUrl().includes('sandbox')
}

export function getLeegalityStampSeriesId(): string | undefined {
  return process.env.LEEGALITY_STAMP_SERIES_ID || undefined
}

export function getLeegalityWebhookUrl(): string | undefined {
  return process.env.LEEGALITY_WEBHOOK_URL || undefined
}

export function getCompanySignatory(): { name: string; email: string; phone: string } {
  return {
    name: process.env.COMPANY_SIGNATORY_NAME || 'Manish Kumar',
    email: process.env.COMPANY_SIGNATORY_EMAIL || 'manish_kumar@samedaysolution.in',
    phone: process.env.COMPANY_SIGNATORY_PHONE || '7399599958',
  }
}

export function getDocSignerProfileId(): string | undefined {
  return process.env.LEEGALITY_DOCSIGNER_PROFILE_ID || undefined
}
