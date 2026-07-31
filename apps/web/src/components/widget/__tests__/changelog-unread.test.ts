// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  countUnreadChangelogs,
  getChangelogSeenAt,
  markChangelogSeen,
  CHANGELOG_SEEN_EVENT,
} from '../changelog-unread'
import { installInMemoryLocalStorage } from '@/test/local-storage'

installInMemoryLocalStorage()

const entry = (publishedAt: string) => ({ publishedAt })

describe('countUnreadChangelogs', () => {
  it('counts entries published after the seen marker', () => {
    const entries = [entry('2026-07-30T10:00:00Z'), entry('2026-07-28T10:00:00Z')]
    expect(countUnreadChangelogs(entries, '2026-07-29T00:00:00Z')).toBe(1)
  })

  it('treats a missing marker as nothing unread (first visit baseline)', () => {
    const entries = [entry('2026-07-30T10:00:00Z'), entry('2020-01-01T00:00:00Z')]
    expect(countUnreadChangelogs(entries, null)).toBe(0)
  })

  it('returns 0 when every entry is at or before the marker', () => {
    const entries = [entry('2026-07-28T10:00:00Z')]
    expect(countUnreadChangelogs(entries, '2026-07-28T10:00:00Z')).toBe(0)
  })
})

describe('seen marker storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('round-trips the marker through window.localStorage', () => {
    expect(getChangelogSeenAt()).toBeNull()
    markChangelogSeen('2026-07-30T10:00:00Z')
    expect(getChangelogSeenAt()).toBe('2026-07-30T10:00:00Z')
  })

  it('never moves the marker backwards', () => {
    markChangelogSeen('2026-07-30T10:00:00Z')
    markChangelogSeen('2026-07-01T10:00:00Z')
    expect(getChangelogSeenAt()).toBe('2026-07-30T10:00:00Z')
  })

  it('dispatches the seen event so open listeners re-read the marker', () => {
    const listener = vi.fn()
    window.addEventListener(CHANGELOG_SEEN_EVENT, listener)
    markChangelogSeen('2026-07-30T10:00:00Z')
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(CHANGELOG_SEEN_EVENT, listener)
  })

  it('ignores an unparseable stored marker instead of throwing', () => {
    window.localStorage.setItem('quackback:changelog-seen-at', 'not-a-date')
    expect(getChangelogSeenAt()).toBeNull()
  })
})
