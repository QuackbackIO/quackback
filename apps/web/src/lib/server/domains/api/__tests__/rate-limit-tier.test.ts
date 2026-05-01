import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

import { checkRateLimit } from '../rate-limit'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

describe('checkRateLimit — tier-aware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses apiRequestsPerMinute from tier when set', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, apiRequestsPerMinute: 5 })
    // 5 requests allowed; 6th blocked.
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit('1.1.1.1')
      expect(r.allowed).toBe(true)
    }
    const blocked = await checkRateLimit('1.1.1.1')
    expect(blocked.allowed).toBe(false)
  })

  it('falls back to OSS default cap when tier limit is null', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    // Default cap is 100 — first 100 should be allowed.
    for (let i = 0; i < 100; i++) {
      const r = await checkRateLimit('2.2.2.2')
      expect(r.allowed).toBe(true)
    }
    const blocked = await checkRateLimit('2.2.2.2')
    expect(blocked.allowed).toBe(false)
  })
})
