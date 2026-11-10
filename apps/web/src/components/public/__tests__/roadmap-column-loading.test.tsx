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

import { RoadmapColumn } from '../roadmap-column'
import { Skeleton } from '@/components/ui/skeleton'

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
  it.each(['group', 'column'] as const)('holds room for its first cards (%s)', (layout) => {
    const { container } = mount(layout)
    const held = container.querySelector('[data-qb-skeleton=roadmap-cards]')!
    expect(held.getAttribute('aria-hidden')).toBe('true')
    expect(held.children).toHaveLength(3)
    // No spinner standing in for the cards, and no empty state before it knows.
    expect(container.querySelector('.animate-spin')).toBeNull()
    expect(screen.queryByText('No items yet')).toBeNull()
  })

  it('draws its placeholders in the same look as the app’s Skeleton', () => {
    const { container } = mount('group')
    const card = container.querySelector('[data-qb-skeleton=roadmap-cards] > div')!
    const { container: reference } = render(<Skeleton />)
    const look = reference.querySelector('[data-slot=skeleton]')!.className.split(' ')
    expect(card.className.split(' ')).toEqual(expect.arrayContaining(look))
  })

  it('says it is empty once its posts are known to be none', () => {
    state.loading = false
    const { container } = mount('group')
    expect(screen.getByText('No items yet')).toBeTruthy()
    expect(container.querySelector('[data-qb-skeleton]')).toBeNull()
  })
})
