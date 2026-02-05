import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApiKey } from '@/lib/server/domains/api-keys'
import type { MemberId, ApiKeyId, UserId } from '@quackback/ids'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/lib/server/domains/api-keys', () => ({
  verifyApiKey: vi.fn(),
}))

const mockFindFirst = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      member: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
    },
  },
  member: { id: 'id' },
  eq: vi.fn((_a: unknown, _b: unknown) => 'eq-condition'),
}))

// Mock rate limiting to always allow
vi.mock('@/lib/server/domains/api/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

// Mock all domain services called by tools/resources
vi.mock('@/lib/server/domains/posts/post.query', () => ({
  listInboxPosts: vi.fn().mockResolvedValue({ items: [], total: 0, hasMore: false }),
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
    ownerMemberId: null,
    officialResponse: null,
    officialResponseAuthorName: null,
    officialResponseAt: null,
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
    ownerMemberId: null,
    officialResponse: null,
    officialResponseAt: null,
    updatedAt: new Date('2026-01-01'),
  }),
}))

vi.mock('@/lib/server/domains/comments/comment.service', () => ({
  createComment: vi.fn().mockResolvedValue({
    comment: {
      id: 'comment_new',
      postId: 'post_test',
      content: 'Great feedback!',
      parentId: null,
      memberId: 'member_test',
      isTeamMember: true,
      createdAt: new Date('2026-01-01'),
    },
    post: { id: 'post_test', title: 'Test Post', boardSlug: 'bugs' },
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
}))

vi.mock('@/lib/server/domains/members/member.service', () => ({
  listTeamMembers: vi.fn().mockResolvedValue([{ id: 'member_test', name: 'Jane', role: 'admin' }]),
}))

// ── Test Constants ─────────────────────────────────────────────────────────────

const MOCK_MEMBER_ID = 'member_01h455vb4pex5vsknk084sn02r' as MemberId
const MOCK_USER_ID = 'user_01h455vb4pex5vsknk084sn02s' as UserId

const MOCK_API_KEY: ApiKey = {
  id: 'apikey_01h455vb4pex5vsknk084sn02q' as ApiKeyId,
  name: 'Test Key',
  keyPrefix: 'qb_test',
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('MCP HTTP Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===========================================================================
  // Auth Flow
  // ===========================================================================

  describe('Authentication', () => {
    it('should return 401 when no Authorization header is provided', async () => {
      const { handleMcpRequest } = await import('../handler')

      const request = new Request('https://example.com/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonRpcRequest('initialize')),
      })

      const response = await handleMcpRequest(request)
      expect(response.status).toBe(401)
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
      expect(body.error).toBe('Member not found')
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
      const { handleMcpRequest } = await import('../handler')

      // Initialize first
      await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
          })
        )
      )

      // Re-setup auth since mocks are consumed
      await setupValidAuth()

      const response = await handleMcpRequest(mcpRequest(jsonRpcRequest('tools/list')))

      expect(response.status).toBe(200)
      const body = (await response.json()) as { result: { tools: Array<{ name: string }> } }
      const toolNames = body.result.tools.map((t) => t.name)
      expect(toolNames).toContain('search_feedback')
      expect(toolNames).toContain('get_post')
      expect(toolNames).toContain('triage_post')
      expect(toolNames).toContain('add_comment')
      expect(toolNames).toContain('create_post')
      expect(toolNames).toContain('create_changelog')
      expect(toolNames).toHaveLength(6)
    })

    it('should handle resources/list request', async () => {
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

    it('should handle tools/call for search_feedback', async () => {
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

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'search_feedback',
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
      expect(text.total).toBe(0)
      expect(text.hasMore).toBe(false)
    })

    it('should handle tools/call for get_post', async () => {
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

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'get_post',
            arguments: { postId: 'post_test' },
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

    it('should handle resources/read for boards', async () => {
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

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'get_post',
            arguments: { postId: 'post_nonexistent' },
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

      const response = await handleMcpRequest(mcpRequest(jsonRpcRequest('nonexistent/method')))

      expect(response.status).toBe(200)
      const body = (await response.json()) as { error: { code: number } }
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe(-32601) // Method not found
    })

    it('should handle tool call with unknown tool name', async () => {
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
