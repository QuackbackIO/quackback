/**
 * Settings > Portal's summary of what is live, built on the server. The
 * summary reads the theme the way the Customise editor does, through the
 * theme engine; building it here keeps that engine out of every admin page's
 * script (only Customise, which edits the theme, loads it).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getPortalConfig } from '@/lib/server/domains/settings/settings.service'
import { getBrandingConfig, getCustomCss } from '@/lib/server/domains/settings/settings.media'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings/settings.types'
import { getSettingsHeaderLogoData, getSettingsLogoData } from '@/lib/server/settings-utils'
import { PORTAL_DESIGN_READ_PERMISSIONS } from '@/lib/shared/settings-read-permissions'
import type { ThemeConfig } from '@/lib/shared/theme'
import { logger } from '@/lib/server/logger'
import { assertAnyPermission, requireAuth } from './auth-helpers'
import type { SummaryRow } from '@/lib/shared/portal-customise/summary'

const log = logger.child({ component: 'portal-summary' })

/** The built-in tab types a visitor cannot reach right now, which the summary leaves out. */
const inputSchema = z.object({ gatedTypes: z.array(z.string().max(32)).max(16) })

export const fetchPortalSummaryFn = createServerFn({ method: 'GET' })
  .validator(inputSchema)
  .handler(async ({ data }): Promise<SummaryRow[]> => {
    log.debug('fetch portal summary')
    const auth = await requireAuth()
    assertAnyPermission(auth, PORTAL_DESIGN_READ_PERMISSIONS)
    const [theme, customCss, portalConfig, logo, headerLogo, { portalSummary }] = await Promise.all(
      [
        getBrandingConfig(),
        getCustomCss(),
        getPortalConfig(),
        getSettingsLogoData(),
        getSettingsHeaderLogoData(),
        import('@/lib/shared/portal-customise/summary'),
      ]
    )
    const portal = portalConfig ?? DEFAULT_PORTAL_CONFIG
    return portalSummary({
      theme: (theme ?? {}) as ThemeConfig,
      customCss: customCss ?? '',
      portal: { nav: portal.nav, welcomeCard: portal.welcomeCard },
      logoUrl: logo?.url ?? null,
      headerLogo: headerLogo ? { url: headerLogo.url, displayMode: headerLogo.displayMode } : null,
      gatedTypes: new Set(data.gatedTypes),
    })
  })
