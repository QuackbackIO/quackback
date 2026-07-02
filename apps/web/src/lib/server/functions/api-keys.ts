/**
 * Server functions for API key operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import type { ApiKeyId } from '@/lib/server/domains/api-keys/api-key.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'api-keys' })

// ============================================
// Schemas
// ============================================

const scopesSchema = z.array(z.string().min(1).max(128)).max(64).optional()
const idsSchema = z.array(z.string().min(1).max(64)).max(256).optional()

const createApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name must be 255 characters or less'),
  expiresAt: z.string().datetime().optional().nullable(),
  scopes: scopesSchema,
  allowedTeamIds: idsSchema,
  allowedInboxIds: idsSchema,
})

const getApiKeySchema = z.object({
  id: z.string(),
})

const updateApiKeySchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(255).optional(),
  scopes: scopesSchema,
  allowedTeamIds: idsSchema,
  allowedInboxIds: idsSchema,
})

const rotateApiKeySchema = z.object({
  id: z.string(),
})

const revokeApiKeySchema = z.object({
  id: z.string(),
})

const acknowledgeLegacySchema = z.object({
  id: z.string(),
})

// ============================================
// Type Exports
// ============================================

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>
export type GetApiKeyInput = z.infer<typeof getApiKeySchema>
export type UpdateApiKeyInput = z.infer<typeof updateApiKeySchema>
export type RotateApiKeyInput = z.infer<typeof rotateApiKeySchema>
export type RevokeApiKeyInput = z.infer<typeof revokeApiKeySchema>
export type AcknowledgeLegacyInput = z.infer<typeof acknowledgeLegacySchema>

// ============================================
// Read Operations
// ============================================

/**
 * List all active API keys
 */
export const fetchApiKeys = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list api keys')
  try {
    // Only admins can manage API keys
    await requireAuth({ roles: ['admin'] })

    const { listApiKeys } = await import('@/lib/server/domains/api-keys/api-key.service')
    const keys = await listApiKeys()
    log.debug({ count: keys.length }, 'api keys fetched')
    return keys
  } catch (error) {
    log.error({ err: error }, 'list api keys failed')
    throw error
  }
})

/**
 * Get a single API key by ID
 */
export const fetchApiKey = createServerFn({ method: 'GET' })
  .validator(getApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ api_key_id: data.id }, 'get api key')
    try {
      await requireAuth({ roles: ['admin'] })

      const { getApiKeyById } = await import('@/lib/server/domains/api-keys/api-key.service')
      const key = await getApiKeyById(data.id as ApiKeyId)
      log.debug({ found: !!key }, 'api key lookup')
      return key
    } catch (error) {
      log.error({ err: error }, 'get api key failed')
      throw error
    }
  })

// ============================================
// Write Operations
// ============================================

/**
 * Create a new API key
 * Returns the full key only once - store it securely!
 */
export const createApiKeyFn = createServerFn({ method: 'POST' })
  .validator(createApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ name: data.name }, 'create api key')
    try {
      const auth = await requireAuth({ roles: ['admin'] })

      const { createApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      const result = await createApiKey(
        {
          name: data.name,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          scopes: data.scopes,
          allowedTeamIds: data.allowedTeamIds,
          allowedInboxIds: data.allowedInboxIds,
        },
        auth.principal.id
      )
      log.debug(`[fn:api-keys] createApiKeyFn: id=${result.apiKey.id}`)
      try {
        const { recordEvent } = await import('@/lib/server/domains/audit')
        await recordEvent({
          principalId: auth.principal.id,
          action: 'api_key.created',
          targetType: 'api_key',
          targetId: result.apiKey.id,
          diff: {
            after: {
              name: result.apiKey.name,
              keyPrefix: result.apiKey.keyPrefix,
              scopes: result.apiKey.scopes,
              allowedTeamIds: result.apiKey.allowedTeamIds,
              allowedInboxIds: result.apiKey.allowedInboxIds,
              compatLegacyFullAccess: result.apiKey.compatLegacyFullAccess,
            },
          },
          source: auth.source,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        })
      } catch (e) {
        console.warn('[fn:api-keys] audit failed:', e)
      }
      return result
    } catch (error) {
      log.error({ err: error }, 'create api key failed')
      throw error
    }
  })

/**
 * Update an API key (name + scopes + allowed teams/inboxes).
 */
