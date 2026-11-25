import { beforeEach, describe, expect, it, vi } from 'vitest'

// The widget Home seeds visitor-specific data (the feed's viewer and their
// votes) only when the frame holds the visitor's portal session. Otherwise the
// frame is anonymous, so the seed is too, whatever the root session says.
const reuse = vi.hoisted(() => ({ value: false }))

vi.mock('@/lib/server/functions/widget/portal-session', () => ({
  widgetPortalSessionReusedFn: vi.fn(async () => reuse.value),
}))
vi.mock('@/lib/server/functions/widget/portal-origin', () => ({
  getWidgetPortalOriginFn: vi.fn(async () => 'https://portal.example'),
}))
vi.mock('@/lib/server/functions/powered-by', () => ({
  getShowPoweredByFn: vi.fn(async () => true),
}))

const { widgetPortalSessionReusedFn } = await import('@/lib/server/functions/widget/portal-session')
const { INITIAL_SESSION_VERSION, widgetQueryKeys } =
  await import('@/lib/client/hooks/use-widget-vote')
const { Route } = await import('../index')

function makeQueryClient() {
  return {
    ensureQueryData: vi.fn(async () => ({
      boards: [],
      posts: { items: [], hasMore: false },
      statuses: [],
      votedPostIds: ['post_1'],
      boardPermissions: {},
    })),
    setQueryData: vi.fn(),
  }
}

async function runLoader(queryClient: ReturnType<typeof makeQueryClient>) {
  const loader = Route.options.loader
  if (typeof loader !== 'function') throw new Error('expected a loader function')
  await loader({
    context: {
      queryClient,
      settings: { publicWidgetConfig: { home: { showTeamAvatars: false } } },
      session: { user: { id: 'user_1' } },
    },
    location: { search: {} },
  } as never)
}

function seededVotes(queryClient: ReturnType<typeof makeQueryClient>) {
  const call = queryClient.setQueryData.mock.calls.find(
    ([key]) =>
      JSON.stringify(key) ===
      JSON.stringify(widgetQueryKeys.votedPosts.bySession(INITIAL_SESSION_VERSION))
  )
  return call?.[1] as Set<string> | undefined
}

function feedViewer(queryClient: ReturnType<typeof makeQueryClient>) {
  const [options] = queryClient.ensureQueryData.mock.calls[0] as unknown as [
    { queryKey: unknown[] },
  ]
  // portalQueries.portalData keys the viewer's user id after the filters.
  return options.queryKey.includes('user_1') ? 'user_1' : undefined
}

describe('widget Home loader: visitor-specific seed', () => {
  beforeEach(() => vi.mocked(widgetPortalSessionReusedFn).mockClear())

  it('seeds as an anonymous visitor when the frame does not hold the portal session', async () => {
    reuse.value = false
    const queryClient = makeQueryClient()
    await runLoader(queryClient)

    expect(widgetPortalSessionReusedFn).toHaveBeenCalledTimes(1)
    expect(feedViewer(queryClient)).toBeUndefined()
    expect(seededVotes(queryClient)).toEqual(new Set())
  })

  it("seeds the portal visitor's feed and votes when the frame holds their session", async () => {
    reuse.value = true
    const queryClient = makeQueryClient()
    await runLoader(queryClient)

    expect(feedViewer(queryClient)).toBe('user_1')
    expect(seededVotes(queryClient)).toEqual(new Set(['post_1']))
  })

  it('settles the decision before any seed read starts', async () => {
    reuse.value = false
    let decided = false
    vi.mocked(widgetPortalSessionReusedFn).mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      decided = true
      return false
    })
    const queryClient = makeQueryClient()
    let startedBeforeDecision = false
    queryClient.ensureQueryData.mockImplementation(async () => {
      startedBeforeDecision ||= !decided
      return {
        boards: [],
        posts: { items: [], hasMore: false },
        statuses: [],
        votedPostIds: [],
        boardPermissions: {},
      }
    })
    await runLoader(queryClient)
    expect(startedBeforeDecision).toBe(false)
  })
})
