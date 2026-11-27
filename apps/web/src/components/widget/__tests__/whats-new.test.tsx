// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendToHost } = vi.hoisted(() => ({ sendToHost: vi.fn() }))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost }))

import { excerptAtWord, useWhatsNewAnnouncement, type WhatsNewEntry } from '../whats-new'
import { newestUnreadChangelog } from '../changelog-unread'
import de from '@/locales/de.json'

const entry: WhatsNewEntry = {
  id: 'changelog_1',
  title: 'Faster search',
  content: '<p>Search now answers in <strong>half the time</strong> across every board.</p>',
  publishedAt: '2026-11-20T10:00:00.000Z',
}

function wrapper(locale: string, messages?: Record<string, string>) {
  return ({ children }: { children: ReactNode }) => (
    <IntlProvider locale={locale} messages={messages} timeZone="UTC">
      {children}
    </IntlProvider>
  )
}

type State = Parameters<typeof useWhatsNewAnnouncement>[1]

function run(enabled: boolean, state: State, locale = 'en', messages?: Record<string, string>) {
  return renderHook(({ e, s }: { e: boolean; s: State }) => useWhatsNewAnnouncement(e, s), {
    initialProps: { e: enabled, s: state },
    wrapper: wrapper(locale, messages),
  })
}

const sent = () => sendToHost.mock.calls.map(([msg]) => msg as { type: string; whatsNew: unknown })

beforeEach(() => sendToHost.mockClear())

describe('excerptAtWord', () => {
  it('keeps short text whole', () => {
    expect(excerptAtWord('Short and sweet', 40)).toBe('Short and sweet')
  })

  it('cuts at the last word break', () => {
    expect(excerptAtWord('Search now answers in half the time', 20)).toBe('Search now answers…')
  })

  it('cuts text without spaces at the limit', () => {
    expect(excerptAtWord('การค้นหาเร็วขึ้นสองเท่า', 10)).toBe('การค้นหาเร…')
  })

  it('never splits an emoji', () => {
    expect(excerptAtWord('\u{1F680}\u{1F680}\u{1F680}\u{1F680}', 3)).toBe(
      '\u{1F680}\u{1F680}\u{1F680}…'
    )
  })
})

describe('newestUnreadChangelog', () => {
  it('picks the latest entry after the marker, whatever the order', () => {
    const entries = [
      { id: 'a', publishedAt: '2026-11-18T00:00:00Z' },
      { id: 'b', publishedAt: '2026-11-21T00:00:00Z' },
      { id: 'c', publishedAt: '2026-11-10T00:00:00Z' },
    ]
    expect(newestUnreadChangelog(entries, '2026-11-15T00:00:00Z')?.id).toBe('b')
    expect(newestUnreadChangelog(entries, '2026-11-22T00:00:00Z')).toBeNull()
    expect(newestUnreadChangelog(entries, null)).toBeNull()
  })
})

describe('useWhatsNewAnnouncement', () => {
  it('sends the newest unread entry with its localised card strings', () => {
    run(true, { ready: true, count: 2, newest: entry })
    expect(sent()).toEqual([
      {
        type: 'quackback:whats-new',
        whatsNew: {
          count: 2,
          entry: {
            id: 'changelog_1',
            title: 'Faster search',
            excerpt: 'Search now answers in half the time across every board.',
            publishedAt: '2026-11-20T10:00:00.000Z',
            date: 'Nov 20, 2026',
          },
          strings: {
            pill: '2 new updates',
            action: "See what's new",
            dismiss: 'Dismiss',
            label: "What's new",
          },
        },
      },
    ])
  })

  it('says one update in the singular', () => {
    run(true, { ready: true, count: 1, newest: entry })
    expect((sent()[0]!.whatsNew as { strings: { pill: string } }).strings.pill).toBe('1 new update')
  })

  it("speaks the visitor's language", () => {
    run(true, { ready: true, count: 3, newest: entry }, 'de', de)
    const { strings } = sent()[0]!.whatsNew as { strings: Record<string, string> }
    expect(strings.pill).toBe('3 neue Updates')
    expect(strings.action).not.toBe("See what's new")
  })

  it('sends null when nothing is unread', () => {
    run(true, { ready: true, count: 0, newest: null })
    expect(sent()).toEqual([{ type: 'quackback:whats-new', whatsNew: null }])
  })

  it('sends nothing while the setting is off', () => {
    run(false, { ready: true, count: 2, newest: entry })
    expect(sent()).toEqual([])
  })

  it('waits for the changelog to load before sending', () => {
    const { rerender } = run(true, { ready: false, count: 0, newest: null })
    expect(sent()).toEqual([])
    rerender({ e: true, s: { ready: true, count: 2, newest: entry } })
    expect(sent()).toHaveLength(1)
  })

  it('sends again only when the card would change', () => {
    const { rerender } = run(true, { ready: true, count: 2, newest: entry })
    rerender({ e: true, s: { ready: true, count: 2, newest: { ...entry } } })
    expect(sent()).toHaveLength(1)
    rerender({ e: true, s: { ready: true, count: 0, newest: null } })
    expect(sent()).toHaveLength(2)
    expect(sent()[1]!.whatsNew).toBeNull()
  })

  it('clears the card once when announcing turns off after a send', () => {
    const { rerender } = run(true, { ready: true, count: 2, newest: entry })
    rerender({ e: false, s: { ready: true, count: 2, newest: entry } })
    expect(sent()).toHaveLength(2)
    expect(sent()[1]!.whatsNew).toBeNull()
    rerender({ e: false, s: { ready: true, count: 3, newest: entry } })
    expect(sent()).toHaveLength(2)
    // Turned back on, the card returns.
    rerender({ e: true, s: { ready: true, count: 2, newest: entry } })
    expect(sent()).toHaveLength(3)
    expect(sent()[2]!.whatsNew).not.toBeNull()
  })

  it('sends nothing when turned off before any card went out', () => {
    const { rerender } = run(true, { ready: false, count: 0, newest: null })
    rerender({ e: false, s: { ready: true, count: 2, newest: entry } })
    expect(sent()).toEqual([])
  })

  it('sends the same card again for a new session once it loads', () => {
    const { rerender } = run(true, { ready: true, count: 2, newest: entry, session: 1 })
    // The visitor signs in: the new session's changelog is loading.
    rerender({ e: true, s: { ready: false, count: 0, newest: null, session: 2 } })
    expect(sent()).toHaveLength(1)
    rerender({ e: true, s: { ready: true, count: 2, newest: entry, session: 2 } })
    expect(sent()).toHaveLength(2)
    expect(sent()[1]).toEqual(sent()[0])
  })

  it('says 10+ when every loaded entry is unread and more exist', () => {
    run(true, { ready: true, count: 10, newest: entry, more: true })
    const { strings, count } = sent()[0]!.whatsNew as {
      count: number
      strings: Record<string, string>
    }
    expect(strings.pill).toBe('10+ new updates')
    expect(count).toBe(10)
  })

  it("says 10+ in the visitor's language", () => {
    run(true, { ready: true, count: 10, newest: entry, more: true }, 'de', de)
    const { strings } = sent()[0]!.whatsNew as { strings: Record<string, string> }
    expect(strings.pill).toBe('10+ neue Updates')
  })
})
