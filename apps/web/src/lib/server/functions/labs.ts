import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { actorFromAuth } from '@/lib/server/audit/log'
import {
  listVisibleLabsExperiments,
  setWorkspaceExperimentEnabled,
} from '@/lib/server/domains/settings/settings.labs'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'labs' })

const setWorkspaceExperimentEnabledSchema = z.object({
  experimentId: z.string().min(1),
  enabled: z.boolean(),
})

export const listVisibleLabsExperimentsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  return listVisibleLabsExperiments()
})

export const setWorkspaceExperimentEnabledFn = createServerFn({ method: 'POST' })
  .validator(setWorkspaceExperimentEnabledSchema)
  .handler(async ({ data }) => {
    log.info({ experiment_id: data.experimentId }, 'set workspace experiment enabled')
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    return setWorkspaceExperimentEnabled({
      experimentId: data.experimentId,
      enabled: data.enabled,
      actor: actorFromAuth(auth),
    })
  })
