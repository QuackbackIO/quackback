import { describe, expect, it, vi } from 'vitest'

const { mockFetchPortalData } = vi.hoisted(() => ({
  mockFetchPortalData: vi.fn(),
}))

vi.mock('@/lib/server/functions/portal', () => ({
  fetchPublicBoards: vi.fn(),
  fetchPublicPosts: vi.fn(),
  fetchPublicStatuses: vi.fn(),
  fetchPublicTags: vi.fn(),
  fetchAvatars: vi.fn(),
  fetchPublicRoadmaps: vi.fn(),
  fetchPublicRoadmapPosts: vi.fn(),
  fetchPortalData: (...args: unknown[]) => mockFetchPortalData(...args),
}))

import { portalQueries } from './portal'

describe('portalQueries.portalData', () => {
  it('throws a query error when the server function returns no payload', async () => {
    mockFetchPortalData.mockResolvedValueOnce(undefined)

    const options = portalQueries.portalData({ sort: 'top' })
    const queryFn = options.queryFn as unknown as () => Promise<unknown>

    await expect(queryFn()).rejects.toThrow('Server returned no data for portalData')
  })
})
