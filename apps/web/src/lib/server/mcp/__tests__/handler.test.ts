import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApiKey } from '@/lib/server/domains/api-keys'
import type { PrincipalId, ApiKeyId, UserId } from '@quackback/ids'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/lib/server/domains/api-keys', () => ({
  verifyApiKey: vi.fn(),
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn(),
}))

const mockFindFirst = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
    },
  },
  principal: { id: 'id', userId: 'user_id' },
  eq: vi.fn((_a: unknown, _b: unknown) => 'eq-condition'),
}))

// Mock getTypeIdPrefix from @quackback/ids — extract prefix from underscore-separated IDs
vi.mock('@quackback/ids', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getTypeIdPrefix: vi.fn((id: string) => {
      const underscoreIndex = id.indexOf('_')
      if (underscoreIndex === -1) throw new Error(`Invalid TypeID: ${id}`)
      return id.substring(0, underscoreIndex)
    }),
  }
})

// Mock rate limiting to always allow
vi.mock('@/lib/server/domains/api/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

// Mock settings service so getDeveloperConfig doesn't hit the real DB
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getDeveloperConfig: vi
    .fn()
    .mockResolvedValue({ mcpEnabled: true, mcpPortalAccessEnabled: false }),
}))

// Mock config so baseUrl is available (used in WWW-Authenticate header)
vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://example.com' },
}))

// Mock all domain services called by tools/resources
vi.mock('@/lib/server/domains/posts/post.query', () => ({
  listInboxPosts: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
  getPostWithDetails: vi.fn().mockResolvedValue({
    id: 'post_test',
    title: 'Test Post',
    content: 'Test content',
    voteCount: 5,
    commentCount: 0,
    boardId: 'board_test',
    board: { id: 'board_test', name: 'Bugs', slug: 'bugs' },
    statusId: 'status_test',
    authorName: 'Jane',
    authorEmail: 'jane@example.com',
    ownerPrincipalId: null,
    tags: [],
    roadmapIds: [],
    pinnedComment: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  }),
  getCommentsWithReplies: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/server/domains/posts/post.service', () => ({
  createPost: vi.fn().mockResolvedValue({
    id: 'post_new',
    title: 'New Post',
    boardId: 'board_test',
    statusId: 'status_test',
    createdAt: new Date('2026-01-01'),
  }),
  updatePost: vi.fn().mockResolvedValue({
    id: 'post_test',
    title: 'Test Post',
    statusId: 'status_updated',
    ownerPrincipalId: null,
    updatedAt: new Date('2026-01-01'),
  }),
}))

vi.mock('@/lib/server/domains/posts/post.voting', () => ({
  voteOnPost: vi.fn().mockResolvedValue({ voted: true, voteCount: 6 }),
}))

vi.mock('@/lib/server/domains/posts/post.merge', () => ({
  mergePost: vi.fn().mockResolvedValue({
    canonicalPost: { id: 'post_canon', voteCount: 10 },
    duplicatePost: { id: 'post_dup' },
  }),
  unmergePost: vi.fn().mockResolvedValue({
    post: { id: 'post_dup' },
    canonicalPost: { id: 'post_canon', voteCount: 5 },
  }),
}))

vi.mock('@/lib/server/domains/comments/comment.service', () => ({
  createComment: vi.fn().mockResolvedValue({
    comment: {
      id: 'comment_new',
      postId: 'post_test',
      content: 'Great feedback!',
      parentId: null,
      principalId: 'principal_test',
      isTeamMember: true,
      createdAt: new Date('2026-01-01'),
    },
    post: { id: 'post_test', title: 'Test Post', boardSlug: 'bugs' },
  }),
  updateComment: vi.fn().mockResolvedValue({
    id: 'comment_new',
    postId: 'post_test',
    content: 'Updated comment',
    updatedAt: new Date('2026-01-02'),
  }),
  deleteComment: vi.fn().mockResolvedValue(undefined),
  addReaction: vi.fn().mockResolvedValue({
    added: true,
    reactions: [{ emoji: '👍', count: 1, hasReacted: true }],
  }),
  removeReaction: vi.fn().mockResolvedValue({
    added: false,
    reactions: [],
  }),
}))

