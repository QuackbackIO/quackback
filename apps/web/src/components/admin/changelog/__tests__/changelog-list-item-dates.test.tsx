// @vitest-environment happy-dom
/**
 * A changelog entry's published date is picked as a calendar day and stored as
 * noon UTC on it. Read in the viewer's zone it would be the next day in
 * Kiritimati (UTC+14), so "Showing as" must name the picked day everywhere.
 */
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChangelogId } from '@quackback/ids'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

import { ChangelogListItem } from '../changelog-list-item'

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
})

describe('ChangelogListItem published date', () => {
  it('shows the picked day in any zone', () => {
    setRuntimeLocale('en-US', 'Pacific/Kiritimati')
    render(
      <ChangelogListItem
        id={'changelog_1' as ChangelogId}
        title="Faster search"
        content="Search is faster."
        status="published"
        publishedAt="2026-09-20T10:00:00.000Z"
        displayDate="2026-10-01T12:00:00.000Z"
        createdAt="2026-09-19T10:00:00.000Z"
        author={null}
        linkedPosts={[]}
      />
    )
    expect(screen.getByText(/Showing as/).textContent).toBe('Showing as Oct 1, 2026')
  })
})
