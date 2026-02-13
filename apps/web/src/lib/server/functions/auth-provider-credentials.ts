/**
 * Server functions for auth provider credential management.
 * Admin-only operations for configuring OAuth provider credentials in the DB.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import {
  savePlatformCredentials,
  deletePlatformCredentials,
  getPlatformCredentials,
  getConfiguredIntegrationTypes,
} from '@/lib/server/domains/platform-credentials/platform-credential.service'
import type { PlatformCredentialField } from '@/lib/server/integrations/types'

const saveSchema = z.object({
  credentialType: z.string().min(1),
  credentials: z.record(z.string(), z.string()),
})

const deleteSchema = z.object({
  credentialType: z.string().min(1),
})

const fetchMaskedSchema = z.object({
  credentialType: z.string().min(1),
})

/**
 * Save auth provider credentials. Validates fields via auth provider registry,
 * stores encrypted in DB, and resets the auth instance to pick up new providers.
 */
export const saveAuthProviderCredentialsFn = createServerFn({ method: 'POST' })
  .inputValidator(saveSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })

    const { getAuthProvider } = await import('@/lib/server/auth/auth-providers')
    const provider = getAuthProvider(data.credentialType)
    if (!provider) {
      throw new Error(`Unknown auth provider: ${data.credentialType}`)
    }

    // Validate required base fields (clientId + clientSecret are always required)
    const requiredKeys = ['clientId', 'clientSecret']
    for (const key of requiredKeys) {
      if (!data.credentials[key]?.trim()) {
        const field = provider.platformCredentials.find((f) => f.key === key)
        throw new Error(`${field?.label ?? key} is required`)
      }
    }

    // Strip extra keys not in the provider definition
    const allowedKeys = new Set(provider.platformCredentials.map((f) => f.key))
    const cleaned: Record<string, string> = {}
    for (const [key, value] of Object.entries(data.credentials)) {
      if (allowedKeys.has(key) && value.trim()) {
        cleaned[key] = value.trim()
      }
    }

    await savePlatformCredentials({
      integrationType: data.credentialType,
      credentials: cleaned,
      principalId: auth.principal.id,
    })

    // Reset auth instance so it picks up the new provider config
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()

    return { success: true }
  })

/**
 * Delete auth provider credentials.
 * Also disables the provider in portal config if it was enabled.
 */
export const deleteAuthProviderCredentialsFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    const { getAuthProvider } = await import('@/lib/server/auth/auth-providers')
    const provider = getAuthProvider(data.credentialType)
    if (!provider) {
      throw new Error(`Unknown auth provider: ${data.credentialType}`)
    }

    await deletePlatformCredentials(data.credentialType)

    // Disable this provider in portal config if it was enabled
    const { getPortalConfig, updatePortalConfig } =
      await import('@/lib/server/domains/settings/settings.service')
    const portalConfig = await getPortalConfig()
    const oauthConfig = portalConfig.oauth as Record<string, boolean | undefined>
    if (oauthConfig[provider.id]) {
      await updatePortalConfig({ oauth: { [provider.id]: false } })
    }

    // Reset auth instance
    const { resetAuth } = await import('@/lib/server/auth/index')
    resetAuth()

    return { success: true }
  })

/**
 * Fetch auth provider credentials with sensitive values masked.
 */
export const fetchAuthProviderCredentialsMaskedFn = createServerFn({ method: 'GET' })
  .inputValidator(fetchMaskedSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    const { getAuthProvider } = await import('@/lib/server/auth/auth-providers')
    const provider = getAuthProvider(data.credentialType)
    if (!provider) {
      throw new Error(`Unknown auth provider: ${data.credentialType}`)
    }

    const { getBaseUrl } = await import('@/lib/server/config')
    const baseUrl = getBaseUrl()

    const credentials = await getPlatformCredentials(data.credentialType)
    if (!credentials) {
      return { configured: false as const, fields: null, baseUrl }
    }

    const fieldDefs = new Map<string, PlatformCredentialField>(
      provider.platformCredentials.map((f) => [f.key, f])
    )

    const masked: Record<string, string> = {}
    for (const [key, value] of Object.entries(credentials)) {
      const fieldDef = fieldDefs.get(key)
      if (fieldDef?.sensitive) {
        masked[key] = value.length > 8 ? '****' + value.slice(-4) : '********'
      } else {
        masked[key] = value
      }
    }

    return { configured: true as const, fields: masked, baseUrl }
  })

/**
 * Fetch status of all auth providers — which have credentials configured.
 * Returns Record<providerId, boolean>.
 */
export const fetchAuthProviderStatusFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })

  const { getAllAuthProviders } = await import('@/lib/server/auth/auth-providers')
  const { isEmailConfigured } = await import('@quackback/email')
  const configuredTypes = await getConfiguredIntegrationTypes()

  const status: Record<string, boolean> = {}
  for (const provider of getAllAuthProviders()) {
    status[provider.id] = configuredTypes.has(provider.credentialType)
  }

  return { ...status, _emailConfigured: isEmailConfigured() }
})
