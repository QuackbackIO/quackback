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
