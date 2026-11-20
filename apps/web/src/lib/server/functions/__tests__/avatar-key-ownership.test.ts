/**
 * An uploaded avatar belongs to the person who uploaded it: upload keys are
 * issued under that person's own folder, saving a key from anyone else's
 * folder is refused, and replacing or removing an avatar deletes a stored
 * object only from the caller's own folder. A key someone already holds keeps
 * working, so avatars saved before per-person folders are not lost.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Callable = (args?: { data?: Record<string, unknown> }) => Promise<unknown>

// Server functions become directly callable: calling one runs its handler.
vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    let handler: Callable | null = null
    const fn = (args?: { data?: Record<string, unknown> }) => handler!(args ?? {})
    fn.validator = () => fn
    fn.handler = (h: Callable) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockDeleteObject: vi.fn(),
  mockFindUser: vi.fn(),
  mockSet: vi.fn(),
  mockSyncPrincipalProfile: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({ getSession: hoisted.mockGetSession }))
vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.mockRequireAuth }))
vi.mock('@/lib/server/functions/workspace', () => ({ getCurrentUserRole: vi.fn() }))
vi.mock('@/lib/server/db', () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        hoisted.mockSet(values)
        return {
          where: () => ({
            returning: async () => [{ id: 'user_me', imageKey: values.imageKey ?? null }],
          }),
        }
      },
    }),
    query: { user: { findFirst: hoisted.mockFindUser } },
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
  isS3Usable: () => true,
  isAllowedImageType: () => true,
  generateStorageKey: (prefix: string, filename: string) => `${prefix}/2026/11/uuid-${filename}`,
  generatePresignedUploadUrl: async (key: string) => ({ uploadUrl: `https://s3/${key}`, key }),
  MAX_FILE_SIZE: 10 * 1024 * 1024,
}))
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}))
vi.mock('@/lib/server/functions/widget-auth', () => ({ getWidgetSession: vi.fn() }))

const { saveAvatarKeyFn, removeAvatarFn } = await import('../user')
const { getAvatarUploadUrlFn } = await import('../uploads')

const call = (fn: unknown, data?: Record<string, unknown>) => (fn as Callable)({ data })
const saveAvatarKey = (data: Record<string, unknown>) => call(saveAvatarKeyFn, data)
const removeAvatar = () => call(removeAvatarFn)
const getAvatarUploadUrl = (data: Record<string, unknown>) => call(getAvatarUploadUrlFn, data)

const ME = 'user_me'
const MINE = `avatars/${ME}/2026/11/uuid-me.png`
const THEIRS = 'avatars/user_other/2026/11/uuid-them.png'
const LEGACY = 'avatars/2026/01/uuid-old.png'

function signedIn() {
  hoisted.mockGetSession.mockResolvedValue({
    session: { id: 'sess', scope: 'portal' },
    user: { id: ME, email: 'me@example.com', name: 'Me' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  signedIn()
})

describe('saving an avatar key', () => {
  it("refuses a key from someone else's folder and changes nothing", async () => {
    hoisted.mockFindUser.mockResolvedValue({ imageKey: null })
    await expect(saveAvatarKey({ key: THEIRS })).rejects.toMatchObject({
      code: 'AVATAR_NOT_YOURS',
    })
    expect(hoisted.mockSet).not.toHaveBeenCalled()
    expect(hoisted.mockDeleteObject).not.toHaveBeenCalled()
  })

  it('refuses an old-style key the caller does not already hold', async () => {
    hoisted.mockFindUser.mockResolvedValue({ imageKey: null })
    await expect(saveAvatarKey({ key: LEGACY })).rejects.toMatchObject({
      code: 'AVATAR_NOT_YOURS',
    })
    expect(hoisted.mockSet).not.toHaveBeenCalled()
  })

  it('saves a key from their own folder and deletes their previous upload', async () => {
    const previous = `avatars/${ME}/2026/10/uuid-prev.png`
    hoisted.mockFindUser.mockResolvedValue({ imageKey: previous })
    await saveAvatarKey({ key: MINE })
    expect(hoisted.mockSet).toHaveBeenCalledWith({ imageKey: MINE })
    expect(hoisted.mockDeleteObject).toHaveBeenCalledWith(previous)
  })

  it('keeps a key they already hold, without deleting the object behind it', async () => {
    hoisted.mockFindUser.mockResolvedValue({ imageKey: LEGACY })
    await saveAvatarKey({ key: LEGACY })
    expect(hoisted.mockDeleteObject).not.toHaveBeenCalled()
  })

  it('never deletes an object outside their folder when replacing it', async () => {
    hoisted.mockFindUser.mockResolvedValue({ imageKey: THEIRS })
    await saveAvatarKey({ key: MINE })
    expect(hoisted.mockSet).toHaveBeenCalledWith({ imageKey: MINE })
    expect(hoisted.mockDeleteObject).not.toHaveBeenCalled()
  })
})

describe('removing an avatar', () => {
  it('deletes the object when it is in their own folder', async () => {
    hoisted.mockFindUser.mockResolvedValue({ imageKey: MINE })
    await removeAvatar()
    expect(hoisted.mockDeleteObject).toHaveBeenCalledWith(MINE)
    expect(hoisted.mockSet).toHaveBeenCalledWith({ imageKey: null })
  })

  it("clears a key from someone else's folder without deleting their object", async () => {
    hoisted.mockFindUser.mockResolvedValue({ imageKey: THEIRS })
    await removeAvatar()
    expect(hoisted.mockDeleteObject).not.toHaveBeenCalled()
    expect(hoisted.mockSet).toHaveBeenCalledWith({ imageKey: null })
  })
})

describe('issuing an avatar upload key', () => {
  it("puts the key under the uploader's own folder", async () => {
    hoisted.mockRequireAuth.mockResolvedValue({ user: { id: ME }, principal: { id: 'p' } })
    const result = (await getAvatarUploadUrl({
      filename: 'me.png',
      contentType: 'image/png',
      fileSize: 10,
    })) as { key: string }
    expect(result.key.startsWith(`avatars/${ME}/`)).toBe(true)
  })
})
