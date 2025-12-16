import type { CFApiResponse } from './types'

// ============================================================================
// Cloudflare Client (Singleton)
// ============================================================================

interface CloudflareClient {
  zoneId: string
  apiToken: string
  baseUrl: string
}

let cfInstance: CloudflareClient | null = null

/**
 * Get Cloudflare client instance (singleton). Throws if not configured.
 */
export function getCloudflare(): CloudflareClient {
  if (cfInstance) {
    return cfInstance
  }

  const apiToken = process.env.CLOUDFLARE_API_TOKEN
  const zoneId = process.env.CLOUDFLARE_ZONE_ID

  if (!apiToken || !zoneId) {
    throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are required')
  }

  cfInstance = {
    zoneId,
    apiToken,
    baseUrl: 'https://api.cloudflare.com/client/v4',
  }

  return cfInstance
}

/**
 * Check if Cloudflare is configured.
 */
export function isCloudflareConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID)
}

/**
 * Low-level fetch wrapper with Cloudflare authentication.
 */
export async function cfFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<CFApiResponse<T>> {
  const cf = getCloudflare()

  const response = await fetch(`${cf.baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${cf.apiToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  return response.json() as Promise<CFApiResponse<T>>
}
