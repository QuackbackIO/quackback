// @vitest-environment node
/**
 * A custom role holds exactly the permissions it was given. An admin page's
 * loader may only fail for a viewer the page itself is closed to: a read that
 * needs a permission the page does not (the team roster, the board list, the
 * segment filter, a workspace setting) is warmed only for a viewer holding it,
 * and the page renders without it otherwise.
 *
 * Each loader runs for real against the real server functions. Only the
 * caller's permission check is stood in for: a permission the role lacks is
 * refused exactly as requireAuth refuses it, and a permitted read stops right
 * after the check (no database), resolving to a fixture.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
  type PermissionKey,
} from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', async (importOriginal) => {
  const { withServerFnsInProcess } = await import('@/test/server-fns-in-process')
  return withServerFnsInProcess(await importOriginal())
})

/** Thrown by the stand-in check once the caller passes it. */
class PassedCheck extends Error {}

const caller = vi.hoisted(() => ({ permissions: [] as string[] }))

vi.mock('@/lib/server/functions/auth-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/functions/auth-helpers')>()
  return {
    ...actual,
    requireAuth: async (options?: { permission?: string }) => {
      if (options?.permission && !caller.permissions.includes(options.permission)) {
        throw new Error(`Access denied: Requires permission '${options.permission}'`)
      }
      throw new PassedCheck()
    },
    getOptionalAuth: async () => {
      throw new PassedCheck()
    },
    hasAuthCredentials: () => true,
  }
})

vi.mock('@/lib/server/functions/entitlement-status', () => ({
  hasEntitlementFn: async () => true,
  hasTierFeatureFn: async () => true,
  listEntitlementsFn: async () => ({ webhooks: true, mcpServer: true }),
}))

type QueryOptions = {
  queryKey: readonly unknown[]
  queryFn?: (ctx: Record<string, unknown>) => unknown
  initialPageParam?: unknown
}

/**
 * A query client whose reads run the query's own queryFn, so each read meets
 * its server function's real permission check. `warmed` lists the keys read.
 */
function gatedQueryClient(fixtures: Record<string, unknown> = {}) {
  const warmed: string[] = []
  const read = async (options: QueryOptions) => {
    const key = JSON.stringify(options.queryKey)
    warmed.push(key)
    try {
      return await options.queryFn?.({
        queryKey: options.queryKey,
        pageParam: options.initialPageParam,
        signal: new AbortController().signal,
        meta: undefined,
        client,
      })
    } catch (error) {
      if (error instanceof PassedCheck) return fixtures[key]
      throw error
    }
  }
  const client = {
    warmed,
    ensureQueryData: read,
    ensureInfiniteQueryData: read,
    fetchQuery: read,
    prefetchQuery: read,
    getQueryState: () => undefined,
    getQueryData: () => undefined,
    setQueryData: () => undefined,
    invalidateQueries: async () => undefined,
  }
  return client
}

type Loader = (ctx: Record<string, unknown>) => Promise<unknown>

async function loaderOf(path: string): Promise<Loader> {
  const { Route } = await import(/* @vite-ignore */ path)
  return (Route as { options: { loader: Loader } }).options.loader
}

function context(
  permissions: readonly PermissionKey[],
  queryClient: ReturnType<typeof gatedQueryClient>
) {
  caller.permissions = [...permissions]
  return {
    queryClient,
    permissions: [...permissions],
    user: { id: 'user_1', name: 'Ada', email: 'ada@example.com', image: null },
    principal: { id: 'principal_1', role: 'member', userId: 'user_1' },
    settings: { featureFlags: {} },
    billingEnabled: false,
    cloudEnabled: false,
  }
}

const key = (...parts: unknown[]) => JSON.stringify(parts)

afterEach(() => {
  caller.permissions = []
})

