// @vitest-environment node
/**
 * The admin roadmap board renders on the server once the route loader has
 * put its roadmaps in the cache. The server has no document, so the drag
 * overlay's portal into document.body must wait for the browser.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))
vi.mock('@/routes/admin/roadmap', () => ({
  Route: { fullPath: '/admin/roadmap', useSearch: () => ({}) },
}))
vi.mock('@/components/admin/roadmap-sidebar', () => ({ RoadmapSidebar: () => null }))
vi.mock('@/components/admin/roadmap-column', () => ({
  RoadmapColumn: ({ title }: { title: string }) => <section>{title}</section>,
}))
vi.mock('@/components/admin/roadmap/roadmap-filters-bar', () => ({
  RoadmapFiltersBar: () => null,
}))

const { RoadmapAdmin } = await import('@/components/admin/roadmap-admin')
const { roadmapsKeys } = await import('@/lib/client/hooks/use-roadmaps-query')
const { adminQueries } = await import('@/lib/client/queries/admin')

describe('RoadmapAdmin on the server', () => {
  it('renders the selected board without a document', () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    client.setQueryData(adminQueries.boards().queryKey, [])
    client.setQueryData(adminQueries.tags().queryKey, [])
    client.setQueryData(adminQueries.segments().queryKey, [])
    client.setQueryData(roadmapsKeys.list(), [
      {
        id: 'roadmap_first',
        name: 'Product roadmap',
        description: null,
        type: 'column',
        columns: [{ id: 'col_1', statusId: 'status_planned', name: 'Planned', color: '#000' }],
      },
    ])

    const html = renderToString(
      <QueryClientProvider client={client}>
        <RoadmapAdmin />
      </QueryClientProvider>
    )

    expect(html).toContain('Product roadmap')
    expect(html).toContain('Planned')
  })
})
