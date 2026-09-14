/**
 * Widget-scoped sessions must not mutate the shared dashboard profile.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data?: Record<string, unknown> }) => Promise<unknown>

const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
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
  mockSyncPrincipalProfile: vi.fn(),
  mockDeleteObject: vi.fn(),
  mockUpdateReturning: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({
  getSession: hoisted.mockGetSession,
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: vi.fn(),
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
  updateNotificationPreferences: vi.fn(),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

await import('../user')

const updateProfileNameHandler = handlers[1]
const removeAvatarHandler = handlers[2]
const saveAvatarKeyHandler = handlers[3]

const SESSION_USER = { id: 'user_1', email: 'a@example.com', name: 'Ada' }

function sessionWithScope(scope: string) {
  return { session: { id: 'sess_1', scope }, user: SESSION_USER }
}

describe('profile mutations require dashboard scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockUpdateReturning.mockResolvedValue([
      { id: 'user_1', name: 'Ada', email: 'a@example.com', image: null, imageKey: null },
    ])
  })

  it.each([
    ['widget', updateProfileNameHandler, { name: 'New Name' }],
    ['portal', updateProfileNameHandler, { name: 'New Name' }],
    ['widget', removeAvatarHandler, undefined],
    ['widget', saveAvatarKeyHandler, { key: 'avatars/x.png' }],
  ] as const)('rejects a %s session', async (scope, handler, data) => {
    hoisted.mockGetSession.mockResolvedValue(sessionWithScope(scope))
    await expect(handler({ data: data as Record<string, unknown> })).rejects.toThrow(
      /dashboard session/
    )
    expect(hoisted.mockUpdateReturning).not.toHaveBeenCalled()
  })

  it('updates the name on a dashboard session', async () => {
    hoisted.mockGetSession.mockResolvedValue(sessionWithScope('dashboard'))
    const result = await updateProfileNameHandler({ data: { name: 'New Name' } })
    expect(result).toEqual(expect.objectContaining({ name: 'Ada', hasCustomAvatar: false }))
    expect(hoisted.mockSyncPrincipalProfile).toHaveBeenCalled()
  })
})
