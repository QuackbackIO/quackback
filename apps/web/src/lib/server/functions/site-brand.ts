/**
 * Use from your website, for the portal designer without Quackback AI: the
 * brand's site read from its code, its logo, favicon, share image and one
 * colour stored and offered. Only those who manage branding reach it, and a
 * refusal comes back as a value.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'

export const readSiteBrandFn = createServerFn({ method: 'POST' })
  .validator(z.object({ url: z.string().trim().min(1).max(2048) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
    const { readSiteBrand } = await import('@/lib/server/domains/design/site/site-brand')
    return readSiteBrand(data.url)
  })
