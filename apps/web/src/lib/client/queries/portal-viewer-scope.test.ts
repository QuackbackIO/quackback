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
}))

import { resetViewerScopedPortalQueries, VIEWER_SCOPED_PORTAL_QUERY_KEYS } from './portal'

const teamCatalog = [{ id: 'tag_internal', name: 'Churn risk', isPublic: false }]
const anonymousCatalog: unknown[] = []

describe('resetViewerScopedPortalQueries', () => {
  it('drops retained data so a later ensureQueryData refetches as the new viewer', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // Team member loaded the roadmap: tag catalog (with an internal tag) and a
    // roadmap column filtered by that tag are cached, then become inactive.
    queryClient.setQueryData(['portal', 'tags'], teamCatalog)
    queryClient.setQueryData(
      ['portal', 'roadmapPosts', 'rm_1', 'st_1', { tags: ['tag_internal'] }],
      {
        items: [{ id: 'post_1' }],
      }
    )
    queryClient.setQueryData(['portal', 'post', 'post_1'], { tags: teamCatalog })
    queryClient.setQueryData(
      ['portal', 'roadmaps'],
      [{ id: 'rm_1', baseFilter: { tagIds: ['tag_internal'] } }]
    )

    await resetViewerScopedPortalQueries(queryClient)

    for (const key of VIEWER_SCOPED_PORTAL_QUERY_KEYS) {
      for (const query of queryClient.getQueryCache().findAll({ queryKey: key })) {
        expect(query.state.data, `${key.join('/')} still holds data`).toBeUndefined()
      }
    }

    // The next loader read goes to the network instead of serving the team copy.
    const queryFn = vi.fn(async () => anonymousCatalog)
    const served = await queryClient.ensureQueryData({ queryKey: ['portal', 'tags'], queryFn })
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(served).toBe(anonymousCatalog)
  })

  it('invalidateQueries alone would have left the team catalog servable (the bug being guarded)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['portal', 'tags'], teamCatalog)

    await queryClient.invalidateQueries({ queryKey: ['portal', 'tags'] })

    const queryFn = vi.fn(async () => anonymousCatalog)
    const served = await queryClient.ensureQueryData({ queryKey: ['portal', 'tags'], queryFn })
    expect(served).toBe(teamCatalog)
    expect(queryFn).not.toHaveBeenCalled()
  })

  it('covers every family whose payload depends on the viewer', () => {
    expect(VIEWER_SCOPED_PORTAL_QUERY_KEYS).toEqual(
      expect.arrayContaining([
        ['portal', 'tags'],
        ['portal', 'data'],
        ['portal', 'posts'],
        ['portal', 'post'],
        ['portal', 'roadmaps'],
        ['portal', 'roadmapPosts'],
      ])
    )
  })
})
