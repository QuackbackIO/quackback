// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A re-run of the widget Home loader in the browser takes the portal session
// decision from the frame itself, with no server call.
vi.mock('@/lib/server/functions/widget/portal-session', () => ({
  widgetPortalSessionReusedFn: vi.fn(async () => true),
}))
vi.mock('@/lib/server/functions/widget/portal-origin', () => ({
  getWidgetPortalOriginFn: vi.fn(async () => 'https://portal.example'),
}))
vi.mock('@/lib/server/functions/powered-by', () => ({
  getShowPoweredByFn: vi.fn(async () => true),
}))

const { widgetPortalSessionReusedFn } = await import('@/lib/server/functions/widget/portal-session')
const frame = await import('@/lib/client/widget-frame')
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

async function runLoader() {
  const queryClient = makeQueryClient()
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
  const [options] = queryClient.ensureQueryData.mock.calls[0] as unknown as [
    { queryKey: unknown[] },
  ]
  const votes = queryClient.setQueryData.mock.calls.find(
    ([key]) => Array.isArray(key) && key[1] === 'votedPosts'
  )
  return { queryKey: options.queryKey, votes }
}

describe('widget Home loader re-run in the browser', () => {
  beforeEach(() => vi.mocked(widgetPortalSessionReusedFn).mockClear())

  it('seeds as anonymous when the frame does not hold the portal session', async () => {
    frame.setFrameHoldsPortalSession(false)
    const { queryKey, votes } = await runLoader()
    expect(widgetPortalSessionReusedFn).not.toHaveBeenCalled()
    expect(queryKey).not.toContain('user_1')
    expect(votes).toEqual([['widget', 'votedPosts', 0], new Set()])
  })

  it('seeds the portal visitor when the frame holds their session', async () => {
    frame.setFrameHoldsPortalSession(true)
    const { queryKey, votes } = await runLoader()
    expect(widgetPortalSessionReusedFn).not.toHaveBeenCalled()
    expect(queryKey).toContain('user_1')
    expect(votes).toEqual([['widget', 'votedPosts', 1], new Set(['post_1'])])
  })
})
