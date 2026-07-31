export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  })

  if (!response.ok) {
    let serverMsg = ''
    try {
      const body = await response.clone().json()
      serverMsg = body?.error || body?.message || ''
    } catch {
      try { serverMsg = (await response.clone().text()).slice(0, 300) } catch { /* ignore */ }
    }
    throw new Error(
      serverMsg
        ? `${serverMsg} (${response.status})`
        : `API request failed: ${response.status} ${response.statusText}`
    )
  }

  return response
}
