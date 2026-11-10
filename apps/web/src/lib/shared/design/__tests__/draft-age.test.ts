import { describe, expect, it } from 'vitest'
import { STALE_DRAFT_DAYS, staleDraftSince } from '../draft-age'

const now = new Date('2026-11-02T12:00:00Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()

describe('a draft from an earlier visit', () => {
  it('is stale once its last change is more than fourteen days old', () => {
    expect(STALE_DRAFT_DAYS).toBe(14)
    expect(staleDraftSince(daysAgo(15), now)?.toISOString()).toBe(daysAgo(15))
  })

  it('is not stale at fourteen days or less', () => {
    expect(staleDraftSince(daysAgo(14), now)).toBeNull()
    expect(staleDraftSince(daysAgo(1), now)).toBeNull()
  })

  it('is never stale without a draft or a date that reads', () => {
    expect(staleDraftSince(null, now)).toBeNull()
    expect(staleDraftSince('not a date', now)).toBeNull()
  })
})
