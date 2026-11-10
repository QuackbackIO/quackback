/**
 * Server functions for the portal designer's preview links. Each needs the
 * branding permission; the work and its refusals live in
 * domains/design/preview-links.ts.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { typeIdSchema, type PortalDesignPreviewId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'

export const listPortalDesignPreviewLinksFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { listPreviewLinks } = await import('@/lib/server/domains/design/preview-links')
    return listPreviewLinks()
  }
)

export const createPortalDesignPreviewLinkFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { designAuthor } = await import('@/lib/server/domains/design/design-author')
    const { createPreviewLink } = await import('@/lib/server/domains/design/preview-links')
    return createPreviewLink(await designAuthor(auth))
  }
)

export const revokePortalDesignPreviewLinkFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: typeIdSchema('portal_design_preview') }))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { designAuthor } = await import('@/lib/server/domains/design/design-author')
    const { revokePreviewLink } = await import('@/lib/server/domains/design/preview-links')
    return revokePreviewLink(data.id as PortalDesignPreviewId, await designAuthor(auth))
  })
