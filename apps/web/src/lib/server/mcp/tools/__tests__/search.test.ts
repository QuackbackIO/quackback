import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const mockListInboxPosts = vi.fn()
vi.mock('@/lib/server/domains/posts/post.inbox', () => ({
  listInboxPosts: (...args: unknown[]) => mockListInboxPosts(...args),
}))
vi.mock('@/lib/server/domains/posts/post.query', () => ({
  getPostWithDetails: vi.fn(),
  getCommentsWithReplies: vi.fn(),
}))
vi.mock('@/lib/server/domains/posts/post.merge', () => ({
  getMergedPosts: vi.fn(),
}))
vi.mock('@/lib/server/domains/changelog/changelog.service', () => ({
  getChangelogById: vi.fn(),
}))
vi.mock('@/lib/server/domains/changelog/changelog.query', () => ({
  listChangelogs: vi.fn(),
}))
vi.mock('@/lib/server/domains/help-center/help-center.service', () => ({
  listArticles: vi.fn(),
  getArticleById: vi.fn(),
  getCategoryById: vi.fn(),
}))

import { registerSearchTools, resolvePostAuthorFilter } from '../search'
import type { McpAuthContext } from '../../types'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

function collect(auth: McpAuthContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const fakeServer = {
    tool: (name: string, _d: string, _s: unknown, _a: unknown, handler: Handler) => {
      handlers.set(name, handler)
    },
  }
  registerSearchTools(fakeServer as never, auth)
  return handlers
}

const teamAuth = {
  principalId: 'principal_james',
  userId: 'user_1',
  name: 'James',
  email: 'james@quackback.io',
  role: 'admin' as const,
  authMethod: 'oauth' as const,
  scopes: ['read:feedback'],
} as unknown as McpAuthContext

beforeEach(() => {
  vi.clearAllMocks()
  mockListInboxPosts.mockResolvedValue({ items: [], nextCursor: null, hasMore: false })
})

describe('resolvePostAuthorFilter', () => {
  it('maps "me" on principal id or email to the authenticated teammate', () => {
    expect(
      resolvePostAuthorFilter({ authorPrincipalId: 'me' }, { principalId: 'principal_james' })
    ).toEqual({ authorId: 'principal_james' })
    expect(
      resolvePostAuthorFilter({ authorEmail: 'me' }, { principalId: 'principal_james' })
    ).toEqual({ authorId: 'principal_james' })
  })

  it('passes through an explicit TypeID or email', () => {
    expect(
      resolvePostAuthorFilter(
        { authorPrincipalId: 'principal_other' },
        { principalId: 'principal_james' }
      )
    ).toEqual({ authorId: 'principal_other' })
    expect(
      resolvePostAuthorFilter({ authorEmail: 'ada@acme.com' }, { principalId: 'principal_james' })
    ).toEqual({ authorEmail: 'ada@acme.com' })
  })
})

describe('search MCP tool', () => {
  it('filters posts to the authenticated teammate when authorPrincipalId is "me"', async () => {
    await collect(teamAuth).get('search')!({
      entity: 'posts',
      authorPrincipalId: 'me',
      sort: 'newest',
      showDeleted: false,
      limit: 20,
    })
    expect(mockListInboxPosts).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: 'principal_james' })
    )
  })

  it('filters posts by author email when authorEmail is set', async () => {
    await collect(teamAuth).get('search')!({
      entity: 'posts',
      authorEmail: 'ada@acme.com',
      sort: 'newest',
      showDeleted: false,
      limit: 20,
    })
    expect(mockListInboxPosts).toHaveBeenCalledWith(
      expect.objectContaining({ authorEmail: 'ada@acme.com' })
    )
  })
})
