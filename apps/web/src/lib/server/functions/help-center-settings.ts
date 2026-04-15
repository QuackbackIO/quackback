/**
 * Server Functions for Help Center Settings
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import {
  getHelpCenterConfig,
  updateHelpCenterConfig,
} from '@/lib/server/domains/settings/settings.service'
import {
  updateHelpCenterConfigSchema,
  updateHelpCenterSeoSchema,
} from '@/lib/shared/schemas/help-center'

// ============================================================================
// Help Center Config Server Functions
// ============================================================================

export const getHelpCenterConfigFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({}))
  .handler(async () => {
    await requireAuth({ roles: ['admin'] })
    return getHelpCenterConfig()
  })

export const updateHelpCenterConfigFn = createServerFn({ method: 'POST' })
  .inputValidator(updateHelpCenterConfigSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    return updateHelpCenterConfig(data)
  })

export const updateHelpCenterSeoFn = createServerFn({ method: 'POST' })
  .inputValidator(updateHelpCenterSeoSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const current = await getHelpCenterConfig()
    return updateHelpCenterConfig({
      seo: { ...current.seo, ...data },
    })
  })