vi.mock('@/lib/server/domains/changelog/changelog.service', () => ({
  createChangelog: vi.fn().mockResolvedValue({
    id: 'changelog_new',
    title: 'v1.0',
    status: 'draft',
    publishedAt: null,
    createdAt: new Date('2026-01-01'),
  }),
  updateChangelog: vi.fn().mockResolvedValue({
    id: 'changelog_01test',
    title: 'Updated Release',
    status: 'published',
    publishedAt: new Date('2026-01-15'),
    updatedAt: new Date('2026-01-20'),
  }),
  deleteChangelog: vi.fn().mockResolvedValue(undefined),
  listChangelogs: vi.fn().mockResolvedValue({
    items: [
      {
        id: 'changelog_01test',
        title: 'v1.0 Release',
        content: 'New features and improvements.',
        status: 'published',
        author: { name: 'Jane Admin' },
        linkedPosts: [{ id: 'post_test', title: 'Test Post', voteCount: 5 }],
        publishedAt: new Date('2026-01-15'),
        createdAt: new Date('2026-01-10'),
      },
    ],
    nextCursor: null,
    hasMore: false,
  }),
  getChangelogById: vi.fn().mockResolvedValue({
    id: 'changelog_01test',
    title: 'v1.0 Release',
    content: 'New features and improvements.',
    status: 'published',
    author: { name: 'Jane Admin' },
    linkedPosts: [{ id: 'post_test', title: 'Test Post', voteCount: 5, status: 'shipped' }],
    publishedAt: new Date('2026-01-15'),
    createdAt: new Date('2026-01-10'),
    updatedAt: new Date('2026-01-15'),
  }),
}))

vi.mock('@/lib/server/domains/boards/board.service', () => ({
  listBoards: vi
    .fn()
    .mockResolvedValue([{ id: 'board_test', name: 'Bugs', slug: 'bugs', description: '' }]),
}))

vi.mock('@/lib/server/domains/statuses/status.service', () => ({
  listStatuses: vi
    .fn()
    .mockResolvedValue([{ id: 'status_test', name: 'Open', slug: 'open', color: '#22c55e' }]),
}))

vi.mock('@/lib/server/domains/tags/tag.service', () => ({
  listTags: vi.fn().mockResolvedValue([{ id: 'tag_test', name: 'Bug', color: '#ef4444' }]),
}))

vi.mock('@/lib/server/domains/roadmaps/roadmap.service', () => ({
  listRoadmaps: vi
    .fn()
    .mockResolvedValue([{ id: 'roadmap_test', name: 'Q1 2026', slug: 'q1-2026' }]),
  addPostToRoadmap: vi.fn().mockResolvedValue(undefined),
  removePostFromRoadmap: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  listTeamMembers: vi
    .fn()
    .mockResolvedValue([{ id: 'principal_test', name: 'Jane', role: 'admin' }]),
}))

// ── Test Constants ─────────────────────────────────────────────────────────────

const MOCK_MEMBER_ID = 'principal_01h455vb4pex5vsknk084sn02r' as PrincipalId
const MOCK_USER_ID = 'user_01h455vb4pex5vsknk084sn02s' as UserId

const MOCK_API_KEY: ApiKey = {
  id: 'apikey_01h455vb4pex5vsknk084sn02q' as ApiKeyId,
  name: 'Test Key',
  keyPrefix: 'qb_test',
  principalId: MOCK_MEMBER_ID,
  createdById: MOCK_MEMBER_ID,
  createdAt: new Date(),
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
}

