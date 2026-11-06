/**
 * Server functions for key managers (api_key.manage): Settings > Developers.
 *
 * Managers create and change workspace keys only. They see every key and may
 * revoke any of them, a teammate's personal key included, but they never
 * rename or rotate someone else's personal key: those live on the teammate's
 * own settings page (functions/personal-api-keys.ts). Expected refusals are
 * returned as values.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { API_KEY_SCOPES, EMPTY_SCOPES_MESSAGE } from '@/lib/server/domains/api-keys/api-key-scopes'
import type { ApiKeyFilter, ApiKeyId } from '@/lib/server/domains/api-keys/api-key.service'
import { toApiKeyRefusal } from '@/lib/server/domains/api-keys/api-key-refusal'
import type { ApiKeyRefusal } from '@/lib/shared/api-key-refusal'
import type { RoleId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'api-keys' })

// ============================================
// Schemas
// ============================================

const createApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name must be 255 characters or less'),
  expiresAt: z.string().datetime().optional().nullable(),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, EMPTY_SCOPES_MESSAGE).optional(),
  roleId: z.string().min(1),
})

const setWorkspaceKeyRoleSchema = z.object({
  id: z.string(),
  roleId: z.string(),
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

/**
 * Managers rename and rotate workspace keys only, and only those whose current
 * role they could grant.
 */
function workspaceKeysOf(auth: Awaited<ReturnType<typeof requireAuth>>): ApiKeyFilter {
  return {
    kind: 'workspace',
    granter: { permissions: auth.permissions, role: auth.principal.role },
  }
}

function refusalOr(error: unknown): ApiKeyRefusal {
  const refusal = toApiKeyRefusal(error)
  if (!refusal) throw error
  log.info({ code: refusal.code }, 'api key change refused')
  return refusal
}

// ============================================
// Read Operations
// ============================================

/**
 * Every live key, with its kind, its creator (and whether they are still on
 * the team) and, for a workspace key, its role; and whether teammates may
 * create personal keys.
 */
export const fetchApiKeys = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list api keys')
  const auth = await requireAuth({ permission: PERMISSIONS.API_KEY_MANAGE })

  const [{ listManagedApiKeys }, { getDeveloperConfig }] = await Promise.all([
    import('@/lib/server/domains/api-keys/api-key-management'),
    import('@/lib/server/domains/settings/settings.service'),
  ])
  const [keys, config] = await Promise.all([
    listManagedApiKeys({ permissions: auth.permissions, role: auth.principal.role }),
    getDeveloperConfig(),
  ])
  log.debug({ count: keys.length }, 'api keys fetched')
  return { keys, personalKeysEnabled: config.personalApiKeysEnabled }
})

/**
 * Get a single API key by ID
 */
export const fetchApiKey = createServerFn({ method: 'GET' })
  .validator(getApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ api_key_id: data.id }, 'get api key')
    await requireAuth({ permission: PERMISSIONS.API_KEY_MANAGE })

    const { getApiKeyById } = await import('@/lib/server/domains/api-keys/api-key.service')
    const key = await getApiKeyById(data.id as ApiKeyId)
    log.debug({ found: !!key }, 'api key lookup')
    return key
  })

// ============================================
// Write Operations
// ============================================

/**
 * Create a workspace key holding `roleId`, within the caller's grant ceiling.
 * Returns the full key only once.
 */
export const createApiKeyFn = createServerFn({ method: 'POST' })
  .validator(createApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ name: data.name }, 'create workspace api key')
    const auth = await requireAuth({ permission: PERMISSIONS.API_KEY_MANAGE })

    const { createApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
    try {
      const result = await createApiKey(
        {
          name: data.name,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          scopes: data.scopes,
          kind: 'workspace',
          roleId: data.roleId as RoleId,
        },
        auth.principal.id,
        { permissions: auth.permissions, role: auth.principal.role }
      )
      log.info({ api_key_id: result.apiKey.id }, 'workspace api key created')
      return { ok: true as const, ...result }
    } catch (error) {
      return refusalOr(error)
    }
  })

/**
 * Rename a workspace key
 */
export const updateApiKeyFn = createServerFn({ method: 'POST' })
  .validator(updateApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ api_key_id: data.id }, 'update api key')
    const auth = await requireAuth({ permission: PERMISSIONS.API_KEY_MANAGE })

    const { updateApiKeyName } = await import('@/lib/server/domains/api-keys/api-key.service')
    try {
      const apiKey = await updateApiKeyName(data.id as ApiKeyId, data.name, workspaceKeysOf(auth))
      log.info({ api_key_id: apiKey.id }, 'api key updated')
      return { ok: true as const, apiKey }
    } catch (error) {
      return refusalOr(error)
    }
  })

/**
 * Rotate a workspace key. Returns the new full key only once.
 */
export const rotateApiKeyFn = createServerFn({ method: 'POST' })
  .validator(rotateApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ api_key_id: data.id }, 'rotate api key')
    const auth = await requireAuth({ permission: PERMISSIONS.API_KEY_MANAGE })

    const { rotateApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
    try {
      const result = await rotateApiKey(data.id as ApiKeyId, workspaceKeysOf(auth))
      log.info({ api_key_id: result.apiKey.id }, 'api key rotated')
      return { ok: true as const, ...result }
    } catch (error) {
      return refusalOr(error)
    }
  })

/**
 * Revoke any key, a teammate's personal key included.
 */
export const revokeApiKeyFn = createServerFn({ method: 'POST' })
  .validator(revokeApiKeySchema)
  .handler(async ({ data }) => {
    log.debug({ api_key_id: data.id }, 'revoke api key')
    await requireAuth({ permission: PERMISSIONS.API_KEY_MANAGE })

    const { revokeApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
    try {
      await revokeApiKey(data.id as ApiKeyId)
      log.info({ api_key_id: data.id }, 'api key revoked')
      return { ok: true as const, id: data.id as ApiKeyId }
    } catch (error) {
      return refusalOr(error)
    }
  })

/**
 * Give a workspace key a different role, within the caller's own grant ceiling.
 */
export const setWorkspaceKeyRoleFn = createServerFn({ method: 'POST' })
  .validator(setWorkspaceKeyRoleSchema)
  .handler(async ({ data }) => {
    log.debug({ api_key_id: data.id }, 'set workspace key role')
    const auth = await requireAuth({ permission: PERMISSIONS.API_KEY_MANAGE })

    const { setWorkspaceKeyRole } = await import('@/lib/server/domains/api-keys/api-key.service')
    try {
      const apiKey = await setWorkspaceKeyRole(
        data.id as ApiKeyId,
        data.roleId as RoleId,
        { permissions: auth.permissions, role: auth.principal.role },
        auth.principal.id
      )
      log.info({ api_key_id: apiKey.id }, 'workspace key role changed')
      return { ok: true as const, apiKey }
    } catch (error) {
      return refusalOr(error)
    }
  })
