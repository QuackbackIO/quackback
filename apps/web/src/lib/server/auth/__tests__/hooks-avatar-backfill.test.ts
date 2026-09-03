/**
 * `handleAvatarBackfillAfter` — fill `user.image` from the SSO `picture` claim,
 * but only when the account has no avatar yet.
 *
 * Better-Auth writes `image` only when it CREATES the user, and we leave
 * `overrideUserInfo` off. This hook covers the gap for accounts that predate
 * the workspace's IdP returning a `picture` (or predate this feature), without
 * ever overwriting an avatar the user chose in Quackback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUserFindFirst = vi.fn()
const mockAccountFindFirst = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn(async () => undefined)
const mockUpdate = vi.fn(() => ({
  set: (...args: unknown[]) => {
    mockUpdateSet(...args)
    return { where: mockUpdateWhere }
  },
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      user: { findFirst: mockUserFindFirst },
      account: { findFirst: mockAccountFindFirst },
    },
    update: mockUpdate,
  },
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  eq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
  desc: vi.fn((col: unknown) => ({ op: 'desc', col })),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}))

const { handleAvatarBackfillAfter } = await import('../hooks')
const { stashResolvedClaims, takeResolvedClaims } = await import('../resolved-claims-stash')

const PROVIDER = 'oidc_acme'
const REGISTERED = new Set([PROVIDER])
const USER_ID = 'user_abc'

function ctx(over: Record<string, unknown> = {}) {
  return {
    path: '/oauth2/callback/:providerId',
    params: { providerId: PROVIDER },
    context: { newSession: { user: { id: USER_ID } } },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAccountFindFirst.mockResolvedValue({ accountId: 'sub-1', idToken: null })
  // The stash is module state; drain any entry a prior test left (the hook
  // only peeks, so it never clears its own).
  takeResolvedClaims(PROVIDER, 'sub-1')
})

describe('handleAvatarBackfillAfter', () => {
  it('fills an empty avatar from the resolved `picture` claim', async () => {
    mockUserFindFirst.mockResolvedValue({ image: null })
    stashResolvedClaims(PROVIDER, 'sub-1', { picture: 'https://cdn.acme.test/u/1.png' })

    await handleAvatarBackfillAfter(ctx(), REGISTERED)

    expect(mockUpdateSet).toHaveBeenCalledWith({ image: 'https://cdn.acme.test/u/1.png' })
  })

  it('does nothing when the user already has an avatar', async () => {
    mockUserFindFirst.mockResolvedValue({ image: 'https://user-chosen.test/me.png' })
    stashResolvedClaims(PROVIDER, 'sub-1', { picture: 'https://cdn.acme.test/u/1.png' })

    await handleAvatarBackfillAfter(ctx(), REGISTERED)

    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only image as empty', async () => {
    mockUserFindFirst.mockResolvedValue({ image: '   ' })
    stashResolvedClaims(PROVIDER, 'sub-1', { picture: 'https://cdn.acme.test/u/1.png' })

    await handleAvatarBackfillAfter(ctx(), REGISTERED)

    expect(mockUpdateSet).toHaveBeenCalledWith({ image: 'https://cdn.acme.test/u/1.png' })
  })

  it('does nothing when no usable picture is available', async () => {
    mockUserFindFirst.mockResolvedValue({ image: null })
    stashResolvedClaims(PROVIDER, 'sub-1', { picture: 'not-a-url' })

    await handleAvatarBackfillAfter(ctx(), REGISTERED)

    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it('falls back to decoding the stored ID token when the stash is empty', async () => {
    const idToken = `x.${Buffer.from(
      JSON.stringify({ sub: 'sub-1', picture: 'https://cdn.acme.test/from-id.png' })
    ).toString('base64url')}.y`
    mockUserFindFirst.mockResolvedValue({ image: null })
    mockAccountFindFirst.mockResolvedValue({ accountId: 'sub-1', idToken })

    await handleAvatarBackfillAfter(ctx(), REGISTERED)

    expect(mockUpdateSet).toHaveBeenCalledWith({ image: 'https://cdn.acme.test/from-id.png' })
  })

  it('only peeks the stash, leaving it for role provisioning to consume', async () => {
    mockUserFindFirst.mockResolvedValue({ image: null })
    stashResolvedClaims(PROVIDER, 'sub-1', {
      picture: 'https://cdn.acme.test/u/1.png',
      groups: ['x'],
    })

    await handleAvatarBackfillAfter(ctx(), REGISTERED)

    const { takeResolvedClaims } = await import('../resolved-claims-stash')
    expect(takeResolvedClaims(PROVIDER, 'sub-1')).toEqual({
      picture: 'https://cdn.acme.test/u/1.png',
      groups: ['x'],
    })
  })

  it('ignores non-callback paths', async () => {
    await handleAvatarBackfillAfter(ctx({ path: '/sign-in/email' }), REGISTERED)
    expect(mockUserFindFirst).not.toHaveBeenCalled()
  })

  it('ignores an unregistered provider', async () => {
    await handleAvatarBackfillAfter(ctx(), new Set<string>())
    expect(mockUserFindFirst).not.toHaveBeenCalled()
  })

  it('does nothing when there is no session user', async () => {
    await handleAvatarBackfillAfter(ctx({ context: { newSession: null } }), REGISTERED)
    expect(mockUserFindFirst).not.toHaveBeenCalled()
  })
})
