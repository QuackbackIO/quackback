import { describe, it, expect } from 'vitest'
import { TierLimitError } from '../tier-limit-error'

describe('TierLimitError', () => {
  it('captures the limit name, current, and max', () => {
    const err = new TierLimitError({
      limit: 'maxBoards',
      current: 2,
      max: 2,
      message: 'Board limit reached',
    })
    expect(err.limit).toBe('maxBoards')
    expect(err.current).toBe(2)
    expect(err.max).toBe(2)
    expect(err.message).toBe('Board limit reached')
    expect(err.name).toBe('TierLimitError')
  })

  it('serializes to a 402 response payload', () => {
    const err = new TierLimitError({
      limit: 'maxPosts',
      current: 100,
      max: 100,
      message: 'Post limit reached',
    })
    expect(err.toResponseBody()).toEqual({
      error: 'tier_limit_exceeded',
      limit: 'maxPosts',
      current: 100,
      max: 100,
      message: 'Post limit reached',
    })
    expect(err.statusCode).toBe(402)
  })

  it('handles feature-gate errors (no current/max)', () => {
    const err = new TierLimitError({
      limit: 'features.customDomain',
      message: 'Custom domain is not available on your plan',
    })
    expect(err.current).toBeUndefined()
    expect(err.max).toBeUndefined()
    expect(err.toResponseBody()).toEqual({
      error: 'tier_limit_exceeded',
      limit: 'features.customDomain',
      message: 'Custom domain is not available on your plan',
    })
  })

  it('is an instance of Error', () => {
    const err = new TierLimitError({ limit: 'maxBoards', message: 'x' })
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(TierLimitError)
  })
})
