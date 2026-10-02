// @vitest-environment happy-dom
/**
 * The public changelog server-renders each entry's date. 20:30 UTC on Oct 1 is
 * already Oct 2 for a reader in Kiritimati (UTC+14), so a date formatted in the
 * runtime's zone reads differently on the server and in the reader's browser.
 * The card must hydrate without error, then show the reader's day.
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChangelogId } from '@quackback/ids'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

import { ChangelogEntryCard } from '../changelog-entry-card'

afterEach(restoreRuntimeLocale)

const card = () => (
  <ChangelogEntryCard
    id={'changelog_1' as ChangelogId}
    title="Faster search"
    content="Search is faster."
    contentJson={null}
    publishedAt="2026-10-01T20:30:00.000Z"
    linkedPosts={[]}
  />
)

describe('ChangelogEntryCard hydration', () => {
  it("hydrates the date without error, then shows the reader's day", async () => {
    setRuntimeLocale('en-US', 'UTC')
    const container = document.createElement('div')
    container.innerHTML = renderToString(card())
    expect(container.textContent).toContain('October 1, 2026')

    setRuntimeLocale('en-US', 'Pacific/Kiritimati')
    const errors: unknown[] = []
    await act(async () => {
      hydrateRoot(container, card(), { onRecoverableError: (error) => errors.push(error) })
    })

    expect(errors).toEqual([])
    expect(container.textContent).toContain('October 2, 2026')
    expect(container.textContent).not.toContain('October 1, 2026')
  })
})
