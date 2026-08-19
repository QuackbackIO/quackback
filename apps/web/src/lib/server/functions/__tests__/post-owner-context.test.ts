/**
 * post-owner-context server fns: the read side of the owner (assignee) control.
 * Pins the permission boundary — both fns must gate on post.set_owner so a
 * narrowly-scoped role can populate the picker and read the current owner
 * without holding the broader member.view — and the owner-resolution contract
 * (roster mapping, unassigned -> null, former member -> null).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

// --- Capture handlers registered via createServerFn ---
type AnyHandler = (args?: { data: Record<string, unknown> }) => Promise<unknown>
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

// --- Mocks ---
const mockRequireAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

const mockListTeamMembers = vi.fn()
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  listTeamMembers: () => mockListTeamMembers(),
}))

const mockLimit = vi.fn()
vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockLimit(...args),
        }),
      }),
    }),
  },
  eq: vi.fn(),
  posts: { id: 'id', ownerPrincipalId: 'ownerPrincipalId' },
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

// Registration order in post-owner-context.ts.
const IDX_LIST_CANDIDATES = 0
const IDX_GET_OWNER = 1

let listOwnerCandidatesHandler: AnyHandler
let getPostOwnerHandler: AnyHandler

const MEMBERS = [
  { id: 'principal_a' as PrincipalId, name: 'Ada', email: 'ada@x.io', image: 'https://x/a.png' },
  { id: 'principal_b' as PrincipalId, name: null, email: 'b@x.io', image: null },
]

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlers.length === 0) await import('../post-owner-context')
  listOwnerCandidatesHandler = handlers[IDX_LIST_CANDIDATES]
  getPostOwnerHandler = handlers[IDX_GET_OWNER]
})

describe('listOwnerCandidatesFn', () => {
  it('gates on post.set_owner', async () => {
    mockRequireAuth.mockResolvedValueOnce({})
    mockListTeamMembers.mockResolvedValueOnce([])
    await listOwnerCandidatesHandler()
    expect(mockRequireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.POST_SET_OWNER })
  })

  it('rejects when the actor lacks post.set_owner', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('FORBIDDEN'))
    await expect(listOwnerCandidatesHandler()).rejects.toThrow('FORBIDDEN')
    expect(mockListTeamMembers).not.toHaveBeenCalled()
  })

  it('maps the roster to owner refs, falling back to email for a nameless member', async () => {
    mockRequireAuth.mockResolvedValueOnce({})
    mockListTeamMembers.mockResolvedValueOnce(MEMBERS)
    const result = await listOwnerCandidatesHandler()
    expect(result).toEqual([
      { principalId: 'principal_a', name: 'Ada', avatarUrl: 'https://x/a.png' },
      { principalId: 'principal_b', name: 'b@x.io', avatarUrl: null },
    ])
  })
})

describe('getPostOwnerFn', () => {
  it('gates on post.set_owner and rejects the denied actor', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('FORBIDDEN'))
    await expect(getPostOwnerHandler({ data: { postId: 'post_1' } })).rejects.toThrow('FORBIDDEN')
    expect(mockRequireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.POST_SET_OWNER })
    expect(mockLimit).not.toHaveBeenCalled()
  })

  it('resolves the current owner from the roster', async () => {
    mockRequireAuth.mockResolvedValueOnce({})
    mockLimit.mockResolvedValueOnce([{ ownerPrincipalId: 'principal_a' }])
    mockListTeamMembers.mockResolvedValueOnce(MEMBERS)
    const result = await getPostOwnerHandler({ data: { postId: 'post_1' } })
    expect(result).toEqual({
      principalId: 'principal_a',
      name: 'Ada',
      avatarUrl: 'https://x/a.png',
    })
  })

  it('returns null when the post is unassigned (no roster read)', async () => {
    mockRequireAuth.mockResolvedValueOnce({})
    mockLimit.mockResolvedValueOnce([{ ownerPrincipalId: null }])
    const result = await getPostOwnerHandler({ data: { postId: 'post_1' } })
    expect(result).toBeNull()
    expect(mockListTeamMembers).not.toHaveBeenCalled()
  })

  it('returns null when the owner is no longer a team member', async () => {
    mockRequireAuth.mockResolvedValueOnce({})
    mockLimit.mockResolvedValueOnce([{ ownerPrincipalId: 'principal_gone' }])
    mockListTeamMembers.mockResolvedValueOnce(MEMBERS)
    const result = await getPostOwnerHandler({ data: { postId: 'post_1' } })
    expect(result).toBeNull()
  })
})
