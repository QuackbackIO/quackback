import { describe, it, expect, vi, afterEach } from 'vitest'
import { publishedAtToPublishState, toPublishState } from '../changelog'

describe('publishedAtToPublishState', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return draft when publishedAt is undefined', () => {
    expect(publishedAtToPublishState(undefined)).toEqual({ type: 'draft' })
  })

  it('should return draft when publishedAt is empty string', () => {
    expect(publishedAtToPublishState('')).toEqual({ type: 'draft' })
  })

  it('should return published when publishedAt is in the past', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))

    const result = publishedAtToPublishState('2025-06-01T00:00:00Z')
    expect(result).toEqual({ type: 'published' })
  })

  it('should return published when publishedAt equals current time', () => {
    vi.useFakeTimers()
    const now = new Date('2025-06-15T12:00:00Z')
    vi.setSystemTime(now)

    // At the exact same millisecond, publishDate > new Date() is false, so it's published
    const result = publishedAtToPublishState('2025-06-15T12:00:00Z')
    expect(result).toEqual({ type: 'published' })
  })

  it('should return scheduled with publishAt date when publishedAt is in the future', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))

    const result = publishedAtToPublishState('2025-12-25T00:00:00Z')
    expect(result).toEqual({
      type: 'scheduled',
      publishAt: new Date('2025-12-25T00:00:00Z'),
    })
  })
})

describe('toPublishState', () => {
  it('should return draft for draft status', () => {
    expect(toPublishState('draft', null)).toEqual({ type: 'draft' })
  })

  it('should return published for published status', () => {
    expect(toPublishState('published', '2025-01-01T00:00:00Z')).toEqual({ type: 'published' })
  })

  it('should return scheduled with date for scheduled status', () => {
    const result = toPublishState('scheduled', '2025-12-25T00:00:00Z')
    expect(result).toEqual({
      type: 'scheduled',
      publishAt: new Date('2025-12-25T00:00:00Z'),
    })
  })

  it('should return scheduled with current date when publishedAt is null', () => {
    const result = toPublishState('scheduled', null)
    expect(result.type).toBe('scheduled')
    if (result.type === 'scheduled') {
      expect(result.publishAt).toBeInstanceOf(Date)
    }
  })
})
