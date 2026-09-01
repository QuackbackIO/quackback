import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPublicUrlOrNull } = vi.hoisted(() => ({
  mockGetPublicUrlOrNull: vi.fn((key: string | null | undefined) =>
    key ? `https://cdn.example/${key}` : null
  ),
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: mockGetPublicUrlOrNull,
}))

vi.mock('@/lib/server/db', () => ({
  db: { select: vi.fn() },
  principal: {},
  user: {},
  eq: vi.fn(),
  inArray: vi.fn(),
}))

import { resolveUserAvatarUrl } from '../principal-display'

describe('resolveUserAvatarUrl', () => {
  beforeEach(() => {
    mockGetPublicUrlOrNull.mockClear()
  })

  it('prefers the uploaded imageKey over the OAuth image', () => {
    expect(
      resolveUserAvatarUrl({
        userImage: 'https://lh3.googleusercontent.com/a/abc',
        userImageKey: 'avatars/uploaded.png',
        principalAvatarUrl: 'https://stale.example/p.png',
      })
    ).toBe('https://cdn.example/avatars/uploaded.png')
  })

  it('falls back to the OAuth image when the imageKey has no public URL', () => {
    mockGetPublicUrlOrNull.mockReturnValueOnce(null)
    expect(
      resolveUserAvatarUrl({
        userImage: 'https://lh3.googleusercontent.com/a/abc',
        userImageKey: 'avatars/orphaned.png',
      })
    ).toBe('https://lh3.googleusercontent.com/a/abc')
  })

  it('uses the OAuth image when no imageKey is stored', () => {
    expect(
      resolveUserAvatarUrl({
        userImage: 'https://lh3.googleusercontent.com/a/abc',
        userImageKey: null,
        principalAvatarUrl: 'https://stale.example/p.png',
      })
    ).toBe('https://lh3.googleusercontent.com/a/abc')
  })

  it('uses the uploaded imageKey when user.image is null', () => {
    expect(
      resolveUserAvatarUrl({
        userImage: null,
        userImageKey: 'avatars/uploaded.png',
        principalAvatarUrl: 'https://stale.example/p.png',
      })
    ).toBe('https://cdn.example/avatars/uploaded.png')
  })

  it('falls back to the principal copy', () => {
    expect(
      resolveUserAvatarUrl({
        userImage: null,
        userImageKey: null,
        principalAvatarUrl: 'https://stale.example/p.png',
      })
    ).toBe('https://stale.example/p.png')
  })

  it('returns null when nothing is stored', () => {
    expect(resolveUserAvatarUrl({ userImage: null, userImageKey: null })).toBeNull()
  })
})