export const updateApiKeyFn = createServerFn({ method: 'POST' })
  .validator(updateApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ api_key_id: data.id }, 'update api key')
    try {
      const auth = await requireAuth({ roles: ['admin'] })

      const { updateApiKey, getApiKeyById } =
        await import('@/lib/server/domains/api-keys/api-key.service')
      const before = await getApiKeyById(data.id as ApiKeyId)
      const key = await updateApiKey(data.id as ApiKeyId, {
        name: data.name,
        scopes: data.scopes,
        allowedTeamIds: data.allowedTeamIds,
        allowedInboxIds: data.allowedInboxIds,
      })
      log.debug(`[fn:api-keys] updateApiKeyFn: updated id=${key.id}`)
      try {
        const { recordEvent } = await import('@/lib/server/domains/audit')
        await recordEvent({
          principalId: auth.principal.id,
          action: 'api_key.updated',
          targetType: 'api_key',
          targetId: key.id,
          diff: {
            before: {
              name: before.name,
              scopes: before.scopes,
              allowedTeamIds: before.allowedTeamIds,
              allowedInboxIds: before.allowedInboxIds,
              compatLegacyFullAccess: before.compatLegacyFullAccess,
            },
            after: {
              name: key.name,
              scopes: key.scopes,
              allowedTeamIds: key.allowedTeamIds,
              allowedInboxIds: key.allowedInboxIds,
              compatLegacyFullAccess: key.compatLegacyFullAccess,
            },
          },
          source: auth.source,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        })
      } catch (e) {
        console.warn('[fn:api-keys] audit failed:', e)
      }
      return key
    } catch (error) {
      log.error({ err: error }, 'update api key failed')
      throw error
    }
  })

/**
 * Rotate an API key - generates a new key
 * Returns the new full key only once - store it securely!
 */
export const rotateApiKeyFn = createServerFn({ method: 'POST' })
  .validator(rotateApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ api_key_id: data.id }, 'rotate api key')
    try {
      const auth = await requireAuth({ roles: ['admin'] })

      const { rotateApiKey, getApiKeyById } =
        await import('@/lib/server/domains/api-keys/api-key.service')
      const before = await getApiKeyById(data.id as ApiKeyId)
      const result = await rotateApiKey(data.id as ApiKeyId)
      log.debug(`[fn:api-keys] rotateApiKeyFn: rotated id=${result.apiKey.id}`)
      try {
        const { recordEvent } = await import('@/lib/server/domains/audit')
        await recordEvent({
          principalId: auth.principal.id,
          action: 'api_key.rotated',
          targetType: 'api_key',
          targetId: result.apiKey.id,
          diff: {
            before: { keyPrefix: before.keyPrefix },
            after: { keyPrefix: result.apiKey.keyPrefix },
          },
          source: auth.source,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        })
      } catch (e) {
        console.warn('[fn:api-keys] audit failed:', e)
      }
      return result
    } catch (error) {
      log.error({ err: error }, 'rotate api key failed')
      throw error
    }
  })

/**
 * Revoke an API key (soft delete)
 */
export const revokeApiKeyFn = createServerFn({ method: 'POST' })
  .validator(revokeApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ api_key_id: data.id }, 'revoke api key')
    try {
      const auth = await requireAuth({ roles: ['admin'] })

      const { revokeApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      await revokeApiKey(data.id as ApiKeyId)
      log.debug(`[fn:api-keys] revokeApiKeyFn: revoked`)
      try {
        const { recordEvent } = await import('@/lib/server/domains/audit')
        await recordEvent({
          principalId: auth.principal.id,
          action: 'api_key.revoked',
          targetType: 'api_key',
          targetId: data.id,
          source: auth.source,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        })
      } catch (e) {
        console.warn('[fn:api-keys] audit failed:', e)
      }
      return { id: data.id as ApiKeyId }
    } catch (error) {
      log.error({ err: error }, 'revoke api key failed')
      throw error
    }
  })

/**
 * Acknowledge the legacy "all permissions" compatibility flag for an API key.
 * Suppresses the warning surfaced via `compatLegacyFullAccess`.
 */
export const acknowledgeLegacyApiKeyFn = createServerFn({ method: 'POST' })
  .inputValidator(acknowledgeLegacySchema)
  .handler(async ({ data }) => {
    console.log(`[fn:api-keys] acknowledgeLegacyApiKeyFn: id=${data.id}`)
    try {
      const auth = await requireAuth({ roles: ['admin'] })

      const { acknowledgeLegacyCompat } =
        await import('@/lib/server/domains/api-keys/api-key.service')
      const key = await acknowledgeLegacyCompat(data.id as ApiKeyId)
      try {
        const { recordEvent } = await import('@/lib/server/domains/audit')
        await recordEvent({
          principalId: auth.principal.id,
          action: 'api_key.legacy_acknowledged',
          targetType: 'api_key',
          targetId: key.id,
          source: auth.source,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        })
      } catch (e) {
        console.warn('[fn:api-keys] audit failed:', e)
      }
      return key
    } catch (error) {
      console.error(`[fn:api-keys] acknowledgeLegacyApiKeyFn failed:`, error)
      throw error
    }
  })
