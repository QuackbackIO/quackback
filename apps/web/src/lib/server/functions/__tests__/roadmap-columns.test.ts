/**
 * getRoadmapColumnsFn answers the first page of several admin roadmap
 * columns in one request: one permission check (roadmap.manage, like
 * getRoadmapPostsFn), then each column's page in the order asked, each in
 * the shape getRoadmapPostsFn returns.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    let schema: { parse: (v: unknown) => unknown } | null = null
    let handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data?: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler({ data: schema ? schema.parse(args?.data) : args?.data })
    }
    fn.validator = (s: { parse: (v: unknown) => unknown }) => {
      schema = s
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const requireAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/auth-helpers')>()),
  requireAuth: (...args: unknown[]) => requireAuth(...args),
}))

const getRoadmapPosts = vi.fn()
vi.mock('@/lib/server/domains/roadmaps/roadmap.query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/roadmaps/roadmap.query')>()),
  getRoadmapPosts: (...args: unknown[]) => getRoadmapPosts(...args),
}))

const { getRoadmapColumnsFn, getRoadmapPostsFn } = await import('../roadmaps')

const ROADMAP = 'roadmap_01h455vb4pex5vsknk084sn02q'
const PLANNED = 'post_status_01h455vb4pex5vsknk084sn02q'
const SHIPPED = 'post_status_01h455vb4pex5vsknk084sn02r'

function row(id: string) {
  return {
    id,
    title: `Post ${id}`,
    voteCount: 3,
    statusId: PLANNED,
    eta: new Date('2026-03-01T00:00:00Z'),
    board: { id: 'board_1', name: 'Board', slug: 'board' },
  }
}

beforeEach(() => {
  requireAuth.mockReset().mockResolvedValue({})
  getRoadmapPosts.mockReset()
})

describe('getRoadmapColumnsFn', () => {
  it("answers each column's first page, in order, as getRoadmapPostsFn would", async () => {
    getRoadmapPosts.mockImplementation(async (_roadmapId, options: { statusId?: string }) => ({
      items: [row(options.statusId === PLANNED ? 'post_a' : 'post_b')],
      total: 1,
      hasMore: false,
    }))

    const pages = await getRoadmapColumnsFn({
      data: {
        roadmapId: ROADMAP,
        limit: 20,
        sort: 'votes',
        columns: [{ statusId: PLANNED }, { statusId: SHIPPED }],
      },
    })

    expect(requireAuth).toHaveBeenCalledTimes(1)
    expect(requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.ROADMAP_MANAGE })
    expect(getRoadmapPosts).toHaveBeenCalledWith(
      ROADMAP,
      expect.objectContaining({ statusId: PLANNED, offset: 0, limit: 20, sort: 'votes' })
    )
    expect(pages.map((p) => p.items[0]?.id)).toEqual(['post_a', 'post_b'])

    getRoadmapPosts.mockClear()
    const single = await getRoadmapPostsFn({
      data: { roadmapId: ROADMAP, statusId: PLANNED, limit: 20, offset: 0, sort: 'votes' },
    })
    expect(pages[0]).toEqual(single)
  })

  it('reads nothing without roadmap.manage', async () => {
    requireAuth.mockRejectedValueOnce(new Error('FORBIDDEN'))

    await expect(
      getRoadmapColumnsFn({ data: { roadmapId: ROADMAP, columns: [{ statusId: PLANNED }] } })
    ).rejects.toThrow('FORBIDDEN')
    expect(getRoadmapPosts).not.toHaveBeenCalled()
  })
})
