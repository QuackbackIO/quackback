/**
 * Server functions for editing the portal design from Settings › Portal.
 * Each needs the branding permission, and making the design live (publish,
 * restore, switching) needs the publish permission; the work and its
 * refusals live in domains/design/design.actions.ts.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { typeIdSchema, type PortalDesignRevisionId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { requireAuth } from './auth-helpers'

const log = logger.child({ module: 'portal-design-fn' })

export const getPortalDesignFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  const { readDesignForEditing } = await import('@/lib/server/domains/design/design.actions')
  return {
    ...(await readDesignForEditing()),
    /** Whether this person may make the design live, or only edit the draft. */
    canPublish: auth.permissions.includes(PERMISSIONS.DESIGN_PUBLISH),
  }
})

export const savePortalDesignDraftFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      design: z.unknown(),
      /** The draft revision the change was made against; a newer draft refuses it. */
      revision: z.string().max(64).optional(),
    })
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { designAuthor } = await import('@/lib/server/domains/design/design-author')
    const author = await designAuthor(auth)
    const { saveDesignDraft } = await import('@/lib/server/domains/design/design.actions')
    return saveDesignDraft(data.design, author, data.revision)
  })

export const discardPortalDesignDraftFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      /** The draft revision the person saw; a newer draft refuses the discard. */
      revision: z.string().max(64).optional(),
    })
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { discardDesignDraft } = await import('@/lib/server/domains/design/design.actions')
    return discardDesignDraft(data.revision, auth.principal.id)
  })

export const publishPortalDesignFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      message: z.string().trim().max(200).optional(),
      /** The draft revision the person reviewed. */
      revision: z.string().max(64).optional(),
      /** Also use the draft's portal logo in the admin and emails. */
      workspaceLogo: z.boolean().optional(),
    })
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.DESIGN_PUBLISH })
    // The workspace's logo is a workspace setting, so it takes that permission too.
    if (data.workspaceLogo && !auth.permissions.includes(PERMISSIONS.SETTINGS_MANAGE))
      return {
        ok: false as const,
        code: 'FORBIDDEN' as const,
        message:
          'Using the logo in the admin and emails takes permission to manage settings. Publish without it, or ask someone who has it.',
      }
    const { designAuthor } = await import('@/lib/server/domains/design/design-author')
    const author = await designAuthor(auth)
    const { publishDesign } = await import('@/lib/server/domains/design/design.actions')
    const result = await publishDesign({
      ...author,
      source: 'appearance',
      message: data.message,
      expectedRevision: data.revision,
      workspaceLogo: data.workspaceLogo === true,
    })
    if (!result.ok) return result
    log.info({ revision: result.number }, 'portal design published from appearance')
    return { ...result, address: await liveAddress(auth.permissions) }
  })

/** Where the portal is live now, for publishing to show; on a failed read, the address alone. */
async function liveAddress(permissions: readonly string[]) {
  const [{ config }, { portalAddress }] = await Promise.all([
    import('@/lib/server/config'),
    import('@/lib/shared/design/portal-address'),
  ])
  try {
    const [{ getWorkspaceSettingsRow }, { parseIdentityProjection }] = await Promise.all([
      import('@/lib/server/domains/settings/settings.service'),
      import('@/lib/server/domains/settings/cloud/identity-projection'),
    ])
    const row = await getWorkspaceSettingsRow()
    return portalAddress(
      config.baseUrl,
      parseIdentityProjection(row?.cloudIdentity),
      permissions.includes(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN)
    )
  } catch (err) {
    log.warn({ err }, 'cloud identity could not be read for the live address')
    return portalAddress(config.baseUrl, null, false)
  }
}

export const listPortalDesignVersionsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  const { listDesignVersions } = await import('@/lib/server/domains/design/design.actions')
  return listDesignVersions()
})

export const getPortalDesignVersionFn = createServerFn({ method: 'GET' })
  .validator(z.object({ revisionId: typeIdSchema('portal_design_revision') }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { readDesignVersion } = await import('@/lib/server/domains/design/design.actions')
    return readDesignVersion(data.revisionId)
  })

export const getPortalDesignSwitchFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  const { readDesignSwitch } = await import('@/lib/server/domains/design/switch')
  return {
    ...(await readDesignSwitch()),
    canPublish: auth.permissions.includes(PERMISSIONS.DESIGN_PUBLISH),
  }
})

export const switchPortalDesignFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.DESIGN_PUBLISH })
  const { designAuthor } = await import('@/lib/server/domains/design/design-author')
  const author = await designAuthor(auth)
  const { switchToDesign } = await import('@/lib/server/domains/design/switch')
  const result = await switchToDesign(author)
  if (result.ok) log.info({ revision: result.number }, 'portal switched to the design')
  return result
})

export const switchBackPortalDesignFn = createServerFn({ method: 'POST' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.DESIGN_PUBLISH })
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
    const auth = await requireAuth({ permission: PERMISSIONS.DESIGN_PUBLISH })
    const { designAuthor } = await import('@/lib/server/domains/design/design-author')
    const author = await designAuthor(auth)
    const { restoreDesign } = await import('@/lib/server/domains/design/design.actions')
    return restoreDesign(data.revisionId as PortalDesignRevisionId, author)
  })

/** Whether a draft is waiting, for the portal's Customise button. */
export const getPortalDesignDraftWaitingFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  const { draftWaiting } = await import('@/lib/server/domains/design/revisions')
  return { waiting: await draftWaiting() }
})
