/**
 * Server Functions for the Help Center custom domain (domains/languages §1)
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { updateHelpCenterDomainSchema } from '@/lib/shared/schemas/help-center'
import {
  setHelpCenterDomain,
  verifyHelpCenterDomain,
  checkHelpCenterDomainStatus,
} from '@/lib/server/domains/help-center/help-center-domain.service'
import { getHelpCenterConfig } from '@/lib/server/domains/settings/settings.service'

export const updateHelpCenterDomainFn = createServerFn({ method: 'POST' })
  .validator(updateHelpCenterDomainSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return setHelpCenterDomain(data.domain)
  })

export const verifyHelpCenterDomainFn = createServerFn({ method: 'POST' })
  .validator(z.object({}))
  .handler(async () => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return verifyHelpCenterDomain()
  })

/** Read-only status refresh for the settings card's chip -- does not persist. */
export const getHelpCenterDomainStatusFn = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(async () => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const config = await getHelpCenterConfig()
    if (!config.domain?.domain) return null
    return checkHelpCenterDomainStatus(config.domain.domain)
  })
