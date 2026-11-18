/**
 * When the plan limits state cannot be read, the features that were already
 * gated on the plan (MCP, the AI assistant, AI article translation) fall back
 * to the plan's own entitlement, exactly as their gates answered before, rather
 * than opening. The features with no plan gate before keep failing open.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { storedCloud } from '@/lib/server/domains/settings/cloud/__tests__/cloud-fixture'
import type { PlanId } from '@/lib/server/domains/settings/cloud/cloud.types'

const h = vi.hoisted(() => ({ plan: 'free' as string }))

vi.mock('@/lib/server/domains/settings/settings.plan-limits', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.plan-limits')>()),
  readPlanLimitsSources: async () => {
    throw new Error('settings row unavailable')
  },
}))
vi.mock('@/lib/server/domains/settings/settings.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.service')>()),
  getFeatureFlags: async () => ({ planLimits: true }),
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/tier-limits.service')>()),
  getTierLimits: async () => {
    throw new Error('tier limits unavailable')
  },
}))
vi.mock('@/lib/server/domains/settings/cloud/cloud.service', async (original) => {
  const real = await original<typeof import('@/lib/server/domains/settings/cloud/cloud.service')>()
  return {
    ...real,
    getCloudConfig: async () => real.resolveCloudConfig(storedCloud(h.plan as PlanId) as never),
  }
})

import { isFeatureLive, isFeaturePaused } from '../plan-limits.service'

beforeEach(() => {
  h.plan = 'free'
})

describe('a plan limits read error', () => {
  it.each(['mcpServer', 'aiAssistant', 'aiArticleTranslation'] as const)(
    'closes %s on a plan without it',
    async (key) => {
      expect(await isFeatureLive(key)).toBe(false)
    }
  )

  it.each(['mcpServer', 'aiAssistant', 'aiArticleTranslation'] as const)(
    'keeps %s on a plan with it',
    async (key) => {
      h.plan = 'enterprise'
      expect(await isFeatureLive(key)).toBe(true)
    }
  )

  it.each(['webhooks', 'workflows', 'integrations', 'customDomain', 'customCss'] as const)(
    'never pauses %s, which had no plan gate before',
    async (key) => {
      expect(await isFeaturePaused(key)).toBe(false)
    }
  )
})
