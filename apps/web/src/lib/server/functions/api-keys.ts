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

const createApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name must be 255 characters or less'),
  expiresAt: z.string().datetime().optional().nullable(),
})

const getApiKeySchema = z.object({
  id: z.string(),
})

const updateApiKeySchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(255),
})

const rotateApiKeySchema = z.object({
  id: z.string(),
})

const revokeApiKeySchema = z.object({
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
  .inputValidator(getApiKeySchema)
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
  .inputValidator(createApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ name: data.name }, 'create api key')
    try {
      const auth = await requireAuth({ roles: ['admin'] })

      const { createApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      const result = await createApiKey(
        {
          name: data.name,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        },
        auth.principal.id
      )
      log.info({ api_key_id: result.apiKey.id }, 'api key created')
      return result
    } catch (error) {
      log.error({ err: error }, 'create api key failed')
      throw error
    }
  })

/**
 * Update an API key's name
 */
export const updateApiKeyFn = createServerFn({ method: 'POST' })
  .inputValidator(updateApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ api_key_id: data.id }, 'update api key')
    try {
      await requireAuth({ roles: ['admin'] })

      const { updateApiKeyName } = await import('@/lib/server/domains/api-keys/api-key.service')
      const key = await updateApiKeyName(data.id as ApiKeyId, data.name)
      log.info({ api_key_id: key.id }, 'api key updated')
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
  .inputValidator(rotateApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ api_key_id: data.id }, 'rotate api key')
    try {
      await requireAuth({ roles: ['admin'] })

      const { rotateApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      const result = await rotateApiKey(data.id as ApiKeyId)
      log.info({ api_key_id: result.apiKey.id }, 'api key rotated')
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
  .inputValidator(revokeApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ api_key_id: data.id }, 'revoke api key')
    try {
      await requireAuth({ roles: ['admin'] })

      const { revokeApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      await revokeApiKey(data.id as ApiKeyId)
      log.info({ api_key_id: data.id }, 'api key revoked')
      return { id: data.id as ApiKeyId }
    } catch (error) {
      log.error({ err: error }, 'revoke api key failed')
      throw error
    }
  })
