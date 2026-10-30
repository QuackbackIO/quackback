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

const subs = vi.hoisted(() => ({
  listPostSubscribers: vi.fn(),
  addPostSubscriber: vi.fn(),
  removePostSubscriber: vi.fn(),
  followPost: vi.fn(),
  unfollowPost: vi.fn(),
}))
vi.mock('@/lib/server/domains/posts/post.subscribers', () => subs)

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

describe('post subscriber MCP tools', () => {
  const readAuth = { ...teamAuth, scopes: ['read:feedback'] } as unknown as McpAuthContext
  const parse = (r: CallToolResult) => JSON.parse((r.content[0] as { text: string }).text)

  it('list_post_subscribers returns who follows, why and how, marking customer names', async () => {
    subs.listPostSubscribers.mockResolvedValue([
      {
        principalId: 'principal_ada',
        displayName: 'Ada',
        email: 'ada@example.com',
        avatarUrl: null,
        isTeamMember: false,
        reason: 'added',
        level: 'status_only',
        canView: true,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    ])
    const out = await collect(readAuth).get('list_post_subscribers')!({ postId: 'post_1' })
    const body = parse(out)
    expect(body.subscribers).toEqual([
      {
        principalId: 'principal_ada',
        displayName: 'Ada',
        email: 'ada@example.com',
        isTeamMember: false,
        reason: 'added',
        level: 'status_only',
        canView: true,
      },
    ])
    expect(JSON.stringify(body.untrusted)).toContain('subscribers[0].displayName')
  })

  it('subscribe_post subscribes and unsubscribes someone else as the caller', async () => {
    subs.addPostSubscriber.mockResolvedValue({ added: true })
    subs.removePostSubscriber.mockResolvedValue({ removed: true })
    const handlers = collect(teamAuth)
    const added = parse(
      await handlers.get('subscribe_post')!({
        postId: 'post_1',
        principalId: 'principal_ada',
        action: 'add',
        level: 'status_only',
      })
    )
    expect(added).toMatchObject({ principalId: 'principal_ada', subscribed: true, changed: true })
    expect(subs.addPostSubscriber).toHaveBeenCalledWith(
      'post_1',
      'principal_ada',
      expect.objectContaining({ principalId: 'principal_james' }),
      { level: 'status_only' }
    )
    await handlers.get('subscribe_post')!({
      postId: 'post_1',
      principalId: 'principal_ada',
      action: 'remove',
    })
    expect(subs.removePostSubscriber).toHaveBeenCalledWith(
      'post_1',
      'principal_ada',
      expect.anything()
    )
    expect(subs.followPost).not.toHaveBeenCalled()
  })

  it('subscribe_post without a principal follows or unfollows the post for the caller', async () => {
    subs.followPost.mockResolvedValue({ added: false })
    subs.unfollowPost.mockResolvedValue({ removed: true })
    const handlers = collect(teamAuth)
    expect(
      parse(await handlers.get('subscribe_post')!({ postId: 'post_1', action: 'add' }))
    ).toMatchObject({ principalId: 'principal_james', subscribed: true, changed: false })
    await handlers.get('subscribe_post')!({ postId: 'post_1', action: 'remove' })
    expect(subs.unfollowPost).toHaveBeenCalledWith(
      'post_1',
      expect.objectContaining({ principalId: 'principal_james' })
    )
    expect(subs.addPostSubscriber).not.toHaveBeenCalled()
  })

  it('refuses a self follow from an API key, which has no subscription of its own', async () => {
    const keyAuth = { ...teamAuth, userId: undefined } as unknown as McpAuthContext
    const out = await collect(keyAuth).get('subscribe_post')!({ postId: 'post_1', action: 'add' })
    expect(out.isError).toBe(true)
    expect((out.content[0] as { text: string }).text).toContain('PERSON_REQUIRED')
    expect(subs.followPost).not.toHaveBeenCalled()
  })
})
