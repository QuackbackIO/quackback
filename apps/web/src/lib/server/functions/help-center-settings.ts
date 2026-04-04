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
import { requireSettings } from '@/lib/server/domains/settings/settings.helpers'
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

// ============================================================================
// Custom Domain Server Functions
// ============================================================================

export const addCustomDomainFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ domain: z.string().min(1).max(253) }))
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const { createDomainVerification } =
      await import('@/lib/server/domains/help-center/help-center-domain.service')
    const settings = await requireSettings()

    const result = await createDomainVerification(settings.id, data.domain)
    await updateHelpCenterConfig({
      customDomain: data.domain,
      domainVerified: false,
    })

    return result
  })

export const getDomainVerificationStatusFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({}))
  .handler(async () => {
    await requireAuth({ roles: ['admin'] })
    const config = await getHelpCenterConfig()
    if (!config.customDomain) return null

    const { getDomainVerificationForDomain } =
      await import('@/lib/server/domains/help-center/help-center-domain.service')
    return getDomainVerificationForDomain(config.customDomain)
  })

export const removeCustomDomainFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({}))
  .handler(async () => {
    await requireAuth({ roles: ['admin'] })
    await updateHelpCenterConfig({
      customDomain: null,
      domainVerified: false,
    })
    return { success: true }
  })
