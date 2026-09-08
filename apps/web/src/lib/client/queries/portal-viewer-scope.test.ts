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

import { removeViewerScopedPortalQueries, VIEWER_SCOPED_PORTAL_QUERY_KEYS } from './portal'

const teamCatalog = [{ id: 'tag_internal', name: 'Churn risk', isPublic: false }]
const anonymousCatalog: unknown[] = []
const teamFeedPage = { pages: [{ items: [{ id: 'post_1', tags: teamCatalog }] }], pageParams: [1] }
const feedKey = ['publicPosts', 'list', { sort: 'trending' }]

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

/** Mirrors usePublicPosts seeding an inactive feed query from the SSR payload. */
function buildFeedQueryWithInitialData(queryClient: QueryClient) {
  return queryClient
    .getQueryCache()
    .build(queryClient, { queryKey: feedKey, initialData: teamFeedPage, queryFn: async () => null })
}

describe('removeViewerScopedPortalQueries', () => {
  it('drops retained data so a later ensureQueryData refetches as the new viewer', async () => {
    const queryClient = newClient()
    // Team member loaded the portal: tag catalog (with an internal tag), the
    // feed, a roadmap column filtered by that tag and a post detail are cached,
    // then become inactive.
    queryClient.setQueryData(['portal', 'tags'], teamCatalog)
    queryClient.setQueryData(
      ['portal', 'roadmapPosts', 'rm_1', 'st_1', { tags: ['tag_internal'] }],
      { items: [{ id: 'post_1' }] }
    )
    queryClient.setQueryData(['portal', 'post', 'post_1'], { tags: teamCatalog })
    queryClient.setQueryData(
      ['portal', 'roadmaps'],
      [{ id: 'rm_1', baseFilter: { tagIds: ['tag_internal'] } }]
    )
    buildFeedQueryWithInitialData(queryClient)

    removeViewerScopedPortalQueries(queryClient)

    for (const key of VIEWER_SCOPED_PORTAL_QUERY_KEYS) {
      expect(
        queryClient.getQueryCache().findAll({ queryKey: key }),
        `${key.join('/')} still cached`
      ).toEqual([])
    }

    // The next loader read goes to the network instead of serving the team copy.
    const queryFn = vi.fn(async () => anonymousCatalog)
    const served = await queryClient.ensureQueryData({ queryKey: ['portal', 'tags'], queryFn })
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(served).toBe(anonymousCatalog)
  })

  it('guards against invalidateQueries, which leaves the team catalog servable', async () => {
    const queryClient = newClient()
    queryClient.setQueryData(['portal', 'tags'], teamCatalog)

    await queryClient.invalidateQueries({ queryKey: ['portal', 'tags'] })

    const queryFn = vi.fn(async () => anonymousCatalog)
    const served = await queryClient.ensureQueryData({ queryKey: ['portal', 'tags'], queryFn })
    expect(served).toBe(teamCatalog)
    expect(queryFn).not.toHaveBeenCalled()
  })

  it('guards against resetQueries, which restores a feed page seeded via initialData', async () => {
    const queryClient = newClient()
    const query = buildFeedQueryWithInitialData(queryClient)
    expect(query.state.data).toEqual(teamFeedPage)

    await queryClient.resetQueries({ queryKey: ['publicPosts'] })
    expect(queryClient.getQueryData(feedKey)).toEqual(teamFeedPage)

    removeViewerScopedPortalQueries(queryClient)
    expect(queryClient.getQueryData(feedKey)).toBeUndefined()
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
        ['publicPosts'],
      ])
    )
  })
})
