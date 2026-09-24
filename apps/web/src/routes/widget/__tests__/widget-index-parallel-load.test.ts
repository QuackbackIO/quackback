import { describe, expect, it, vi } from 'vitest'

// Tracks whether the SSR loader's powered-by read runs alongside its other
// independent branches (correct) or only after they have all settled (the
// regression this guards against). `portalDataSettled` flips inside the
// fake `ensureQueryData` once its macrotask fires; `getShowPoweredByFn`
// records what that flag reads at the instant it is invoked.
let portalDataSettled = false
let calledBeforePortalDataSettled = false

vi.mock('@/lib/server/functions/powered-by', () => ({
  getShowPoweredByFn: vi.fn(async () => {
    calledBeforePortalDataSettled = !portalDataSettled
    return true
  }),
}))

const { getShowPoweredByFn } = await import('@/lib/server/functions/powered-by')
const { Route } = await import('../index')

describe('widget index loader', () => {
  it('fetches the powered-by flag alongside the rest of the SSR seed, not after it', async () => {
    portalDataSettled = false
    calledBeforePortalDataSettled = false

    const queryClient = {
      // Settles on a later macrotask so a genuinely concurrent call to
      // getShowPoweredByFn still finds `portalDataSettled` false. A loader
      // that awaits this Promise.all before calling getShowPoweredByFn would
      // instead observe it already true.
      ensureQueryData: vi.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              portalDataSettled = true
              resolve({
                boards: [],
                posts: { items: [], hasMore: false },
                statuses: [],
                votedPostIds: [],
                boardPermissions: {},
              })
            }, 10)
          })
      ),
      setQueryData: vi.fn(),
    }

    const context = {
      queryClient,
      // Disables every other optional branch (messenger, team avatars,
      // changelog, help) so only the portalData fetch and the powered-by
      // read are in flight, the two this test compares.
      settings: { publicWidgetConfig: { home: { showTeamAvatars: false } } },
      session: undefined,
    }

    const loader = Route.options.loader
    if (typeof loader !== 'function') throw new Error('expected a loader function')
    await loader({ context, location: { search: {} } } as never)

    expect(getShowPoweredByFn).toHaveBeenCalledTimes(1)
    expect(calledBeforePortalDataSettled).toBe(true)
  })
})
