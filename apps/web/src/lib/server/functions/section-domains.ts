/**
 * Server functions for the hostname each portal section is served at. Gated
 * on settings.custom_domain on Cloud and self-hosted alike; refusals come back
 * as values (`{ ok: false, code, message }`) for the page to show.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { PORTAL_SECTIONS } from '@/lib/shared/section-domains'
import type { PortalSection } from '@/lib/shared/custom-domains'

const sectionSchema = z.enum(PORTAL_SECTIONS as [PortalSection, ...PortalSection[]])

const setSectionDomainSchema = z
  .object({
    section: sectionSchema,
    hostname: z.string().trim().max(253).nullable(),
  })
  .strict()

const service = () => import('@/lib/server/domains/settings/section-domains.service')

export type { SectionDomainsView } from '@/lib/server/domains/settings/section-domains.service'

export const getSectionDomainsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN })
  const { getSectionDomainsView } = await service()
  return getSectionDomainsView()
})

export const setSectionDomainFn = createServerFn({ method: 'POST' })
  .validator(setSectionDomainSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN })
    const { setSectionDomain } = await service()
    return setSectionDomain(data.section, data.hostname)
  })

export const verifySectionDomainFn = createServerFn({ method: 'POST' })
  .validator(z.object({ section: sectionSchema }).strict())
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN })
    const { verifySectionDomain } = await service()
    return verifySectionDomain(data.section)
  })
