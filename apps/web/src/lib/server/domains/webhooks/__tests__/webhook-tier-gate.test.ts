import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({ from: () => Promise.resolve([{ count: 0 }]) }),
  },
  webhooks: {},
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  sql: { raw: vi.fn() },
}))

vi.mock('@/lib/server/redis', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { WEBHOOK_LIST: 'wl' },
}))

vi.mock('@/lib/server/events/integrations/webhook/constants', () => ({
  isValidWebhookUrl: () => true,
}))

vi.mock('../encryption', () => ({
  encryptWebhookSecret: vi.fn(() => 'enc'),
}))

import { createWebhook } from '../webhook.service'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import type { PrincipalId } from '@quackback/ids'

describe('createWebhook — webhooks gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws TierLimitError when webhooks feature is off', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, webhooks: false },
    })
    await expect(
      createWebhook(
        { url: 'https://example.com/hook', events: ['post.created'] },
        'prn_x' as PrincipalId
      )
    ).rejects.toBeInstanceOf(TierLimitError)
  })
})
