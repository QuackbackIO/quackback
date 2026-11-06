/**
 * Server functions only the Developers page's key sections call (api_key.manage):
 * the roles a workspace key may be given, and the personal key policy switch.
 * Kept apart from functions/api-keys.ts, whose list function every page's
 * entry chunk carries.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'api-keys' })

/** The roles a workspace key may be given, each marked with whether the caller can grant it. */
export const fetchWorkspaceKeyRolesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.API_KEY_MANAGE })
  const { listWorkspaceKeyRoleOptions } =
    await import('@/lib/server/domains/api-keys/api-key-management')
  return listWorkspaceKeyRoleOptions({ permissions: auth.permissions, role: auth.principal.role })
})

/**
 * Turn "Teammates can create personal API keys" on or off. Off stops new
 * personal keys only; existing ones keep working until revoked or expired.
 */
export const setPersonalKeyPolicyFn = createServerFn({ method: 'POST' })
  .validator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data }) => {
    log.info({ enabled: data.enabled }, 'set personal api key policy')
    await requireAuth({ permission: PERMISSIONS.API_KEY_MANAGE })
    const { updateDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
    await updateDeveloperConfig({ personalApiKeysEnabled: data.enabled })
    return { enabled: data.enabled }
  })
