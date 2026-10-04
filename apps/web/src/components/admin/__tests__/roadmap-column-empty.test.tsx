// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

vi.mock('@dnd-kit/core', () => ({ useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }) }))
vi.mock('@/lib/client/hooks/use-infinite-scroll', () => ({ useInfiniteScroll: () => vi.fn() }))
vi.mock('@/lib/client/hooks/use-roadmap-posts-query', () => ({
  useRoadmapPostsByRoadmap: () => ({
    data: { pages: [{ items: [], total: 0 }] },
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isLoading: false,
  }),
  flattenRoadmapViewPosts: () => [],
}))
vi.mock('../roadmap-card', () => ({ RoadmapCard: () => null }))

import { RoadmapColumn } from '../roadmap-column'
import type { RoadmapId } from '@quackback/ids'

afterEach(cleanup)

const column = (emptyAction?: React.ReactNode) =>
  render(
    <IntlProvider locale="en" defaultLocale="en" onError={() => {}}>
      <RoadmapColumn
        roadmapId={'roadmap_1' as RoadmapId}
        columnId="c1"
        title="Planned"
        color="#000"
        emptyAction={emptyAction}
      />
    </IntlProvider>
  )

describe('an empty roadmap column', () => {
  it('names what is missing and carries the action it is given, without a paragraph', () => {
    const { container } = column(<a href="/admin/feedback">Move an idea onto the roadmap</a>)
    expect(screen.getByText('No ideas here yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Move an idea onto the roadmap' })).toBeTruthy()
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  it('stays a bare title in the other columns', () => {
    column()
    expect(screen.getByText('No ideas here yet')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
