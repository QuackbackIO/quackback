/**
 * The personal key policy switch on Settings > Developers (api_key.manage).
 * In a module of its own so the Developers page does not share a chunk with
 * the new workspace key page.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'api-keys' })

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
