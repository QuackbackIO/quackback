// @vitest-environment happy-dom
/**
 * A roadmap column waiting on its posts holds room for its first cards, in
 * the app's one placeholder look, so the page does not grow under the visitor
 * when they arrive; it says it is empty only once it knows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const state = vi.hoisted(() => ({ loading: true }))
vi.mock('@/lib/client/hooks/use-roadmap-posts-query', () => ({
  usePublicRoadmapPosts: () => ({
    data: state.loading ? undefined : { pages: [{ items: [], total: 0, hasMore: false }] },
    isLoading: state.loading,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  flattenRoadmapViewPosts: (data?: { pages: Array<{ items: unknown[] }> }) =>
    data?.pages.flatMap((page) => page.items) ?? [],
}))
vi.mock('@/lib/client/hooks/use-infinite-scroll', () => ({ useInfiniteScroll: () => vi.fn() }))

import { ROADMAP_GROUPS_CLASS, RoadmapColumn } from '../roadmap-column'

afterEach(() => {
  cleanup()
  state.loading = true
})

const mount = (layout: 'column' | 'group') =>
  render(
    <IntlProvider locale="en">
      <RoadmapColumn
        roadmapId={'roadmap_1' as never}
        statusId={'status_1' as never}
        title="Planned"
        color="#888"
        layout={layout}
      />
    </IntlProvider>
  )

describe('a roadmap column loading its posts', () => {
  it.each([
    ['group', 10],
    ['column', 3],
  ] as const)('holds room for its first cards (%s)', (layout, cards) => {
    const { container } = mount(layout)
    const held = container.querySelector('[data-qb-skeleton=roadmap-cards]')!
    expect(held.getAttribute('aria-hidden')).toBe('true')
    expect(held.children).toHaveLength(cards)
    // No spinner standing in for the cards, and no empty state before it knows.
    expect(container.querySelector('.animate-spin')).toBeNull()
    expect(screen.queryByText('No items yet')).toBeNull()
    // No count until it is known.
    expect(screen.queryByText('0')).toBeNull()
  })

  it('draws its placeholders in the app’s placeholder look', () => {
    const { container } = mount('group')
    const card = container.querySelector('[data-qb-skeleton=roadmap-cards] > div')!
    expect(card.className.split(' ')).toContain('qb-skeleton')
  })

  it('says it is empty once its posts are known to be none', () => {
    state.loading = false
    const { container } = mount('group')
    expect(screen.getByText('No items yet')).toBeTruthy()
    expect(screen.getByText('0')).toBeTruthy()
    expect(container.querySelector('[data-qb-skeleton]')).toBeNull()
  })

  it('hides the groups after a loading group, so they never move down the list', () => {
    const { container } = mount('group')
    const group = container.querySelector('section')!
    expect(group.hasAttribute('data-qb-loading')).toBe(true)
    // The list hides every group after one still marked loading.
    expect(ROADMAP_GROUPS_CLASS.split(' ')).toContain('[&>[data-qb-loading]~section]:hidden')
    cleanup()
    state.loading = false
    expect(mount('group').container.querySelector('section')!.hasAttribute('data-qb-loading')).toBe(
      false
    )
  })
})
