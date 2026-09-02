/**
 * Server functions for platform credential management.
 * Admin-only operations for configuring integration OAuth app credentials.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import {
  savePlatformCredentials,
  deletePlatformCredentials,
  getPlatformCredentials,
  arePlatformCredentialsManaged,
} from '@/lib/server/domains/platform-credentials/platform-credential.service'
import type { PlatformCredentialField } from '@/lib/server/integrations/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'platform-credentials' })

const savePlatformCredentialsSchema = z.object({
  integrationType: z.string().min(1),
  credentials: z.record(z.string(), z.string()),
})

const deletePlatformCredentialsSchema = z.object({
  integrationType: z.string().min(1),
})

const fetchPlatformCredentialsMaskedSchema = z.object({
  integrationType: z.string().min(1),
})

/**
 * Save platform credentials for an integration type.
 */
export const savePlatformCredentialsFn = createServerFn({ method: 'POST' })
  .validator(savePlatformCredentialsSchema)
  .handler(async ({ data }) => {
    log.debug({ integration_type: data.integrationType }, 'save platform credentials')
    const auth = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const { assertTierFeature } = await import('@/lib/server/domains/settings/tier-enforce')
    await assertTierFeature('integrations', 'Integrations')

    // Validate required fields against the integration definition
    const { getIntegration } = await import('@/lib/server/integrations')
    const definition = getIntegration(data.integrationType)
    if (!definition) {
      throw new Error(`Unknown integration type: ${data.integrationType}`)
    }

    for (const field of definition.platformCredentials) {
      if (field.required === false) continue
      if (!data.credentials[field.key]?.trim()) {
        throw new Error(`${field.label} is required`)
      }
    }

    // Strip any extra keys not defined in platformCredentials. Optional
    // fields that are blank are dropped so an omitted instance URL keeps
    // the gitlab.com default rather than storing an empty string.
    const allowedKeys = new Set(definition.platformCredentials.map((f) => f.key))
    const cleaned: Record<string, string> = {}
    for (const [key, value] of Object.entries(data.credentials)) {
      if (!allowedKeys.has(key)) continue
      const trimmed = value.trim()
      if (!trimmed) continue
      cleaned[key] = trimmed
    }

    // SSRF defense: any URL the server will later fetch (e.g. a self-hosted
    // GitLab instance) must not resolve to internal infrastructure. Validate
    // at save so a poisoned URL is never stored — same guard as auth-provider
    // URL fields.
    const { checkUrlSafety } = await import('@/lib/server/content/ssrf-guard')
    for (const field of definition.platformCredentials) {
      if (!field.url) continue
      const value = cleaned[field.key]
      if (!value) continue
      const verdict = await checkUrlSafety(value)
      if (!verdict.safe) {
        throw new Error(`${field.label} must be a valid public URL`)
      }
    }

    await savePlatformCredentials({
      integrationType: data.integrationType,
      credentials: cleaned,
      principalId: auth.principal.id,
    })

    return { success: true }
  })

/**
 * Delete platform credentials for an integration type.
 */
export const deletePlatformCredentialsFn = createServerFn({ method: 'POST' })
  .validator(deletePlatformCredentialsSchema)
  .handler(async ({ data }) => {
    log.debug({ integration_type: data.integrationType }, 'delete platform credentials')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    await deletePlatformCredentials(data.integrationType)

    return { success: true }
  })

/**
 * Fetch platform credentials with sensitive values masked.
 * Non-sensitive fields shown in full, sensitive fields masked to last 4 chars.
 */
export const fetchPlatformCredentialsMaskedFn = createServerFn({ method: 'GET' })
  .validator(fetchPlatformCredentialsMaskedSchema)
  .handler(async ({ data }) => {
    log.debug({ integration_type: data.integrationType }, 'fetch masked platform credentials')
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

    const { getIntegration } = await import('@/lib/server/integrations')
    const definition = getIntegration(data.integrationType)
    if (!definition) {
      throw new Error(`Unknown integration type: ${data.integrationType}`)
    }

    const credentials = await getPlatformCredentials(data.integrationType)

    if (!credentials) {
      return {
        configured: false as const,
        fields: null,
        managed: arePlatformCredentialsManaged(data.integrationType),
      }
    }

    // Build a map of field definitions for lookup
    const fieldDefs = new Map<string, PlatformCredentialField>(
      definition.platformCredentials.map((f) => [f.key, f])
    )

    // Mask sensitive values, show non-sensitive in full
    const masked: Record<string, string> = {}
    for (const [key, value] of Object.entries(credentials)) {
      const fieldDef = fieldDefs.get(key)
      if (fieldDef?.sensitive) {
        masked[key] = value.length > 8 ? '****' + value.slice(-4) : '********'
      } else {
        masked[key] = value
      }
    }

    return {
      configured: true as const,
      fields: masked,
      managed: arePlatformCredentialsManaged(data.integrationType),
    }
  })
