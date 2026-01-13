import { getCloudflareClient } from './client'
import type { CFCustomHostname } from './types'

export async function createCustomHostname(
  hostname: string,
  metadata?: Record<string, string>
): Promise<CFCustomHostname> {
  const client = getCloudflareClient()
  const response = await client.createHostname(hostname, { metadata })

  if (!response.success || !response.result) {
    const errorMsg = response.errors?.[0]?.message || 'Failed to create custom hostname'
    throw new Error(errorMsg)
  }

  return response.result
}

export async function getCustomHostname(hostnameId: string): Promise<CFCustomHostname | null> {
  const client = getCloudflareClient()
  const response = await client.getHostname(hostnameId)

  if (!response.success) {
    if (response.errors?.some((e: { code: number }) => e.code === 1412)) {
      return null // Not found
    }
    const errorMsg = response.errors?.[0]?.message || 'Failed to get custom hostname'
    throw new Error(errorMsg)
  }

  return response.result || null
}

export async function deleteCustomHostname(hostnameId: string): Promise<void> {
  const client = getCloudflareClient()
  const response = await client.deleteHostname(hostnameId)

  if (!response.success) {
    const errorMsg = response.errors?.[0]?.message || 'Failed to delete custom hostname'
    throw new Error(errorMsg)
  }
}

export async function refreshCustomHostname(hostnameId: string): Promise<CFCustomHostname> {
  const client = getCloudflareClient()
  const response = await client.refreshHostname(hostnameId)

  if (!response.success || !response.result) {
    const errorMsg = response.errors?.[0]?.message || 'Failed to refresh custom hostname'
    throw new Error(errorMsg)
  }

  return response.result
}
