import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/lib/server/db'

/**
 * fetchUserAvatar runs in the portal, admin and widget loaders for the
 * signed-in viewer. During a document render the root bootstrap has already
 * resolved that viewer's session, user row included, so the avatar costs no
 * further read. Called from the browser as a server function, nothing is
 * resolved yet and one read by id is the cheapest way.
 */

const hoisted = vi.hoisted(() => ({
  headers: new Headers(),
  getRequestSession: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler<T>(fn: T) {
        return fn
      },
    }
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => hoisted.headers,
}))
vi.mock('@/lib/server/auth/request-session', () => ({
  getRequestSession: hoisted.getRequestSession,
}))
vi.mock('@/lib/server/storage/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/storage/s3')>()),
  getPublicUrlOrNull: (key: string | null | undefined) =>
    key ? `https://cdn.example/${key}` : null,
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: { user: { findFirst: vi.fn() } } },
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

type Handler = (args: {
  data: { userId: string; fallbackImageUrl?: string | null }
}) => Promise<{ avatarUrl: string | null; hasCustomAvatar: boolean }>

let fetchUserAvatar: Handler

const viewer = {
  session: { id: 'session_1' },
  user: { id: 'user_viewer', image: 'https://idp.example/me.png', imageKey: 'avatars/viewer.png' },
}

beforeEach(async () => {
  vi.clearAllMocks()
  hoisted.headers = new Headers()
  fetchUserAvatar = (await import('../portal')).fetchUserAvatar as unknown as Handler
  vi.mocked(db.query.user.findFirst).mockResolvedValue({
    image: 'https://idp.example/row.png',
    imageKey: 'avatars/row.png',
  } as never)
})

describe('fetchUserAvatar', () => {
  it("reads the viewer's own avatar from the session a document render already resolved", async () => {
    hoisted.getRequestSession.mockResolvedValue(viewer)

    const result = await fetchUserAvatar({
      data: { userId: 'user_viewer', fallbackImageUrl: viewer.user.image },
    })

    expect(result).toEqual({
      avatarUrl: 'https://cdn.example/avatars/viewer.png',
      hasCustomAvatar: true,
    })
    expect(db.query.user.findFirst).not.toHaveBeenCalled()
  })

  it('falls back to the provider picture when the viewer uploaded none', async () => {
    hoisted.getRequestSession.mockResolvedValue({
      ...viewer,
      user: { ...viewer.user, imageKey: null },
    })

    const result = await fetchUserAvatar({
      data: { userId: 'user_viewer', fallbackImageUrl: viewer.user.image },
    })

    expect(result).toEqual({ avatarUrl: 'https://idp.example/me.png', hasCustomAvatar: false })
    expect(db.query.user.findFirst).not.toHaveBeenCalled()
  })

  it('reads the row for anyone other than the signed-in viewer', async () => {
    hoisted.getRequestSession.mockResolvedValue(viewer)

    const result = await fetchUserAvatar({ data: { userId: 'user_other' } })

    expect(result.avatarUrl).toBe('https://cdn.example/avatars/row.png')
    expect(db.query.user.findFirst).toHaveBeenCalledTimes(1)
  })

  it('reads the row, not the session, when called from the browser', async () => {
    hoisted.headers = new Headers({ 'x-tsr-serverFn': 'true' })
    hoisted.getRequestSession.mockResolvedValue(viewer)

    const result = await fetchUserAvatar({ data: { userId: 'user_viewer' } })

    expect(result.avatarUrl).toBe('https://cdn.example/avatars/row.png')
    expect(db.query.user.findFirst).toHaveBeenCalledTimes(1)
    expect(hoisted.getRequestSession).not.toHaveBeenCalled()
  })
})
