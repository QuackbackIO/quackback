import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

vi.mock('@/lib/server/functions/portal', () => ({
  fetchPublicBoards: vi.fn(),
  fetchPublicPosts: vi.fn(),
  fetchPublicStatuses: vi.fn(),
  fetchPublicTags: vi.fn(),
  fetchAvatars: vi.fn(),
  fetchPublicRoadmaps: vi.fn(),
  fetchPublicRoadmapPosts: vi.fn(),
  fetchPortalData: vi.fn(),
  fetchRoadmapPageData: vi.fn(),
}))

import {
  fetchRoadmapPageData,
  fetchPublicRoadmaps,
  fetchPublicStatuses,
  fetchPublicBoards,
  fetchPublicTags,
} from '@/lib/server/functions/portal'
import { portalQueries } from './portal'

const roadmaps = [{ id: 'rm_1', name: 'Now/Next/Later' }]
const statuses = [{ id: 'st_1', name: 'Open' }]
const boards = [{ id: 'brd_1', name: 'Feature Requests' }]
const tags = [{ id: 'tag_1', name: 'bug' }]

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  })
}

describe('portalQueries.roadmapPageData', () => {
  it('fetches the roadmap shell in one call and seeds the four query caches its page reads', async () => {
    vi.mocked(fetchRoadmapPageData).mockResolvedValue({
      roadmaps,
      statuses,
      boards,
      tags,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const queryClient = newClient()

    const data = await queryClient.ensureQueryData(portalQueries.roadmapPageData())
    expect(data.roadmaps).toEqual(roadmaps)

    // The roadmap page's own components read these four keys directly
    // (RoadmapBoard reads boards()/tags(), the route reads roadmaps(), the
    // status lookups read statuses()). None of them should hit the network.
    expect(await queryClient.ensureQueryData(portalQueries.roadmaps())).toEqual(roadmaps)
    expect(await queryClient.ensureQueryData(portalQueries.statuses())).toEqual(statuses)
    expect(await queryClient.ensureQueryData(portalQueries.boards())).toEqual(boards)
    expect(await queryClient.ensureQueryData(portalQueries.tags())).toEqual(tags)

    expect(fetchPublicRoadmaps).not.toHaveBeenCalled()
    expect(fetchPublicStatuses).not.toHaveBeenCalled()
    expect(fetchPublicBoards).not.toHaveBeenCalled()
    expect(fetchPublicTags).not.toHaveBeenCalled()
    expect(fetchRoadmapPageData).toHaveBeenCalledTimes(1)
  })
})
