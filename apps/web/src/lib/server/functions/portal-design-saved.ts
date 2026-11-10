/**
 * Server functions for the designs a workspace keeps without publishing them:
 * named checkpoints and its own looks. Each needs the branding permission;
 * the work and its refusals live in domains/design/saved.ts.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { typeIdSchema, type PortalDesignSavedId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'

export const listPortalDesignSavedFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  const { listSaved } = await import('@/lib/server/domains/design/saved')
  return listSaved()
})

export const savePortalDesignFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      kind: z.enum(['checkpoint', 'look']),
      name: z.string().trim().min(1).max(60),
      /** The draft as the person sees it. */
      design: z.unknown(),
    })
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { designAuthor } = await import('@/lib/server/domains/design/design-author')
    const { saveDesign } = await import('@/lib/server/domains/design/saved')
    return saveDesign(data.kind, data.name, data.design, await designAuthor(auth))
  })

export const getPortalDesignCheckpointFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: typeIdSchema('portal_design_saved') }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { readCheckpoint } = await import('@/lib/server/domains/design/saved')
    return readCheckpoint(data.id as PortalDesignSavedId)
  })

export const deletePortalDesignSavedFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: typeIdSchema('portal_design_saved') }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { deleteSaved } = await import('@/lib/server/domains/design/saved')
    return deleteSaved(data.id as PortalDesignSavedId)
  })
