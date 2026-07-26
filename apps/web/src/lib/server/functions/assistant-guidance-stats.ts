/** Guidance Applied count and last-applied timestamp, gated on assistant.manage. */
import { createServerFn } from '@tanstack/react-start'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'assistant-guidance-stats' })

/** Per-rule application stats, keyed by guidance rule id. */
export const getGuidanceRuleStatsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch guidance rule stats')
  await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
  const { getGuidanceRuleStats } = await import('@/lib/server/domains/assistant/guidance-stats')
  return await getGuidanceRuleStats()
})
