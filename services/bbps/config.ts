export function isMockMode(): boolean {
  return process.env.USE_BBPS_MOCK === 'true'
}

export function getAPITimeout(): number {
  return parseInt(process.env.BBPS_API_TIMEOUT || '90000', 10)
}
