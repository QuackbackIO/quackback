// @vitest-environment happy-dom
/**
 * The inbox renders again for each update to its post list (a page loading,
 * a search's results arriving). The filter panel beside it shows filters and
 * their counts, none of which those updates change, so it renders only when
 * its own filters do.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { InboxFilters } from '@/components/admin/feedback/use-inbox-filters'

let sectionRenders = 0
vi.mock('@/components/shared/filter-section', () => ({
  FilterSection: ({ title }: { title: string }) => {
    sectionRenders++
    return <div>{title}</div>
  },
}))

const { InboxFiltersPanel } = await import('../inbox-filters')

afterEach(cleanup)

const onFiltersChange = () => {}
const NONE: never[] = []
let bumpList: () => void = () => {}
let setFilters: (filters: InboxFilters) => void = () => {}

/** Re-renders for its list's sake, handing the panel the same props. */
function Inbox() {
  const [, setListVersion] = useState(0)
  const [filters, setFiltersState] = useState<InboxFilters>({ sort: 'newest' })
  bumpList = () => setListVersion((v) => v + 1)
  setFilters = setFiltersState
  return (
    <InboxFiltersPanel
      filters={filters}
      onFiltersChange={onFiltersChange}
      boards={NONE}
      tags={NONE}
      statuses={NONE}
    />
  )
}

describe('InboxFiltersPanel renders', () => {
  it('renders for its filters, not for the list beside it', () => {
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
    render(
      <QueryClientProvider client={client}>
        <Inbox />
      </QueryClientProvider>
    )
    const perRender = sectionRenders
    expect(perRender).toBeGreaterThan(0)

    act(() => bumpList())
    act(() => bumpList())
    expect(sectionRenders).toBe(perRender)

    act(() => setFilters({ sort: 'newest', search: 'export' }))
    expect(sectionRenders).toBe(perRender * 2)
  })
})
