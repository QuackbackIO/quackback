import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPublicUrlOrNull } = vi.hoisted(() => ({
  mockGetPublicUrlOrNull: vi.fn((key: string | null | undefined) =>
    key ? `https://cdn.example/${key}` : null
  ),
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: mockGetPublicUrlOrNull,
}))

const { mockPrincipalRows } = vi.hoisted(() => ({ mockPrincipalRows: vi.fn() }))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({ leftJoin: () => ({ where: () => mockPrincipalRows() }) }),
    }),
  },
  principal: {},
  user: {},
  eq: vi.fn(),
  inArray: vi.fn(),
}))

import { loadAuthors, resolveUserAvatarUrl } from '../principal-display'

const authorRow = (over: Record<string, unknown>) => ({
  id: 'principal_x',
  displayName: null,
  accountName: null,
  avatarUrl: null,
  avatarKey: null,
  userImage: null,
  userImageKey: null,
  testOwnerPrincipalId: null,
  serviceMetadata: null,
  ...over,
})

describe('loadAuthors', () => {
  it('shows the product name for the assistant principal stored under the former default name', async () => {
    mockPrincipalRows.mockResolvedValueOnce([
      authorRow({
        id: 'principal_assistant',
        displayName: 'Quinn',
        serviceMetadata: { kind: 'integration', integrationType: 'assistant' },
      }),
    ])
    const authors = await loadAuthors(['principal_assistant' as never])
    expect(authors.get('principal_assistant' as never)?.displayName).toBe('Quackback AI')
  })

  it('keeps the public name of a person or integration that is not the assistant', async () => {
    mockPrincipalRows.mockResolvedValueOnce([
      authorRow({ id: 'principal_teammate', displayName: 'Quinn', serviceMetadata: null }),
    ])
    const authors = await loadAuthors(['principal_teammate' as never])
    expect(authors.get('principal_teammate' as never)?.displayName).toBe('Quinn')
  })
})

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

  it('uses the principal uploaded key when the user row has none', () => {
    expect(
      resolveUserAvatarUrl({
        userImage: 'https://lh3.googleusercontent.com/a/abc',
        userImageKey: null,
        principalAvatarKey: 'avatars/principal.png',
        principalAvatarUrl: 'https://stale.example/p.png',
      })
    ).toBe('https://cdn.example/avatars/principal.png')
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
