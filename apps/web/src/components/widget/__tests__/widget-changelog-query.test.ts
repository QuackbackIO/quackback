import { describe, expect, it } from 'vitest'
import { INITIAL_SESSION_VERSION } from '@/lib/client/hooks/use-widget-vote'
import { shouldClearUnavailableChangelogCategory } from '../widget-changelog-query'

describe('shouldClearUnavailableChangelogCategory', () => {
  const ready = { sessionVersion: 1, listReady: true, stillLooking: false }

  it('clears a filter the current session feed no longer contains', () => {
    expect(shouldClearUnavailableChangelogCategory('secret', [{ id: 'public' }], ready)).toBe(true)
    expect(shouldClearUnavailableChangelogCategory('public', [{ id: 'public' }], ready)).toBe(false)
    expect(shouldClearUnavailableChangelogCategory(null, [{ id: 'public' }], ready)).toBe(false)
  })

  it('waits until the feed is in and lookahead has finished', () => {
    expect(
      shouldClearUnavailableChangelogCategory('secret', [], {
        ...ready,
        listReady: false,
      })
    ).toBe(false)
    expect(
      shouldClearUnavailableChangelogCategory('secret', [], {
        ...ready,
        stillLooking: true,
      })
    ).toBe(false)
  })

  it('does not bounce on the anonymous first paint', () => {
    expect(
      shouldClearUnavailableChangelogCategory('secret', [], {
        ...ready,
        sessionVersion: INITIAL_SESSION_VERSION,
      })
    ).toBe(false)
  })
})
