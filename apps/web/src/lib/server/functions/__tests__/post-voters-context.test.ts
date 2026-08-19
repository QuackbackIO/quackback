/**
 * post-voters-context server fn: the read side of the portal vote-management
 * tools. Pins the permission boundary — the voters list must gate on
 * post.vote_on_behalf (NOT the admin post.view_private) so a narrowly-scoped
 * vote manager can populate the voters stack + modal — and the createdAt
 * serialization contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
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

const mockGetPostVoters = vi.fn()
vi.mock('@/lib/server/domains/posts/post.voting', () => ({
  getPostVoters: (...args: unknown[]) => mockGetPostVoters(...args),
}))

vi.mock('@/lib/shared/utils', () => ({
  toIsoString: (value: Date | string) =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

const IDX_LIST_VOTERS = 0
let listVotersHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlers.length === 0) await import('../post-voters-context')
  listVotersHandler = handlers[IDX_LIST_VOTERS]
})

describe('listPostVotersForVoteManagerFn', () => {
  it('gates on post.vote_on_behalf (not post.view_private)', async () => {
    mockRequireAuth.mockResolvedValueOnce({})
    mockGetPostVoters.mockResolvedValueOnce([])
    await listVotersHandler({ data: { postId: 'post_1' } })
    expect(mockRequireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.POST_VOTE_ON_BEHALF })
  })

  it('rejects when the actor lacks post.vote_on_behalf (no voters read)', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('FORBIDDEN'))
    await expect(listVotersHandler({ data: { postId: 'post_1' } })).rejects.toThrow('FORBIDDEN')
    expect(mockGetPostVoters).not.toHaveBeenCalled()
  })

  it('serializes each voter createdAt to an ISO string', async () => {
    const created = new Date('2026-01-02T03:04:05.000Z')
    mockRequireAuth.mockResolvedValueOnce({})
    mockGetPostVoters.mockResolvedValueOnce([
      { principalId: 'principal_a', displayName: 'Ada', createdAt: created },
    ])
    const result = (await listVotersHandler({ data: { postId: 'post_1' } })) as Array<{
      principalId: string
      createdAt: string
    }>
    expect(mockGetPostVoters).toHaveBeenCalledWith('post_1')
    expect(result[0]).toEqual({
      principalId: 'principal_a',
      displayName: 'Ada',
      createdAt: '2026-01-02T03:04:05.000Z',
    })
  })
})