describe('admin page loaders for a custom role', () => {
  it('feedback loads for the built-in Contributor, which cannot list boards', async () => {
    const loader = await loaderOf('@/routes/admin/feedback.index')
    const client = gatedQueryClient()

    await expect(
      loader({ context: context(SYSTEM_ROLE_PERMISSIONS.contributor, client) })
    ).resolves.toBeDefined()
    expect(client.warmed).not.toContain(key('admin', 'boards'))
  })

  it('feedback loads for a role that may read posts and nothing else', async () => {
    const loader = await loaderOf('@/routes/admin/feedback.index')
    const client = gatedQueryClient()

    await expect(
      loader({ context: context([PERMISSIONS.POST_VIEW_PRIVATE], client) })
    ).resolves.toBeDefined()
    for (const skipped of [
      key('admin', 'team-members'),
      key('admin', 'boards'),
      key('admin', 'tags'),
      key('admin', 'statuses'),
      key('admin', 'segments'),
      key('admin', 'moderationStatus'),
    ]) {
      expect(client.warmed).not.toContain(skipped)
    }
  })

  it('feedback warms the roster, boards, tags, statuses, segments and review count for a viewer who may read them', async () => {
    const loader = await loaderOf('@/routes/admin/feedback.index')
    const client = gatedQueryClient()

    await loader({ context: context(ALL_PERMISSIONS, client) })

    expect(client.warmed).toEqual(
      expect.arrayContaining([
        key('admin', 'team-members'),
        key('admin', 'boards'),
        key('admin', 'tags'),
        key('admin', 'statuses'),
        key('admin', 'segments'),
        key('admin', 'moderationStatus'),
      ])
    )
  })

  it('roadmap loads for a role that manages roadmaps only', async () => {
    const loader = await loaderOf('@/routes/admin/roadmap')
    const client = gatedQueryClient({ [key('admin', 'roadmaps')]: [] })

    await expect(
      loader({
        context: context([PERMISSIONS.ROADMAP_MANAGE, PERMISSIONS.POST_VIEW_PRIVATE], client),
        location: { search: {} },
      })
    ).resolves.toBeDefined()
    for (const skipped of [
      key('admin', 'boards'),
      key('admin', 'tags'),
      key('admin', 'statuses'),
      key('admin', 'segments'),
    ]) {
      expect(client.warmed).not.toContain(skipped)
    }
  })

  it('users loads for a role that may read people but not segments', async () => {
    const loader = await loaderOf('@/routes/admin/users')
    const client = gatedQueryClient()

    await expect(
      loader({ context: context([PERMISSIONS.PEOPLE_VIEW], client) })
    ).resolves.toBeDefined()
    expect(client.warmed).not.toContain(key('admin', 'segments'))
  })

  it('widget settings load without board.manage or member.view', async () => {
    const loader = await loaderOf('@/routes/admin/settings.widget')
    const client = gatedQueryClient()

    await expect(
      loader({ context: context([PERMISSIONS.SETTINGS_MANAGE], client) })
    ).resolves.toBeDefined()
    expect(client.warmed).not.toContain(key('admin', 'boards'))
    expect(client.warmed).not.toContain(key('admin', 'onboarding'))
  })

  it('widget install loads without member.view', async () => {
    const loader = await loaderOf('@/routes/admin/settings.widget.install')
    const client = gatedQueryClient()

    await expect(
      loader({ context: context([PERMISSIONS.SETTINGS_MANAGE], client) })
    ).resolves.toBeUndefined()
    expect(client.warmed).not.toContain(key('admin', 'onboarding'))
  })

  it('tag settings load without board.manage', async () => {
    const loader = await loaderOf('@/routes/admin/settings.tags')
    const client = gatedQueryClient()

    await expect(
      loader({ context: context([PERMISSIONS.TAG_MANAGE, PERMISSIONS.TAG_VIEW], client) })
    ).resolves.toBeDefined()
    expect(client.warmed).not.toContain(key('admin', 'boards'))
  })

  it('developer settings load without webhook.view or settings.manage', async () => {
    const loader = await loaderOf('@/routes/admin/settings.developers')
    const client = gatedQueryClient()

    await expect(
      loader({ context: context([PERMISSIONS.API_KEY_MANAGE], client) })
    ).resolves.toBeDefined()
    expect(client.warmed).not.toContain(key('admin', 'webhooks'))
    expect(client.warmed).not.toContain(key('settings', 'developerConfig'))
  })

  it('email channel settings load without settings.manage', async () => {
    const loader = await loaderOf('@/routes/admin/settings.channels_.email')
    const client = gatedQueryClient()

    await expect(
      loader({ context: context([PERMISSIONS.CHANNEL_ACCOUNT_MANAGE], client) })
    ).resolves.toBeDefined()
    expect(client.warmed).not.toContain(key('settings', 'spamFilterConfig'))
  })

  it('board settings load without settings.manage', async () => {
    const loader = await loaderOf('@/routes/admin/settings.boards.$slug')
    const client = gatedQueryClient({
      [key('admin', 'boards')]: [{ id: 'board_1', slug: 'ideas', name: 'Ideas' }],
    })

    await expect(
      loader({
        context: context([PERMISSIONS.BOARD_MANAGE], client),
        params: { slug: 'ideas' },
      })
    ).resolves.toBeDefined()
    expect(client.warmed).not.toContain(key('settings', 'portalConfig'))
  })
})

/**
 * Each gated read, one permission at a time: the page, what its own gate
 * needs, the read's cache key and the permission its server function checks.
 */
