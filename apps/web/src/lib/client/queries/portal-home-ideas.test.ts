/**
 * Home's Top posts asks the server for just the posts it shows, from the
 * boards it was set to, and a block without boards asks as it always did.
 */
import { describe, expect, it, vi } from 'vitest'

const server = vi.hoisted(() => ({ fetchPublicPosts: vi.fn(async () => ({ items: [] })) }))
vi.mock('@/lib/server/functions/portal', () => ({
  fetchPublicPosts: server.fetchPublicPosts,
  fetchPortalData: vi.fn(),
  fetchPublicBoards: vi.fn(),
  fetchBoardCapabilitiesFn: vi.fn(),
  fetchPublicStatuses: vi.fn(),
  fetchPublicTags: vi.fn(),
  fetchAvatars: vi.fn(),
  fetchPublicRoadmaps: vi.fn(),
  fetchPublicRoadmapPosts: vi.fn(),
}))

import { portalQueries } from './portal'

const BOARD = 'board_01h455vb4pex5vsknk084sn02q'
const run = (options: ReturnType<typeof portalQueries.homeIdeas>) =>
  (options.queryFn as () => Promise<unknown>)()

describe('the Home Top posts query', () => {
  it('asks for the boards chosen and as many posts as the block shows', async () => {
    const options = portalQueries.homeIdeas({ sort: 'top', count: 10, boardIds: [BOARD] as never })
    await run(options)
    expect(server.fetchPublicPosts).toHaveBeenLastCalledWith({
      data: { sort: 'top', limit: 10, boardIds: [BOARD] },
    })
  })

  it('leaves boards out when none is chosen, so every board shows', async () => {
    await run(portalQueries.homeIdeas({ sort: 'new', count: 3 }))
    expect(server.fetchPublicPosts).toHaveBeenLastCalledWith({ data: { sort: 'new', limit: 3 } })
    await run(portalQueries.homeIdeas({ sort: 'new', count: 3, boardIds: [] }))
    expect(server.fetchPublicPosts).toHaveBeenLastCalledWith({ data: { sort: 'new', limit: 3 } })
  })

  it('keeps each choice of boards and count in its own cache entry', () => {
    const key = (boardIds?: string[], count: 3 | 5 | 10 = 3) =>
      JSON.stringify(
        portalQueries.homeIdeas({ sort: 'top', count, boardIds: boardIds as never }).queryKey
      )
    expect(key([BOARD])).not.toBe(key())
    expect(key(undefined, 10)).not.toBe(key())
    expect(key([])).toBe(key())
  })
})

describe('the Home Top posts query by status', () => {
  const SHIPPED = 'post_status_01h455vb4pex5vsknk084sn02q'

  it('asks for the statuses chosen, in their own cache entry', async () => {
    await run(portalQueries.homeIdeas({ sort: 'new', count: 5, statusIds: [SHIPPED] as never }))
    expect(server.fetchPublicPosts).toHaveBeenLastCalledWith({
      data: { sort: 'new', limit: 5, statusIds: [SHIPPED] },
    })
    const key = (statusIds?: string[]) =>
      JSON.stringify(
        portalQueries.homeIdeas({ sort: 'new', count: 5, statusIds: statusIds as never }).queryKey
      )
    expect(key([SHIPPED])).not.toBe(key())
    expect(key([])).toBe(key())
  })
})
