import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { SAMPLE_PAGES } from '@/lib/shared/design/sample-pages'
import { getOptionalAuth } from './auth-helpers'

export type DesignerAccess =
  | { ok: true }
  /** sign-in: nobody is signed in. forbidden: they may not change branding. off: the Labs switch is off. */
  | { ok: false; reason: 'sign-in' | 'forbidden' | 'off' }

/**
 * Whether the signed-in person may open the portal designer. Everything the
 * designer is served is theirs alone: never cached or indexed, whatever the
 * answer, and framed by the portal only.
 */
async function designerAccess(): Promise<DesignerAccess> {
  setResponseHeader('Cache-Control', 'private, no-store')
  setResponseHeader('X-Robots-Tag', 'noindex, nofollow')
  // It publishes with one click, so no other site may frame it.
  setResponseHeader('Content-Security-Policy', "frame-ancestors 'self'")
  const auth = await getOptionalAuth()
  if (!auth || auth.principal.type === 'anonymous') return { ok: false, reason: 'sign-in' }
  if (!auth.permissions.includes(PERMISSIONS.SETTINGS_BRANDING)) {
    return { ok: false, reason: 'forbidden' }
  }
  const { isFeatureEnabled } = await import('@/lib/server/domains/settings/settings.service')
  return (await isFeatureEnabled('portalDesignV2')) ? { ok: true } : { ok: false, reason: 'off' }
}

/**
 * Whether the signed-in person may open the portal designer. Every change it
 * makes is checked again by the server function that saves it.
 */
export const getDesignerAccessFn = createServerFn({ method: 'GET' }).handler(designerAccess)

/**
 * The posts the designer's item picker offers: only those a signed-out
 * visitor can open, whoever asks.
 */
export const listDesignerPostsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const access = await designerAccess()
  if (!access.ok) return access
  const { listDesignerPosts } = await import('@/lib/server/domains/design/designer-posts')
  return { ok: true as const, posts: await listDesignerPosts() }
})

/**
 * A page's sample content, made up and never read from the database, for the
 * designer's frame to draw a part that is off or has nothing to show yet.
 */
export const getDesignerSampleFn = createServerFn({ method: 'GET' })
  .validator(z.object({ page: z.enum(SAMPLE_PAGES) }))
  .handler(async ({ data }) => {
    const access = await designerAccess()
    if (!access.ok) return access
    const { sampleContent } = await import('@/lib/server/domains/design/sample-content')
    return { ok: true as const, sample: sampleContent(data.page) }
  })

/**
 * What the designer's page switcher lists: boards, roadmaps, help topics and
 * the posts, entries and articles to choose one from, as a signed-out
 * visitor can open them, whoever asks.
 */
export const listDesignerPlacesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const access = await designerAccess()
  if (!access.ok) return access
  const { listDesignerPlaces } = await import('@/lib/server/domains/design/designer-places')
  return { ok: true as const, places: await listDesignerPlaces() }
})
