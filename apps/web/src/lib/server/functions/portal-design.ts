/**
 * Server functions for editing the portal design from Settings › Portal.
 * Each needs the branding permission; the work and its refusals live in
 * domains/design/design.actions.ts.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { typeIdSchema, type PortalDesignRevisionId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { requireAuth } from './auth-helpers'

const log = logger.child({ module: 'portal-design-fn' })

export const getPortalDesignFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  const { readDesignForEditing } = await import('@/lib/server/domains/design/design.actions')
  return readDesignForEditing()
})

export const savePortalDesignDraftFn = createServerFn({ method: 'POST' })
  .validator(z.object({ design: z.unknown() }))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { designAuthor } = await import('@/lib/server/domains/design/design-author')
    const author = await designAuthor(auth)
    const { saveDesignDraft } = await import('@/lib/server/domains/design/design.actions')
    return saveDesignDraft(data.design, author)
  })

export const discardPortalDesignDraftFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  const { discardDesignDraft } = await import('@/lib/server/domains/design/design.actions')
  return discardDesignDraft()
})

export const publishPortalDesignFn = createServerFn({ method: 'POST' })
  .validator(z.object({ message: z.string().trim().max(200).optional() }))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { designAuthor } = await import('@/lib/server/domains/design/design-author')
    const author = await designAuthor(auth)
    const { publishDesign } = await import('@/lib/server/domains/design/design.actions')
    const result = await publishDesign({ ...author, source: 'appearance', message: data.message })
    if (result.ok) log.info({ revision: result.number }, 'portal design published from appearance')
    return result
  })

export const listPortalDesignVersionsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  const { listDesignVersions } = await import('@/lib/server/domains/design/design.actions')
  return listDesignVersions()
})

export const getPortalDesignSwitchFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  const { readDesignSwitch } = await import('@/lib/server/domains/design/switch')
  return readDesignSwitch()
})

export const switchPortalDesignFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  const { designAuthor } = await import('@/lib/server/domains/design/design-author')
  const author = await designAuthor(auth)
  const { switchToDesign } = await import('@/lib/server/domains/design/switch')
  const result = await switchToDesign(author)
  if (result.ok) log.info({ revision: result.number }, 'portal switched to the design')
  return result
})

export const switchBackPortalDesignFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  const { designAuthor } = await import('@/lib/server/domains/design/design-author')
  const author = await designAuthor(auth)
  const { switchBackFromDesign } = await import('@/lib/server/domains/design/switch')
  const result = await switchBackFromDesign(author)
  if (result.ok) log.info('portal switched back to the old theme')
  return result
})

export const restorePortalDesignVersionFn = createServerFn({ method: 'POST' })
  .validator(z.object({ revisionId: typeIdSchema('portal_design_revision') }))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { designAuthor } = await import('@/lib/server/domains/design/design-author')
    const author = await designAuthor(auth)
    const { restoreDesign } = await import('@/lib/server/domains/design/design.actions')
    return restoreDesign(data.revisionId as PortalDesignRevisionId, author)
  })
