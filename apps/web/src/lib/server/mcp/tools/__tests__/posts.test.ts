import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const mockUpdatePost = vi.fn()
vi.mock('@/lib/server/domains/posts/post.service', () => ({
  createPost: vi.fn(),
  updatePost: (...args: unknown[]) => mockUpdatePost(...args),
}))
vi.mock('@/lib/server/domains/posts/post.voting', () => ({
  voteOnPost: vi.fn(),
  addVoteOnBehalf: vi.fn(),
  removeVote: vi.fn(),
}))
vi.mock('@/lib/server/domains/posts/post.merge', () => ({
  mergePost: vi.fn(),
  unmergePost: vi.fn(),
}))
vi.mock('@/lib/server/domains/posts/post.user-actions', () => ({
  softDeletePost: vi.fn(),
  restorePost: vi.fn(),
}))
vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  getActivityForPost: vi.fn(),
  createActivity: vi.fn(),
}))
vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: async () => new Set(),
}))

import { registerPostTools, resolveOwnerPrincipalId } from '../posts'
import type { McpAuthContext } from '../../types'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

function collect(auth: McpAuthContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const fakeServer = {
    tool: (name: string, _d: string, _s: unknown, _a: unknown, handler: Handler) => {
      handlers.set(name, handler)
    },
  }
  registerPostTools(fakeServer as never, auth)
  return handlers
}

const teamAuth = {
  principalId: 'principal_james',
  userId: 'user_1',
  name: 'James',
  email: 'james@quackback.io',
  role: 'admin' as const,
  authMethod: 'oauth' as const,
  scopes: ['write:feedback'],
} as unknown as McpAuthContext

beforeEach(() => vi.clearAllMocks())

describe('resolveOwnerPrincipalId', () => {
  it('maps "me" to the authenticated teammate and leaves TypeIDs and null alone', () => {
    expect(resolveOwnerPrincipalId('me', 'principal_james' as never)).toBe('principal_james')
    expect(resolveOwnerPrincipalId('principal_other' as never, 'principal_james' as never)).toBe(
      'principal_other'
    )
    expect(resolveOwnerPrincipalId(null, 'principal_james' as never)).toBeNull()
    expect(resolveOwnerPrincipalId(undefined, 'principal_james' as never)).toBeUndefined()
  })
})

describe('triage_post MCP tool', () => {
  it('assigns the authenticated teammate when ownerPrincipalId is "me"', async () => {
    mockUpdatePost.mockResolvedValue({
      id: 'post_1',
      title: 'Dark mode',
      statusId: 'post_status_1',
      ownerPrincipalId: 'principal_james',
      updatedAt: '2026-09-07T00:00:00.000Z',
    })
    await collect(teamAuth).get('triage_post')!({
      postId: 'post_1',
      ownerPrincipalId: 'me',
    })
    expect(mockUpdatePost).toHaveBeenCalledWith(
      'post_1',
      expect.objectContaining({ ownerPrincipalId: 'principal_james' }),
      expect.objectContaining({ principalId: 'principal_james' })
    )
  })
})
