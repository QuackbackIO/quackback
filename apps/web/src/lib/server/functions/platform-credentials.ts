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
} from '@/lib/server/domains/platform-credentials/platform-credential.service'
import type { PlatformCredentialField } from '@/lib/server/integrations/types'

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
  .inputValidator(savePlatformCredentialsSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })

    // Validate required fields against the integration definition
    const { getIntegration } = await import('@/lib/server/integrations')
    const definition = getIntegration(data.integrationType)
    if (!definition) {
      throw new Error(`Unknown integration type: ${data.integrationType}`)
    }

    const requiredFields = definition.platformCredentials
    for (const field of requiredFields) {
      if (!data.credentials[field.key]?.trim()) {
        throw new Error(`${field.label} is required`)
      }
    }

    // Strip any extra keys not defined in platformCredentials
    const allowedKeys = new Set(definition.platformCredentials.map((f) => f.key))
    const cleaned: Record<string, string> = {}
    for (const [key, value] of Object.entries(data.credentials)) {
      if (allowedKeys.has(key)) {
        cleaned[key] = value.trim()
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
  .inputValidator(deletePlatformCredentialsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    await deletePlatformCredentials(data.integrationType)

    return { success: true }
  })

/**
 * Fetch platform credentials with sensitive values masked.
 * Non-sensitive fields shown in full, sensitive fields masked to last 4 chars.
 */
export const fetchPlatformCredentialsMaskedFn = createServerFn({ method: 'GET' })
  .inputValidator(fetchPlatformCredentialsMaskedSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    const { getIntegration } = await import('@/lib/server/integrations')
    const definition = getIntegration(data.integrationType)
    if (!definition) {
      throw new Error(`Unknown integration type: ${data.integrationType}`)
    }

    const credentials = await getPlatformCredentials(data.integrationType)

    if (!credentials) {
      return { configured: false as const, fields: null }
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

    return { configured: true as const, fields: masked }
  })
