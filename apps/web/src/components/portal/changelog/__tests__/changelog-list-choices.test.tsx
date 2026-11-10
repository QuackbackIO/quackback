// @vitest-environment happy-dom
/**
 * The changelog's entries as the design chooses them: today's dates in a
 * column, each in a card, or compact; and each entry's featured image left
 * off, across it, or small beside it. Without a choice the list is exactly
 * what it was.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params: _params,
    children,
    ...rest
  }: {
    to: string
    params?: unknown
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...(rest as React.HTMLAttributes<HTMLAnchorElement>)}>
      {children}
    </a>
  ),
}))

const ENTRIES = [
  {
    id: 'changelog_1',
    title: 'Faster search',
    content: 'Search is faster now. It finds posts by their comments too.',
    contentJson: null,
    publishedAt: '2026-10-01T12:00:00.000Z',
    featuredImageUrl: '/api/storage/changelog/search.png',
    categories: [{ id: 'cat_1', name: 'Improved', color: '#2563eb' }],
    linkedPosts: [
      {
        id: 'post_1',
        title: 'Search comments',
        voteCount: 12,
        boardSlug: 'ideas',
        status: { name: 'Shipped', color: '#16a34a' },
      },
    ],
  },
  {
    id: 'changelog_2',
    title: 'Dark mode',
    content: 'The portal follows your device.',
    contentJson: null,
    publishedAt: '2026-09-20T12:00:00.000Z',
    featuredImageUrl: null,
    categories: [],
    linkedPosts: [],
  },
]

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useInfiniteQuery: () => ({
    data: { pages: [{ items: ENTRIES }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
  }),
  useQuery: () => ({ data: [{ id: 'cat_1', name: 'Improved', color: '#2563eb' }] }),
}))

import { ChangelogListPublic } from '../changelog-list-public'

afterEach(cleanup)

function list(props: Parameters<typeof ChangelogListPublic>[0] = {}) {
  return render(
    <IntlProvider locale="en" timeZone="UTC">
      <ChangelogListPublic {...props} />
    </IntlProvider>
  ).container
}

/** The markup with the designer's section markers left out, which only make a part pickable. */
const today = (node: Element) => node.innerHTML.replace(/ data-qb-section="[^"]*"/g, '')

describe('the changelog list without a choice', () => {
  it('is exactly today’s', () => {
    expect(today(list())).toMatchSnapshot()
  })

  it('is the same as choosing today’s timeline with no images', () => {
    expect(today(list({ entries: 'timeline', images: 'none' }))).toBe(today(list()))
  })

  it('is one section the designer can pick', () => {
    expect(list().querySelectorAll('[data-qb-section="entries"]')).toHaveLength(1)
  })
})

describe('the changelog list’s entries', () => {
  it('as cards: each entry on a card, its date above its title, no date column', () => {
    const page = list({ entries: 'cards' })
    const cards = page.querySelectorAll('article[data-qb-surface="card"]')
    expect(cards).toHaveLength(2)
    expect(page.querySelector('.md\\:block.w-40')).toBeNull()
    const first = cards[0]!
    expect(first.querySelector('time')!.compareDocumentPosition(first.querySelector('h2')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(within(first as HTMLElement).getByText('Search comments')).toBeTruthy()
  })

  it('compact: title, date and a line of each, without the body or linked posts', () => {
    const page = list({ entries: 'compact' })
    const rows = page.querySelectorAll('article')
    expect(rows).toHaveLength(2)
    expect(page.textContent).toContain('Faster search')
    expect(page.querySelector('article p.line-clamp-1')?.textContent).toBe(
      'Search is faster now. It finds posts by their comments too.'
    )
    expect(page.textContent).not.toContain('Search comments')
    expect(page.querySelector('.whitespace-pre-wrap')).toBeNull()
  })
})

describe('the changelog list’s images', () => {
  it('leaves featured images off by default, as today', () => {
    expect(list().querySelector('img')).toBeNull()
  })

  it('wide: the featured image across the entry, for entries that have one', () => {
    const images = list({ images: 'wide' }).querySelectorAll('img')
    expect(images).toHaveLength(1)
    expect(images[0]!.getAttribute('src')).toBe('/api/storage/changelog/search.png')
    expect(images[0]!.getAttribute('alt')).toBe('')
    expect(images[0]!.className).toContain('w-full')
  })

  it('thumbnail: small beside the entry', () => {
    const image = list({ images: 'thumbnail' }).querySelector('img')!
    expect(image.className).toContain('size-20')
    expect(image.className).not.toContain('w-full')
  })

  it('works with every entry layout', () => {
    for (const entries of ['timeline', 'cards', 'compact'] as const) {
      expect(list({ entries, images: 'wide' }).querySelectorAll('img'), entries).toHaveLength(1)
      cleanup()
    }
  })
})
