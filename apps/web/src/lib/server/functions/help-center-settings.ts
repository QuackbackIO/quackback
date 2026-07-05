/**
 * Server Functions for Help Center Settings
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  getHelpCenterConfig,
  updateHelpCenterConfig,
  enableHelpCenterLocale,
  disableHelpCenterLocale,
  updateHelpCenterLocaleChrome,
} from '@/lib/server/domains/settings/settings.service'
import {
  updateHelpCenterConfigSchema,
  updateHelpCenterSeoSchema,
  enableHelpCenterLocaleSchema,
  disableHelpCenterLocaleSchema,
  updateHelpCenterLocaleChromeSchema,
} from '@/lib/shared/schemas/help-center'

// ============================================================================
// Help Center Config Server Functions
// ============================================================================

export const getHelpCenterConfigFn = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(async () => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return getHelpCenterConfig()
  })

export const updateHelpCenterConfigFn = createServerFn({ method: 'POST' })
  .validator(updateHelpCenterConfigSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return updateHelpCenterConfig(data)
  })

export const updateHelpCenterSeoFn = createServerFn({ method: 'POST' })
  .validator(updateHelpCenterSeoSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const current = await getHelpCenterConfig()
    return updateHelpCenterConfig({
      seo: { ...current.seo, ...data },
    })
  })

// ============================================================================
// Help Center Locale Server Functions (domains/languages §2)
// ============================================================================

export const enableHelpCenterLocaleFn = createServerFn({ method: 'POST' })
  .validator(enableHelpCenterLocaleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return enableHelpCenterLocale(data)
  })

export const disableHelpCenterLocaleFn = createServerFn({ method: 'POST' })
  .validator(disableHelpCenterLocaleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return disableHelpCenterLocale(data.locale)
  })

export const updateHelpCenterLocaleChromeFn = createServerFn({ method: 'POST' })
  .validator(updateHelpCenterLocaleChromeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return updateHelpCenterLocaleChrome(data)
  })
