/**
 * Server functions for a teammate's own personal API keys (/settings/api-keys).
 *
 * Any team member may use these, whatever their role: a personal key acts as
 * its creator, so it can never do more than they can. Each function works
 * only on the caller's own personal keys; any other key, workspace keys
 * included, is not found. New keys need the workspace policy "Teammates can
 * create personal API keys" to be on. Expected refusals are returned as values.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { isTeamMember } from '@/lib/shared/roles'
import { API_KEY_SCOPES, EMPTY_SCOPES_MESSAGE } from '@/lib/shared/api-key-scopes'
import {
  PERSONAL_KEY_EXPIRY_CHOICES,
  personalKeyExpiresAt,
  type ApiKeyRefusal,
} from '@/lib/shared/api-key-refusal'
import type { ApiKeyFilter, ApiKeyId } from '@/lib/server/domains/api-keys/api-key.service'
import { toApiKeyRefusal } from '@/lib/server/domains/api-keys/api-key-refusal'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'personal-api-keys' })

const NOT_A_TEAMMATE = 'Access denied: Not a team member'

const createSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name must be 255 characters or less'),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, EMPTY_SCOPES_MESSAGE),
  expiry: z.enum(PERSONAL_KEY_EXPIRY_CHOICES),
})

const idSchema = z.object({ id: z.string() })

const renameSchema = z.object({ id: z.string(), name: z.string().min(1).max(255) })

/** Only the caller's own personal keys. */
function own(principalId: PrincipalId): ApiKeyFilter {
  return { kind: 'personal', createdById: principalId }
}

async function personalKeysAllowed(): Promise<boolean> {
  const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
  return (await getDeveloperConfig()).personalApiKeysEnabled
}

function refusalOr(error: unknown): ApiKeyRefusal {
  const refusal = toApiKeyRefusal(error)
  if (!refusal) throw error
  log.info({ code: refusal.code }, 'personal api key refused')
  return refusal
}

/** My live personal keys, and whether I may make a new one. */
export const fetchMyApiKeysFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth()
  if (!isTeamMember(auth.principal.role)) throw new Error(NOT_A_TEAMMATE)
  const { listPersonalApiKeys } = await import('@/lib/server/domains/api-keys/api-key.service')
  const [keys, canCreate] = await Promise.all([
    listPersonalApiKeys(auth.principal.id),
    personalKeysAllowed(),
  ])
  return { keys, canCreate }
})

/** Make a personal key that acts as me. The full key is returned only this once. */
export const createMyApiKeyFn = createServerFn({ method: 'POST' })
  .validator(createSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    if (!isTeamMember(auth.principal.role)) throw new Error(NOT_A_TEAMMATE)
    if (!(await personalKeysAllowed())) {
      log.info('personal api key refused: policy off')
      return {
        ok: false,
        code: 'POLICY_OFF',
        message: 'Your admin has turned off new personal keys.',
      } satisfies ApiKeyRefusal
    }
    const { createApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
    try {
      const result = await createApiKey(
        {
          name: data.name,
          scopes: data.scopes,
          kind: 'personal',
          expiresAt: personalKeyExpiresAt(data.expiry),
        },
        auth.principal.id
      )
      log.info({ api_key_id: result.apiKey.id }, 'personal api key created')
      return { ok: true as const, ...result }
    } catch (error) {
      return refusalOr(error)
    }
  })

export const renameMyApiKeyFn = createServerFn({ method: 'POST' })
  .validator(renameSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    if (!isTeamMember(auth.principal.role)) throw new Error(NOT_A_TEAMMATE)
    const { updateApiKeyName } = await import('@/lib/server/domains/api-keys/api-key.service')
    try {
      const apiKey = await updateApiKeyName(data.id as ApiKeyId, data.name, own(auth.principal.id))
      return { ok: true as const, apiKey }
    } catch (error) {
      return refusalOr(error)
    }
  })

/** A new secret for one of my keys. The full key is returned only this once. */
export const rotateMyApiKeyFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    if (!isTeamMember(auth.principal.role)) throw new Error(NOT_A_TEAMMATE)
    const { rotateApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
    try {
      const result = await rotateApiKey(data.id as ApiKeyId, own(auth.principal.id))
      log.info({ api_key_id: result.apiKey.id }, 'personal api key rotated')
      return { ok: true as const, ...result }
    } catch (error) {
      return refusalOr(error)
    }
  })

export const revokeMyApiKeyFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    if (!isTeamMember(auth.principal.role)) throw new Error(NOT_A_TEAMMATE)
    const { revokeApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
    try {
      await revokeApiKey(data.id as ApiKeyId, own(auth.principal.id))
      log.info({ api_key_id: data.id }, 'personal api key revoked')
      return { ok: true as const, id: data.id as ApiKeyId }
    } catch (error) {
      return refusalOr(error)
    }
  })
