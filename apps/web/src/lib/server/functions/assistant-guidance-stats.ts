/**
 * Guidance-rule effectiveness stats server fn: the Used count + Resolved %
 * the guidance rules card shows per rule. Gates on assistant.manage, same as
 * the guidance rule CRUD fns in assistant-guidance.ts.
 */
import { createServerFn } from '@tanstack/react-start'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'assistant-guidance-stats' })

/** Per-rule Used/Resolved % stats, keyed by guidance rule id. */
export const getGuidanceRuleStatsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch guidance rule stats')
  try {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { getGuidanceRuleStats } = await import('@/lib/server/domains/assistant/guidance-stats')
    return await getGuidanceRuleStats()
  } catch (error) {
    log.error({ err: error }, 'fetch guidance rule stats failed')
    throw error
  }
})
