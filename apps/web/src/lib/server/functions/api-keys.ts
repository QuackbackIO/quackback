/**
 * Server functions for API key operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import {
  listApiKeys,
  getApiKeyById,
  createApiKey,
  updateApiKeyName,
  rotateApiKey,
  revokeApiKey,
  type ApiKeyId,
} from '@/lib/server/domains/api-keys'

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
  console.log(`[fn:api-keys] fetchApiKeys`)
  try {
    // Only admins can manage API keys
    await requireAuth({ roles: ['admin'] })

    const keys = await listApiKeys()
    console.log(`[fn:api-keys] fetchApiKeys: count=${keys.length}`)
    return keys
  } catch (error) {
    console.error(`[fn:api-keys] fetchApiKeys failed:`, error)
    throw error
  }
})

/**
 * Get a single API key by ID
 */
export const fetchApiKey = createServerFn({ method: 'GET' })
  .inputValidator(getApiKeySchema)
  .handler(async ({ data }) => {
    console.log(`[fn:api-keys] fetchApiKey: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin'] })

      const key = await getApiKeyById(data.id as ApiKeyId)
      console.log(`[fn:api-keys] fetchApiKey: found=${!!key}`)
      return key
    } catch (error) {
      console.error(`[fn:api-keys] fetchApiKey failed:`, error)
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
    console.log(`[fn:api-keys] createApiKeyFn: name=${data.name}`)
    try {
      const auth = await requireAuth({ roles: ['admin'] })

      const result = await createApiKey(
        {
          name: data.name,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        },
        auth.member.id
      )
      console.log(`[fn:api-keys] createApiKeyFn: id=${result.apiKey.id}`)
      return result
    } catch (error) {
      console.error(`[fn:api-keys] createApiKeyFn failed:`, error)
      throw error
    }
  })

/**
 * Update an API key's name
 */
export const updateApiKeyFn = createServerFn({ method: 'POST' })
  .inputValidator(updateApiKeySchema)
  .handler(async ({ data }) => {
    console.log(`[fn:api-keys] updateApiKeyFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin'] })

      const key = await updateApiKeyName(data.id as ApiKeyId, data.name)
      console.log(`[fn:api-keys] updateApiKeyFn: updated id=${key.id}`)
      return key
    } catch (error) {
      console.error(`[fn:api-keys] updateApiKeyFn failed:`, error)
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
    console.log(`[fn:api-keys] rotateApiKeyFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin'] })

      const result = await rotateApiKey(data.id as ApiKeyId)
      console.log(`[fn:api-keys] rotateApiKeyFn: rotated id=${result.apiKey.id}`)
      return result
    } catch (error) {
      console.error(`[fn:api-keys] rotateApiKeyFn failed:`, error)
      throw error
    }
  })

/**
 * Revoke an API key (soft delete)
 */
export const revokeApiKeyFn = createServerFn({ method: 'POST' })
  .inputValidator(revokeApiKeySchema)
  .handler(async ({ data }) => {
    console.log(`[fn:api-keys] revokeApiKeyFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin'] })

      await revokeApiKey(data.id as ApiKeyId)
      console.log(`[fn:api-keys] revokeApiKeyFn: revoked`)
      return { id: data.id as ApiKeyId }
    } catch (error) {
      console.error(`[fn:api-keys] revokeApiKeyFn failed:`, error)
      throw error
    }
  })
