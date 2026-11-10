// @vitest-environment happy-dom
/** The Home teaser for the newest changelog entry reads to axe: solid muted text and headings in order. */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

vi.mock('../widget-auth-provider', () => ({ useWidgetAuth: () => ({ sessionVersion: 1 }) }))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useInfiniteQuery: () => ({
    data: {
      pages: [
        {
          items: [
            { id: 'e1', title: 'Dark mode', content: 'Now in dark.', publishedAt: '2026-11-01' },
          ],
        },
      ],
    },
  }),
}))

import { WidgetChangelogTeaser } from '../widget-changelog-teaser'

describe('WidgetChangelogTeaser', () => {
  it('heads its section under the page title and keeps the entry title out of the heading order', () => {
    render(
      <IntlProvider locale="en">
        <WidgetChangelogTeaser onOpenEntry={() => {}} onSeeAll={() => {}} />
      </IntlProvider>
    )
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe("What's new")
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
    expect(screen.getByRole('button', { name: /Dark mode/ })).toBeTruthy()
  })

  it('never fades muted text below its contrast', () => {
    const { container } = render(
      <IntlProvider locale="en">
        <WidgetChangelogTeaser onOpenEntry={() => {}} onSeeAll={() => {}} />
      </IntlProvider>
    )
    expect(container.innerHTML).not.toMatch(/text-muted-foreground\/\d+/)
  })
})