const MOCK_MEMBER_RECORD = {
  id: MOCK_MEMBER_ID,
  role: 'admin',
  user: {
    id: MOCK_USER_ID,
    name: 'Jane Admin',
    email: 'jane@example.com',
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function jsonRpcRequest(method: string, params?: Record<string, unknown>, id?: number) {
  return {
    jsonrpc: '2.0',
    id: id ?? 1,
    method,
    params: params ?? {},
  }
}

function mcpRequest(body: unknown, apiKey = 'qb_valid_key'): Request {
  return new Request('https://example.com/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
}

async function setupValidAuth() {
  const { verifyApiKey } = await import('@/lib/server/domains/api-keys')
  vi.mocked(verifyApiKey).mockResolvedValue(MOCK_API_KEY)
  mockFindFirst.mockResolvedValue(MOCK_MEMBER_RECORD)
}

/** Initialize an MCP session and re-setup auth for the next call. */
async function initializeSession() {
  const { handleMcpRequest } = await import('../handler')
  await handleMcpRequest(
    mcpRequest(
      jsonRpcRequest('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      })
    )
  )
  await setupValidAuth()
  return handleMcpRequest
}

/** Build a request with an OAuth-style bearer token (non-qb_ prefix). */
function oauthRequest(body: unknown, token = 'oauth_test_token_abc123'): Request {
  return new Request('https://example.com/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

/** Set up mocks for a valid OAuth JWT verification. */
async function setupValidOAuth(overrides?: { role?: string; scopes?: string[] }) {
  const role = overrides?.role ?? 'admin'
  const { verifyAccessToken } = await import('better-auth/oauth2')
  vi.mocked(verifyAccessToken).mockResolvedValue({
    sub: MOCK_USER_ID,
    principalId: MOCK_MEMBER_ID,
    role,
    scope: (overrides?.scopes ?? ['read:feedback', 'write:feedback', 'write:changelog']).join(' '),
    name: 'Jane Admin',
    email: 'jane@example.com',
  })
  // resolveOAuthContext re-reads the principal's current role from DB
  mockFindFirst.mockResolvedValue({ role })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('MCP HTTP Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===========================================================================
  // Auth Flow
  // ===========================================================================

  describe('Authentication', () => {
    it('should return 401 with WWW-Authenticate when no Authorization header is provided', async () => {
      const { handleMcpRequest } = await import('../handler')

      const request = new Request('https://example.com/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonRpcRequest('initialize')),
      })

      const response = await handleMcpRequest(request)
      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate')).toContain('resource_metadata=')
    })

    it('should return 401 when API key is invalid', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys')
      vi.mocked(verifyApiKey).mockResolvedValue(null)

      const { handleMcpRequest } = await import('../handler')
      const response = await handleMcpRequest(mcpRequest(jsonRpcRequest('initialize'), 'qb_bad'))

      expect(response.status).toBe(401)
    })

    it('should return 403 when member is a portal user (not team)', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys')
      vi.mocked(verifyApiKey).mockResolvedValue(MOCK_API_KEY)
      // Return role: 'user' for the role lookup in withApiKeyAuth
      mockFindFirst.mockResolvedValue({ role: 'user' })

      const { handleMcpRequest } = await import('../handler')
      const response = await handleMcpRequest(mcpRequest(jsonRpcRequest('initialize')))

      expect(response.status).toBe(403)
    })

    it('should return 401 when member record not found', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys')
      vi.mocked(verifyApiKey).mockResolvedValue(MOCK_API_KEY)
      // First call for role lookup in withApiKeyAuth → admin
      // Second call for full member record → null
      mockFindFirst.mockResolvedValueOnce({ role: 'admin' }).mockResolvedValueOnce(null)

      const { handleMcpRequest } = await import('../handler')
      const response = await handleMcpRequest(mcpRequest(jsonRpcRequest('initialize')))

      expect(response.status).toBe(401)
      const body = (await response.json()) as { error: string }
      expect(body.error).toBe('Principal not found')
    })

    it('should succeed with valid API key and team member', async () => {
      await setupValidAuth()

      const { handleMcpRequest } = await import('../handler')
      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
          })
        )
      )

      expect(response.status).toBe(200)
    })

    it('should succeed with valid OAuth token', async () => {
      await setupValidOAuth()

      const { handleMcpRequest } = await import('../handler')
      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
          })
        )
      )

      expect(response.status).toBe(200)
    })

    it('should return 401 for expired OAuth token', async () => {
      const { verifyAccessToken } = await import('better-auth/oauth2')
      vi.mocked(verifyAccessToken).mockRejectedValue(new Error('token expired'))

      const { handleMcpRequest } = await import('../handler')
      const response = await handleMcpRequest(oauthRequest(jsonRpcRequest('initialize')))

      expect(response.status).toBe(401)
    })

    it('should return 401 for invalid OAuth token', async () => {
      const { verifyAccessToken } = await import('better-auth/oauth2')
      vi.mocked(verifyAccessToken).mockRejectedValue(new Error('token invalid'))

      const { handleMcpRequest } = await import('../handler')
      const response = await handleMcpRequest(oauthRequest(jsonRpcRequest('initialize')))

      expect(response.status).toBe(401)
    })

    it('should return 403 for OAuth portal user when portal access disabled', async () => {
      await setupValidOAuth({ role: 'user' })

      const { handleMcpRequest } = await import('../handler')
      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
          })
        )
      )

      expect(response.status).toBe(403)
    })

    it('should succeed for OAuth portal user when portal access enabled', async () => {
      const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })
      await setupValidOAuth({ role: 'user' })

      const { handleMcpRequest } = await import('../handler')
      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
          })
        )
      )

      expect(response.status).toBe(200)
    })
  })

  // ===========================================================================
  // JSON-RPC Message Handling
  // ===========================================================================

  describe('JSON-RPC Message Handling', () => {
    beforeEach(async () => {
      await setupValidAuth()
    })

    it('should handle initialize request', async () => {
      const { handleMcpRequest } = await import('../handler')

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { serverInfo: { name: string }; capabilities: { tools: unknown } }
      }
      expect(body.result.serverInfo.name).toBe('quackback')
      expect(body.result.capabilities.tools).toBeDefined()
    })

    it('should handle tools/list request', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(mcpRequest(jsonRpcRequest('tools/list')))

      expect(response.status).toBe(200)
      const body = (await response.json()) as { result: { tools: Array<{ name: string }> } }
      const toolNames = body.result.tools.map((t) => t.name)
      expect(toolNames).toContain('search')
      expect(toolNames).toContain('get_details')
      expect(toolNames).toContain('triage_post')
      expect(toolNames).toContain('vote_post')
      expect(toolNames).toContain('add_comment')
      expect(toolNames).toContain('create_post')
      expect(toolNames).toContain('create_changelog')
      expect(toolNames).toContain('update_changelog')
      expect(toolNames).toContain('delete_changelog')
      expect(toolNames).toContain('update_comment')
      expect(toolNames).toContain('delete_comment')
      expect(toolNames).toContain('react_to_comment')
      expect(toolNames).toContain('manage_roadmap_post')
      expect(toolNames).toContain('merge_post')
      expect(toolNames).toContain('unmerge_post')
      expect(toolNames).toHaveLength(15)
    })

    it('should handle resources/list request', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(mcpRequest(jsonRpcRequest('resources/list')))

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { resources: Array<{ uri: string; name: string }> }
      }
      const uris = body.result.resources.map((r) => r.uri)
      expect(uris).toContain('quackback://boards')
      expect(uris).toContain('quackback://statuses')
      expect(uris).toContain('quackback://tags')
      expect(uris).toContain('quackback://roadmaps')
      expect(uris).toContain('quackback://members')
      expect(uris).toHaveLength(5)
    })

    // ── search tool (posts) ─────────────────────────────────────────────────

    it('should handle tools/call for search (posts, default)', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'search',
            arguments: { query: 'bug', limit: 10 },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ type: string; text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.posts).toBeDefined()
      expect(text.nextCursor).toBeNull()
      expect(text.hasMore).toBe(false)
    })

    // ── search tool (changelogs) ────────────────────────────────────────────

    it('should handle tools/call for search (changelogs)', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'search',
            arguments: { entity: 'changelogs', status: 'published' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ type: string; text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.changelogs).toBeDefined()
      expect(text.changelogs).toHaveLength(1)
      expect(text.changelogs[0].title).toBe('v1.0 Release')
      expect(text.hasMore).toBe(false)
    })

    it('should handle tools/call for create_post without content', async () => {
      const { createPost } = await import('@/lib/server/domains/posts/post.service')
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'create_post',
            arguments: { boardId: 'board_test', title: 'Title only post' },
          })
        )
      )

      expect(response.status).toBe(200)
      expect(vi.mocked(createPost)).toHaveBeenCalledWith(
        expect.objectContaining({
          boardId: 'board_test',
          title: 'Title only post',
          content: '',
        }),
        expect.any(Object)
      )
    })

    // ── get_details tool (post) ─────────────────────────────────────────────

    it('should handle tools/call for get_details with post TypeID', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'get_details',
            arguments: { id: 'post_test' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ type: string; text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.id).toBe('post_test')
      expect(text.title).toBe('Test Post')
      expect(text.comments).toEqual([])
    })

    // ── get_details tool (changelog) ────────────────────────────────────────

    it('should handle tools/call for get_details with changelog TypeID', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'get_details',
            arguments: { id: 'changelog_01test' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ type: string; text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.id).toBe('changelog_01test')
      expect(text.title).toBe('v1.0 Release')
      expect(text.status).toBe('published')
      expect(text.linkedPosts).toHaveLength(1)
    })

    // ── get_details tool (unsupported prefix) ───────────────────────────────

    it('should return error for get_details with unsupported TypeID prefix', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'get_details',
            arguments: { id: 'board_01test' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { isError: boolean; content: Array<{ text: string }> }
      }
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('Unsupported entity type')
    })

    // ── triage_post tool ──────────────────────────────────────────────────

    it('should handle tools/call for triage_post', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'triage_post',
            arguments: { postId: 'post_test', statusId: 'status_updated' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.id).toBe('post_test')
      expect(text.statusId).toBe('status_updated')
    })

    // ── vote_post tool ──────────────────────────────────────────────────

    it('should handle tools/call for vote_post', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'vote_post',
            arguments: { postId: 'post_test' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.voted).toBe(true)
      expect(text.voteCount).toBe(6)
    })

    // ── add_comment tool ────────────────────────────────────────────────

    it('should handle tools/call for add_comment', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'add_comment',
            arguments: { postId: 'post_test', content: 'Great feedback!' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.id).toBe('comment_new')
      expect(text.content).toBe('Great feedback!')
    })

    // ── update_comment tool ─────────────────────────────────────────────

    it('should handle tools/call for update_comment', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'update_comment',
            arguments: { commentId: 'comment_new', content: 'Updated comment' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.id).toBe('comment_new')
      expect(text.content).toBe('Updated comment')
    })

    // ── delete_comment tool ─────────────────────────────────────────────

    it('should handle tools/call for delete_comment', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'delete_comment',
            arguments: { commentId: 'comment_new' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.deleted).toBe(true)
      expect(text.commentId).toBe('comment_new')
    })

    // ── react_to_comment tool ───────────────────────────────────────────

    it('should handle tools/call for react_to_comment', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'react_to_comment',
            arguments: { action: 'add', commentId: 'comment_new', emoji: '👍' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.added).toBe(true)
      expect(text.emoji).toBe('👍')
    })

    // ── manage_roadmap_post tool ────────────────────────────────────────

    it('should handle tools/call for manage_roadmap_post', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'manage_roadmap_post',
            arguments: { action: 'add', roadmapId: 'roadmap_test', postId: 'post_test' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.action).toBe('add')
      expect(text.postId).toBe('post_test')
      expect(text.roadmapId).toBe('roadmap_test')
    })

    // ── merge_post tool ─────────────────────────────────────────────────

    it('should handle tools/call for merge_post', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'merge_post',
            arguments: { duplicatePostId: 'post_dup', canonicalPostId: 'post_canon' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.canonicalPost.id).toBe('post_canon')
      expect(text.duplicatePost.id).toBe('post_dup')
    })

    // ── unmerge_post tool ───────────────────────────────────────────────

    it('should handle tools/call for unmerge_post', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'unmerge_post',
            arguments: { postId: 'post_dup' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.post.id).toBe('post_dup')
      expect(text.canonicalPost.id).toBe('post_canon')
    })

    // ── create_changelog tool ───────────────────────────────────────────

    it('should handle tools/call for create_changelog', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'create_changelog',
            arguments: { title: 'v1.0', content: 'New features' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.id).toBe('changelog_new')
      expect(text.status).toBe('draft')
    })

    // ── update_changelog tool ───────────────────────────────────────────

    it('should handle tools/call for update_changelog', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'update_changelog',
            arguments: { changelogId: 'changelog_01test', title: 'Updated Release', publish: true },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.id).toBe('changelog_01test')
      expect(text.status).toBe('published')
    })

    // ── delete_changelog tool ───────────────────────────────────────────

    it('should handle tools/call for delete_changelog', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'delete_changelog',
            arguments: { changelogId: 'changelog_01test' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.deleted).toBe(true)
      expect(text.changelogId).toBe('changelog_01test')
    })

    it('should handle resources/read for boards', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('resources/read', {
            uri: 'quackback://boards',
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { contents: Array<{ text: string }> }
      }
      const boards = JSON.parse(body.result.contents[0].text)
      expect(boards).toHaveLength(1)
      expect(boards[0].name).toBe('Bugs')
    })
  })

  // ===========================================================================
  // Error Responses
  // ===========================================================================

  describe('Error Responses', () => {
    beforeEach(async () => {
      await setupValidAuth()
    })

    it('should return tool error for domain NotFoundError', async () => {
      const { getPostWithDetails } = await import('@/lib/server/domains/posts/post.query')
      vi.mocked(getPostWithDetails).mockRejectedValueOnce(new Error('Post not found'))

      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'get_details',
            arguments: { id: 'post_nonexistent' },
          })
        )
      )

      expect(response.status).toBe(200) // JSON-RPC always returns 200
      const body = (await response.json()) as {
        result: { isError: boolean; content: Array<{ text: string }> }
      }
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('Post not found')
    })

    it('should handle JSON-RPC method not found', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(mcpRequest(jsonRpcRequest('nonexistent/method')))

      expect(response.status).toBe(200)
      const body = (await response.json()) as { error: { code: number } }
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe(-32601) // Method not found
    })

    it('should handle tool call with unknown tool name', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'nonexistent_tool',
            arguments: {},
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result?: { isError: boolean }
        error?: { code: number }
      }
      // MCP SDK returns either a tool error or a JSON-RPC error for unknown tools
      expect(body.error || body.result?.isError).toBeTruthy()
    })
  })

  // ===========================================================================
  // Scope Enforcement
  // ===========================================================================

  describe('Scope Enforcement', () => {
    /** Initialize an OAuth session with limited scopes, return handleMcpRequest. */
    async function initializeOAuthSession(scopes: string[]) {
      await setupValidOAuth({ scopes })
      const { handleMcpRequest } = await import('../handler')
      await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
          })
        )
      )
      // Re-setup for next call
      await setupValidOAuth({ scopes })
      return handleMcpRequest
    }

    it('should deny search when read:feedback scope missing', async () => {
      const handleMcpRequest = await initializeOAuthSession(['write:feedback'])

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'search',
            arguments: { query: 'test' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { isError: boolean; content: Array<{ text: string }> }
      }
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('read:feedback')
    })

    it('should deny create_post when write:feedback scope missing', async () => {
      const handleMcpRequest = await initializeOAuthSession(['read:feedback'])

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'create_post',
            arguments: { boardId: 'board_test', title: 'Test' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { isError: boolean; content: Array<{ text: string }> }
      }
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('write:feedback')
    })

    it('should deny create_changelog when write:changelog scope missing', async () => {
      const handleMcpRequest = await initializeOAuthSession(['read:feedback', 'write:feedback'])

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'create_changelog',
            arguments: { title: 'v1', content: 'New stuff' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { isError: boolean; content: Array<{ text: string }> }
      }
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('write:changelog')
    })

    it('should allow search with read:feedback scope', async () => {
      const handleMcpRequest = await initializeOAuthSession(['read:feedback'])

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'search',
            arguments: { query: 'test' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      expect(body.result.content[0].text).toContain('posts')
    })

    it('should deny triage_post for OAuth portal user (role enforcement)', async () => {
      const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })
      const handleMcpRequest = await initializeOAuthSession([
        'read:feedback',
        'write:feedback',
        'write:changelog',
      ])
      // Override the OAuth mock to return role: 'user' for the tool call
      await setupValidOAuth({
        role: 'user',
        scopes: ['read:feedback', 'write:feedback', 'write:changelog'],
      })
      // Also need portal access enabled for the tool call auth
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'triage_post',
            arguments: { postId: 'post_test', statusId: 'status_updated' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { isError: boolean; content: Array<{ text: string }> }
      }
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('team member')
    })

    it('should grant all scopes to API key users', async () => {
      await setupValidAuth()
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'create_changelog',
            arguments: { title: 'v1', content: 'New stuff' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      // Should succeed (not isError) since API keys get all scopes
      expect(JSON.parse(body.result.content[0].text).id).toBe('changelog_new')
    })
  })

  // ===========================================================================
  // Stateless Behavior
  // ===========================================================================

  describe('Stateless Behavior', () => {
    beforeEach(async () => {
      await setupValidAuth()
    })

    it('should not require a session header', async () => {
      const { handleMcpRequest } = await import('../handler')

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
          })
        )
      )

      expect(response.status).toBe(200)
      // Stateless mode: no Mcp-Session-Id header in response
      expect(response.headers.get('mcp-session-id')).toBeNull()
    })

    it('should handle requests independently (no shared state between calls)', async () => {
      const { handleMcpRequest } = await import('../handler')

      // First request: initialize
      const init1 = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'client-a', version: '1.0' },
          })
        )
      )
      expect(init1.status).toBe(200)

      await setupValidAuth()

      // Second request: completely new initialize (no session continuity needed)
      const init2 = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'client-b', version: '2.0' },
          })
        )
      )
      expect(init2.status).toBe(200)
    })

    it('should return JSON response (not SSE)', async () => {
      const { handleMcpRequest } = await import('../handler')

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
          })
        )
      )

      expect(response.status).toBe(200)
      const contentType = response.headers.get('content-type')
      expect(contentType).toContain('application/json')
    })
  })

  // ===========================================================================
  // GET and DELETE methods
  // ===========================================================================

  describe('HTTP Methods', () => {
    it('should reject GET without session (stateless mode)', async () => {
      await setupValidAuth()

      const { handleMcpRequest } = await import('../handler')

      const request = new Request('https://example.com/api/mcp', {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: 'Bearer qb_valid_key',
        },
      })

      const response = await handleMcpRequest(request)
      // Transport handles GET; in stateless mode it's a no-op
      expect([200, 400, 405]).toContain(response.status)
    })

    it('should handle DELETE request in stateless mode', async () => {
      await setupValidAuth()

      const { handleMcpRequest } = await import('../handler')

      const request = new Request('https://example.com/api/mcp', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer qb_valid_key' },
      })

      const response = await handleMcpRequest(request)
      // Stateless: DELETE either succeeds as no-op (200) or rejects (405)
      expect([200, 405]).toContain(response.status)
    })
  })
})
