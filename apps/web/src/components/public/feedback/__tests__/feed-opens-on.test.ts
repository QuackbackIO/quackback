/**
 * The design can open the feed on one board: a visit to the feed with no
 * board in its address goes on to that board's, while a board the address
 * names, a board the visitor cannot see, and All boards are left alone.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  redirect: (options: object) => ({ redirect: options }),
  notFound: () => ({ notFound: true }),
}))
vi.mock('@/lib/client/queries/portal', () => ({
  portalQueries: {
    portalData: (params: object) => ({ queryKey: ['portal-data', params] }),
    boards: () => ({ queryKey: ['boards'] }),
  },
}))

const { loadFeed } = await import('../feed-route')

const BOARDS = [
  { id: 'board_ideas', slug: 'ideas' },
  { id: 'board_bugs', slug: 'bugs' },
]

function load(openOn: string | undefined, search: Record<string, unknown> = {}) {
  const ensureQueryData = vi.fn(async () => BOARDS)
  const context = {
    settings: {
      name: 'Acme',
      featureFlags: { feedback: true },
      portalDesign: {
        engine: 'v2',
        feedback: { defaultSort: 'trending', ...(openOn ? { openOn } : {}) },
      },
    },
    session: null,
    baseUrl: '',
    queryClient: { prefetchQuery: vi.fn(async () => {}), ensureQueryData },
  }
  return {
    result: loadFeed(context as never, { search } as never, '/feedback'),
    ensureQueryData,
  }
}

describe('the feed’s opening board', () => {
  it('goes on to the design’s board when the address names none', async () => {
    await expect(load('board_bugs', { sort: 'top' }).result).rejects.toEqual({
      redirect: { to: '/feedback', search: { sort: 'top', board: 'bugs' }, replace: true },
    })
  })

  it('keeps the board the address names', async () => {
    const { result, ensureQueryData } = load('board_bugs', { board: 'ideas' })
    await expect(result).resolves.toMatchObject({ canonicalPath: '/feedback' })
    expect(ensureQueryData).not.toHaveBeenCalled()
  })

  it('opens on every board with no board set, without asking for the boards', async () => {
    const { result, ensureQueryData } = load(undefined)
    await expect(result).resolves.toMatchObject({ canonicalPath: '/feedback' })
    expect(ensureQueryData).not.toHaveBeenCalled()
  })

  it('opens on every board when the visitor cannot see the design’s board', async () => {
    await expect(load('board_private').result).resolves.toMatchObject({
      canonicalPath: '/feedback',
    })
  })
})
