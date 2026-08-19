/**
 * Server Functions for Help Center redirect rules (domains/languages §2)
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  createRedirectRuleSchema,
  deleteRedirectRuleSchema,
} from '@/lib/shared/schemas/help-center'
import {
  listRedirectRules,
  createRedirectRule,
  deleteRedirectRule,
  resolveRedirectRule,
} from '@/lib/server/domains/help-center/help-center-redirect-rules.service'
import type { HcRedirectRuleId } from '@quackback/ids'

/**
 * Public (unauthenticated) lookup used by the /hc 404 handler -- any visitor
 * can hit an unmatched /hc path and needs the same 301 an admin configured.
 */
export const resolveHelpCenterRedirectFn = createServerFn({ method: 'GET' })
  .validator(z.object({ path: z.string().min(1) }))
  .handler(async ({ data }) => {
    return resolveRedirectRule(data.path)
  })

export const listRedirectRulesFn = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(async () => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return listRedirectRules()
  })

export const createRedirectRuleFn = createServerFn({ method: 'POST' })
  .validator(createRedirectRuleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return createRedirectRule(data)
  })

export const deleteRedirectRuleFn = createServerFn({ method: 'POST' })
  .validator(deleteRedirectRuleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    await deleteRedirectRule(data.id as HcRedirectRuleId)
    return { success: true }
  })
