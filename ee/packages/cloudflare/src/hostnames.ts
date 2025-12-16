import { cfFetch, getCloudflare } from './client'
import type { CFCustomHostname, CreateHostnameParams } from './types'

// ============================================================================
// Custom Hostname Operations
// ============================================================================

/**
 * Create a new custom hostname in Cloudflare.
 * SSL certificates will be automatically issued once the CNAME is verified.
 */
export async function createCustomHostname(
  params: CreateHostnameParams
): Promise<CFCustomHostname> {
  const cf = getCloudflare()

  // Note: custom_metadata requires special Cloudflare permission, so we don't use it.
  // Instead, we track the organizationId in our database via cloudflareHostnameId.
  const response = await cfFetch<CFCustomHostname>(`/zones/${cf.zoneId}/custom_hostnames`, {
    method: 'POST',
    body: JSON.stringify({
      hostname: params.hostname,
      ssl: {
        method: 'http', // DCV via HTTP - works automatically once CNAME is set
        type: 'dv',
        wildcard: false,
      },
    }),
  })

  if (!response.success) {
    const errorMsg = response.errors[0]?.message || 'Unknown Cloudflare API error'
    throw new Error(`Cloudflare API error: ${errorMsg}`)
  }

  return response.result
}

/**
 * Get details for a custom hostname by ID.
 * Returns null if not found.
 */
export async function getCustomHostname(hostnameId: string): Promise<CFCustomHostname | null> {
  const cf = getCloudflare()

  const response = await cfFetch<CFCustomHostname>(
    `/zones/${cf.zoneId}/custom_hostnames/${hostnameId}`
  )

  if (!response.success) {
    return null
  }

  return response.result
}

/**
 * Delete a custom hostname from Cloudflare.
 * This also removes any associated SSL certificates.
 */
export async function deleteCustomHostname(hostnameId: string): Promise<boolean> {
  const cf = getCloudflare()

  const response = await cfFetch<{ id: string }>(
    `/zones/${cf.zoneId}/custom_hostnames/${hostnameId}`,
    { method: 'DELETE' }
  )

  return response.success
}

/**
 * Refresh/restart SSL validation for a custom hostname.
 * Useful if validation failed and customer has fixed their DNS.
 */
export async function refreshCustomHostname(hostnameId: string): Promise<CFCustomHostname> {
  const cf = getCloudflare()

  // PATCH with SSL object triggers DCV restart
  const response = await cfFetch<CFCustomHostname>(
    `/zones/${cf.zoneId}/custom_hostnames/${hostnameId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        ssl: {
          method: 'http',
          type: 'dv',
        },
      }),
    }
  )

  if (!response.success) {
    const errorMsg = response.errors[0]?.message || 'Unknown Cloudflare API error'
    throw new Error(`Cloudflare API error: ${errorMsg}`)
  }

  return response.result
}
