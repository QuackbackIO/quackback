import { publicSyncResult } from '@/lib/server/integrations/sync/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'

export const listIntegrationSyncHistoryFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      provider: z.string().min(1).max(50),
      filter: z.enum(['all', 'attention', 'progress', 'successful']).default('all'),
      cursor: z.object({ at: z.iso.datetime(), id: z.uuid() }).optional(),
    })
  )
  .handler(async ({ data }) => {
    const actor = await policyActorFromAuth(
      await requireAuth({ permission: PERMISSIONS.INTEGRATION_VIEW })
    )
    const { listSyncHistory } = await import('@/lib/server/integrations/sync/history')
    return publicSyncResult(() => listSyncHistory(data, actor))
  })

export const inspectIntegrationSyncFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const actor = await policyActorFromAuth(
      await requireAuth({ permission: PERMISSIONS.INTEGRATION_VIEW })
    )
    const { inspectSyncOperation } = await import('@/lib/server/integrations/sync/history')
    return publicSyncResult(() => inspectSyncOperation(data.id, actor))
  })

export const recoverIntegrationSyncFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.uuid(),
      version: z.number().int().positive(),
      actionId: z.uuid(),
      action: z.enum(['retry', 'cancel', 'reconcile', 'keep_remote', 'link_existing']),
      reference: z.string().trim().min(1).max(500).optional(),
      expectedRemoteId: z.string().min(1).max(500).optional(),
    })
  )
  .handler(async ({ data }) => {
    const actor = await policyActorFromAuth(
      await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    )
    const { actOnSync } = await import('@/lib/server/integrations/sync/history')
    return publicSyncResult(() => actOnSync(data, actor))
  })

export const verifyIntegrationSyncReferenceFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid(), reference: z.string().trim().min(1).max(500) }))
  .handler(async ({ data }) => {
    const actor = await policyActorFromAuth(
      await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    )
    const { verifySyncReference } = await import('@/lib/server/integrations/sync/history')
    return publicSyncResult(() => verifySyncReference(data.id, data.reference, actor))
  })