const FEEDBACK_GATE = [PERMISSIONS.POST_VIEW_PRIVATE]
const ROADMAP_GATE = [PERMISSIONS.ROADMAP_MANAGE, PERMISSIONS.POST_VIEW_PRIVATE]
const GATED_READS: Array<[string, PermissionKey[], string, PermissionKey]> = [
  ['feedback.index', FEEDBACK_GATE, key('admin', 'team-members'), PERMISSIONS.MEMBER_VIEW],
  ['feedback.index', FEEDBACK_GATE, key('admin', 'boards'), PERMISSIONS.BOARD_MANAGE],
  ['feedback.index', FEEDBACK_GATE, key('admin', 'tags'), PERMISSIONS.TAG_VIEW],
  ['feedback.index', FEEDBACK_GATE, key('admin', 'statuses'), PERMISSIONS.STATUS_VIEW],
  ['feedback.index', FEEDBACK_GATE, key('admin', 'segments'), PERMISSIONS.SEGMENT_VIEW],
  ['feedback.index', FEEDBACK_GATE, key('admin', 'moderationStatus'), PERMISSIONS.POST_APPROVE],
  ['roadmap', ROADMAP_GATE, key('admin', 'boards'), PERMISSIONS.BOARD_MANAGE],
  ['roadmap', ROADMAP_GATE, key('admin', 'tags'), PERMISSIONS.TAG_VIEW],
  ['roadmap', ROADMAP_GATE, key('admin', 'statuses'), PERMISSIONS.STATUS_VIEW],
  ['roadmap', ROADMAP_GATE, key('admin', 'segments'), PERMISSIONS.SEGMENT_VIEW],
  ['users', [PERMISSIONS.PEOPLE_VIEW], key('admin', 'segments'), PERMISSIONS.SEGMENT_VIEW],
  [
    'settings.widget',
    [PERMISSIONS.SETTINGS_MANAGE],
    key('admin', 'boards'),
    PERMISSIONS.BOARD_MANAGE,
  ],
  [
    'settings.widget',
    [PERMISSIONS.SETTINGS_MANAGE],
    key('admin', 'onboarding'),
    PERMISSIONS.MEMBER_VIEW,
  ],
  [
    'settings.widget.install',
    [PERMISSIONS.SETTINGS_MANAGE],
    key('admin', 'onboarding'),
    PERMISSIONS.MEMBER_VIEW,
  ],
  [
    'settings.tags',
    [PERMISSIONS.TAG_MANAGE, PERMISSIONS.TAG_VIEW],
    key('admin', 'boards'),
    PERMISSIONS.BOARD_MANAGE,
  ],
  [
    'settings.developers',
    [PERMISSIONS.API_KEY_MANAGE],
    key('admin', 'webhooks'),
    PERMISSIONS.WEBHOOK_VIEW,
  ],
  [
    'settings.developers',
    [PERMISSIONS.API_KEY_MANAGE],
    key('settings', 'developerConfig'),
    PERMISSIONS.SETTINGS_MANAGE,
  ],
  [
    'settings.channels_.email',
    [PERMISSIONS.CHANNEL_ACCOUNT_MANAGE],
    key('settings', 'spamFilterConfig'),
    PERMISSIONS.SETTINGS_MANAGE,
  ],
  [
    'settings.boards.$slug',
    [PERMISSIONS.BOARD_MANAGE],
    key('settings', 'portalConfig'),
    PERMISSIONS.SETTINGS_MANAGE,
  ],
]

async function runPage(page: string, permissions: readonly PermissionKey[]) {
  const loader = await loaderOf(`@/routes/admin/${page}`)
  const client = gatedQueryClient({
    [key('admin', 'boards')]: [{ id: 'board_1', slug: 'ideas', name: 'Ideas' }],
    [key('admin', 'roadmaps')]: [],
  })
  const loaded = loader({
    context: context(permissions, client),
    location: { search: {} },
    params: { slug: 'ideas' },
  })
  return { loaded, warmed: client.warmed }
}

describe('each gated read in an admin page loader', () => {
  it.each(GATED_READS)(
    '%s (read %#) loads, without that read, for a viewer missing only its permission',
    async (page, _gate, readKey, permission) => {
      const { loaded, warmed } = await runPage(
        page,
        ALL_PERMISSIONS.filter((held) => held !== permission)
      )

      await loaded
      expect(warmed).not.toContain(readKey)
    }
  )

  it.each(GATED_READS)(
    '%s (read %#) warms that read for a viewer holding only the page gate and its permission',
    async (page, gate, readKey, permission) => {
      const { loaded, warmed } = await runPage(page, [...gate, permission])

      await loaded
      expect(warmed).toContain(readKey)
    }
  )
})

/** A custom support role: its own and its team's conversations and tickets, nothing else. */
const BILLING_AGENT: PermissionKey[] = [
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.TICKET_VIEW,
  PERMISSIONS.CONVERSATION_REPLY,
  PERMISSIONS.TICKET_REPLY,
  PERMISSIONS.CONVERSATION_NOTE,
  PERMISSIONS.TICKET_NOTE,
  PERMISSIONS.CONVERSATION_SET_STATUS,
  PERMISSIONS.TICKET_SET_STATUS,
]

/** Pages whose main read a role lacks: [role, page, permissions]. */
const CLOSED_PAGES: Array<[string, string, readonly PermissionKey[]]> = [
  ['a support-only custom role', 'feedback.index', BILLING_AGENT],
  ['a support-only custom role', 'users', BILLING_AGENT],
  ['a support-only custom role', 'help-center.index', BILLING_AGENT],
  ['the built-in Contributor', 'help-center.index', SYSTEM_ROLE_PERMISSIONS.contributor],
]

describe('an admin page a role cannot open', () => {
  it.each(CLOSED_PAGES)('for %s, %s loads without reading anything', async (_role, page, held) => {
    const { loaded, warmed } = await runPage(page, held)

    await expect(loaded).resolves.toBeDefined()
    expect(warmed).toEqual([])
  })
})
