// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/lib/server/functions/portal', () => ({
  fetchPublicBoards: vi.fn(),
  fetchPublicPosts: vi.fn(),
  fetchPublicStatuses: vi.fn(),
  fetchPublicTags: vi.fn(),
  fetchAvatars: vi.fn(),
  fetchPublicRoadmaps: vi.fn(),
  fetchPublicRoadmapPosts: vi.fn(),
  fetchPortalData: vi.fn(),
}))

import { fetchPublicStatuses } from '@/lib/server/functions/portal'
import { portalQueries, useSeedPortalStatusesCache } from './portal'

const statuses = [{ id: 'st_1', name: 'Open', color: '#000', category: 'open', position: 0 }]

function newWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useSeedPortalStatusesCache', () => {
  it('lets a post-detail navigation reuse the status list the feed already rendered with', async () => {
    vi.mocked(fetchPublicStatuses).mockResolvedValue(statuses as never)
    // staleTime mirrors router.tsx's QueryClient default: within it, a query
    // seeded with initialData is fresh and ensureQueryData serves it as-is.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    })

    // Mirrors PortalFeed rendering with the feed's already-fetched statuses.
    renderHook(() => useSeedPortalStatusesCache(statuses as never), {
      wrapper: newWrapper(queryClient),
    })

    await waitFor(() =>
      expect(queryClient.getQueryData(portalQueries.statuses().queryKey)).toEqual(statuses)
    )

    // Mirrors the post-detail loader's ensureQueryData(portalQueries.statuses()).
    const served = await queryClient.ensureQueryData(portalQueries.statuses())

    expect(served).toEqual(statuses)
    expect(fetchPublicStatuses).not.toHaveBeenCalled()
  })
})
