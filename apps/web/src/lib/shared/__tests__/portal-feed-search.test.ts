import { describe, expect, it } from 'vitest'
import { portalFeedSearchSchema } from '../portal-feed-search'

describe('portal feed search params', () => {
  it('keeps good values', () => {
    expect(
      portalFeedSearchSchema.parse({ minVotes: '10', dateFrom: '2026-01-31', sort: 'top' })
    ).toMatchObject({ minVotes: 10, dateFrom: '2026-01-31', sort: 'top' })
  })

  it.each([
    [{ minVotes: 'abc' }, 'minVotes'],
    [{ minVotes: '0' }, 'minVotes'],
    [{ dateFrom: '2026-13-45' }, 'dateFrom'],
    [{ dateFrom: 'yesterday' }, 'dateFrom'],
    [{ responded: 'maybe' }, 'responded'],
    [{ status: 'open' }, 'status'],
    [{ tagIds: 5 }, 'tagIds'],
  ])('drops a bad value instead of failing the page: %o', (input, key) => {
    const parsed = portalFeedSearchSchema.parse({ ...input, search: 'kept' })
    expect(parsed[key as keyof typeof parsed]).toBeUndefined()
    expect(parsed.search).toBe('kept')
  })
})
