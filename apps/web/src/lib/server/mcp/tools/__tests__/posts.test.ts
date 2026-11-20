import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/server'

const mockUpdatePost = vi.fn()
const mockCreatePost = vi.fn()
vi.mock('@/lib/server/domains/posts/post.service', () => ({
  createPost: (...args: unknown[]) => mockCreatePost(...args),
  updatePost: (...args: unknown[]) => mockUpdatePost(...args),
}))
vi.mock('@/lib/server/domains/posts/post.voting', () => ({
  voteOnPost: vi.fn(),
  addVoteOnBehalf: vi.fn(),
  removeVote: vi.fn(),
  blockedVoteToggle: vi.fn(async () => null),
}))
// No one here is blocked; blocked-person-tools.db.test.ts drives the guard.
vi.mock('@/lib/server/domains/principals/blocking', () => ({
  assertNotBlocked: vi.fn(async () => undefined),
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
    registerTool: (name: string, _c: unknown, handler: Handler) => {
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

describe('create_post MCP tool', () => {
  const portalAuth = {
    ...teamAuth,
    principalId: 'principal_carl',
    name: 'Carl',
    email: 'carl@example.com',
    role: 'user' as const,
  } as unknown as McpAuthContext
  const args = {
    boardId: 'board_1',
    title: 'Dark mode',
    statusId: 'post_status_complete',
    tagIds: ['post_tag_internal'],
  }

  beforeEach(() => {
    mockCreatePost.mockResolvedValue({
      id: 'post_1',
      title: 'Dark mode',
      boardId: 'board_1',
      statusId: 'post_status_open',
      createdAt: '2026-11-20T00:00:00.000Z',
    })
  })

  it("drops a portal user's status and tags, so the post takes the board default and no tags", async () => {
    const result = await collect(portalAuth).get('create_post')!(args)
    expect(result.isError).not.toBe(true)
    const [input] = mockCreatePost.mock.calls[0]
    expect(input).toMatchObject({ boardId: 'board_1', title: 'Dark mode' })
    expect(input.statusId).toBeUndefined()
    expect(input.tagIds).toBeUndefined()
  })

  it("passes a teammate's status and tags through", async () => {
    const result = await collect(teamAuth).get('create_post')!(args)
    expect(result.isError).not.toBe(true)
    expect(mockCreatePost.mock.calls[0][0]).toMatchObject({
      statusId: 'post_status_complete',
      tagIds: ['post_tag_internal'],
    })
  })
})
