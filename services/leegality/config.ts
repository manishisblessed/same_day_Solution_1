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
