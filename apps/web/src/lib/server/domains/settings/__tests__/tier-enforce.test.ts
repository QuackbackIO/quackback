import { describe, it, expect } from 'vitest'
import { enforceCountLimit, enforceFeatureGate } from '../tier-enforce'
import { TierLimitError } from '../../../errors/tier-limit-error'

describe('enforceCountLimit', () => {
  it('does nothing when limit is null', async () => {
    await expect(
      enforceCountLimit({
        limit: null,
        currentCount: async () => 9999,
        name: 'maxBoards',
        friendly: 'boards',
      })
    ).resolves.toBeUndefined()
  })

  it('does nothing when current < limit', async () => {
    await expect(
      enforceCountLimit({
        limit: 10,
        currentCount: async () => 3,
        name: 'maxBoards',
        friendly: 'boards',
      })
    ).resolves.toBeUndefined()
  })

  it('throws TierLimitError when current >= limit', async () => {
    await expect(
      enforceCountLimit({
        limit: 2,
        currentCount: async () => 2,
        name: 'maxBoards',
        friendly: 'boards',
      })
    ).rejects.toThrow(TierLimitError)
  })

  it('error contains current and max values + matching limit name', async () => {
    let caught: TierLimitError | null = null
    try {
      await enforceCountLimit({
        limit: 2,
        currentCount: async () => 2,
        name: 'maxBoards',
        friendly: 'boards',
      })
    } catch (err) {
      caught = err as TierLimitError
    }
    expect(caught).toBeInstanceOf(TierLimitError)
    expect(caught!.current).toBe(2)
    expect(caught!.max).toBe(2)
    expect(caught!.limit).toBe('maxBoards')
    expect(caught!.message).toContain('boards')
  })

  it('does not call currentCount when limit is null', async () => {
    let called = false
    await enforceCountLimit({
      limit: null,
      currentCount: async () => {
        called = true
        return 0
      },
      name: 'maxBoards',
      friendly: 'boards',
    })
    expect(called).toBe(false)
  })
})

describe('enforceAiQuota', () => {
  it('does nothing when limit is null', async () => {
    const { enforceAiQuota } = await import('../tier-enforce')
    await expect(
      enforceAiQuota({ limit: null, currentCount: async () => 9999 })
    ).resolves.toBeUndefined()
  })

  it('throws TierLimitError when current >= limit', async () => {
    const { enforceAiQuota } = await import('../tier-enforce')
    await expect(enforceAiQuota({ limit: 100, currentCount: async () => 100 })).rejects.toThrow(
      TierLimitError
    )
  })

  it('error names the limit as aiOpsPerMonth', async () => {
    const { enforceAiQuota } = await import('../tier-enforce')
    let caught: TierLimitError | null = null
    try {
      await enforceAiQuota({ limit: 100, currentCount: async () => 100 })
    } catch (err) {
      caught = err as TierLimitError
    }
    expect(caught!.limit).toBe('aiOpsPerMonth')
    expect(caught!.current).toBe(100)
    expect(caught!.max).toBe(100)
  })
})

describe('enforceFeatureGate', () => {
  it('does nothing when enabled', () => {
    expect(() =>
      enforceFeatureGate({ enabled: true, feature: 'customDomain', friendly: 'Custom domain' })
    ).not.toThrow()
  })

  it('throws TierLimitError when disabled', () => {
    expect(() =>
      enforceFeatureGate({ enabled: false, feature: 'customDomain', friendly: 'Custom domain' })
    ).toThrow(TierLimitError)
  })

  it('error names the feature with features.* prefix', () => {
    let caught: TierLimitError | null = null
    try {
      enforceFeatureGate({ enabled: false, feature: 'aiSummaries', friendly: 'AI summaries' })
    } catch (err) {
      caught = err as TierLimitError
    }
    expect(caught!.limit).toBe('features.aiSummaries')
    expect(caught!.current).toBeUndefined()
    expect(caught!.max).toBeUndefined()
  })
})
