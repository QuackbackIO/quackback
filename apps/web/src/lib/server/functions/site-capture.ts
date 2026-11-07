/**
 * Website captures for the portal designer, for signed-in admins only: the
 * edit loop's read_website (the site's facts and a capture, cache first,
 * within the workspace's limits), and this month's captures for those who
 * manage settings. There is no other way in: no portal, public or API-key
 * path reaches a capture, so nothing here works as a screenshot service.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'

export const readWebsiteFn = createServerFn({ method: 'POST' })
  .validator(z.object({ url: z.string().trim().min(1).max(2048) }))
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { readWebsite } = await import('@/lib/server/domains/design/site/website-reading')
    return readWebsite(data.url, auth.principal.id)
  })

/** This month's billed captures against the limit, and whether captures are set up. */
export const siteCaptureUsageFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const [{ captureUsage }, { config }] = await Promise.all([
    import('@/lib/server/domains/design/site/capture-service'),
    import('@/lib/server/config'),
  ])
  return { configured: !!config.screenshotoneAccessKey, ...(await captureUsage(Date.now())) }
})
