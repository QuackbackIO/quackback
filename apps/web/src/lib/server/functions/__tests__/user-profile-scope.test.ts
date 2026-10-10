/**
 * Widget-scoped sessions must not mutate the shared account. Portal-scoped
 * customers (widget handoff) still can, so they can use /settings/profile.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data?: Record<string, unknown> }) => Promise<unknown>

const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockSyncPrincipalProfile: vi.fn(),
  mockDeleteObject: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockUpdateNotificationPreferences: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({
  getSession: hoisted.mockGetSession,
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  getCurrentUserRole: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => hoisted.mockUpdateReturning(),
        }),
      }),
    }),
    query: { user: { findFirst: vi.fn() } },
  },
  user: { id: 'user.id' },
  principal: {},
  posts: {},
  postVotes: {},
  postComments: {},
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  count: vi.fn(),
}))

vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  syncPrincipalProfile: hoisted.mockSyncPrincipalProfile,
}))

vi.mock('@/lib/server/storage/s3', () => ({
  deleteObject: hoisted.mockDeleteObject,
}))

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: hoisted.mockUpdateNotificationPreferences,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

await import('../user')

const updateProfileNameHandler = handlers[1]
const removeAvatarHandler = handlers[2]
const saveAvatarKeyHandler = handlers[3]
const updateNotificationPreferencesHandler = handlers[6]

const SESSION_USER = { id: 'user_1', email: 'a@example.com', name: 'Ada' }

function sessionWithScope(scope: string) {
  return { session: { id: 'sess_1', scope }, user: SESSION_USER }
}

describe('profile mutations reject widget scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockUpdateReturning.mockResolvedValue([
      { id: 'user_1', name: 'Ada', email: 'a@example.com', image: null, imageKey: null },
    ])
  })

  it.each([
    ['widget', updateProfileNameHandler, { name: 'New Name' }],
    ['widget', removeAvatarHandler, undefined],
    ['widget', saveAvatarKeyHandler, { key: 'avatars/x.png' }],
  ] as const)('rejects a %s session', async (scope, handler, data) => {
    hoisted.mockGetSession.mockResolvedValue(sessionWithScope(scope))
    await expect(handler({ data: data as Record<string, unknown> })).rejects.toThrow(
      /Widget sessions/
    )
    expect(hoisted.mockUpdateReturning).not.toHaveBeenCalled()
  })

  it('updates the name on a dashboard session', async () => {
    hoisted.mockGetSession.mockResolvedValue(sessionWithScope('dashboard'))
    const result = await updateProfileNameHandler({ data: { name: 'New Name' } })
    expect(result).toEqual(expect.objectContaining({ name: 'Ada', hasCustomAvatar: false }))
    expect(hoisted.mockSyncPrincipalProfile).toHaveBeenCalled()
  })

  it('updates the name on a portal session (widget handoff customer)', async () => {
    hoisted.mockGetSession.mockResolvedValue(sessionWithScope('portal'))
    const result = await updateProfileNameHandler({ data: { name: 'New Name' } })
    expect(result).toEqual(expect.objectContaining({ name: 'Ada', hasCustomAvatar: false }))
    expect(hoisted.mockUpdateReturning).toHaveBeenCalled()
  })
})

describe('notification preference mutations reject widget scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockUpdateNotificationPreferences.mockResolvedValue({
      emailStatusChange: true,
      emailNewComment: true,
      emailMuted: false,
    })
  })

  it('rejects a widget session so a teammate Bearer cannot mute mail', async () => {
    hoisted.mockRequireAuth.mockRejectedValue(
      new Error('Access denied: Widget sessions cannot access this resource')
    )
    await expect(
      updateNotificationPreferencesHandler({ data: { emailMuted: true } })
    ).rejects.toThrow(/Widget sessions/)
    expect(hoisted.mockUpdateNotificationPreferences).not.toHaveBeenCalled()
  })

  it('allows a portal session', async () => {
    hoisted.mockRequireAuth.mockResolvedValue({
      principal: { id: 'principal_1' },
      scope: 'portal',
    })
    await updateNotificationPreferencesHandler({ data: { emailMuted: true } })
    expect(hoisted.mockUpdateNotificationPreferences).toHaveBeenCalled()
  })
})
