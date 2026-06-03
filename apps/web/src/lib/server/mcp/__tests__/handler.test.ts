import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApiKey } from '@/lib/server/domains/api-keys'
import type { PrincipalId, ApiKeyId, UserId } from '@quackback/ids'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/lib/server/domains/api-keys/api-key.service', () => ({
  verifyApiKey: vi.fn(),
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn(),
}))

const mockFindFirst = vi.fn()

vi.mock('@/lib/server/db', () => {
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  }
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  }
  return {
    db: {
      query: {
        principal: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
      },
      update: vi.fn(() => updateChain),
      select: vi.fn(() => selectChain),
    },
    principal: { id: 'id', userId: 'user_id', displayName: 'name', avatarUrl: 'avatar' },
    apiKeys: { id: 'id' },
    ticketActivity: {
      id: 'id',
      ticketId: 'ticket_id',
      principalId: 'principal_id',
      type: 'type',
      metadata: 'metadata',
      createdAt: 'created_at',
    },
    eq: vi.fn((_a: unknown, _b: unknown) => 'eq-condition'),
    and: vi.fn((..._args: unknown[]) => 'and-condition'),
    lt: vi.fn((_a: unknown, _b: unknown) => 'lt-condition'),
    desc: vi.fn((_a: unknown) => 'desc-order'),
  }
})

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
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 100 })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

// Mock settings service so getDeveloperConfig doesn't hit the real DB.
// `getTenantSettings` is consumed lazily by the suspension guard (which the
// API auth chokepoint invokes); returning `null` keeps the workspace 'active'.
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getDeveloperConfig: vi
    .fn()
    .mockResolvedValue({ mcpEnabled: true, mcpPortalAccessEnabled: false }),
  getTenantSettings: vi.fn().mockResolvedValue(null),
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}))

// Mock config so baseUrl is available (used in WWW-Authenticate header)
vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://example.com' },
}))

// Mock all domain services called by tools/resources
vi.mock('@/lib/server/domains/posts/post.inbox', () => ({
  listInboxPosts: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
}))

vi.mock('@/lib/server/domains/posts/post.query', () => ({
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
    summaryJson: null,
    summaryUpdatedAt: null,
    canonicalPostId: null,
    mergedAt: null,
    isCommentsLocked: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  }),
  getCommentsWithReplies: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: vi.fn(async () => new Set()),
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
  addVoteOnBehalf: vi.fn().mockResolvedValue({ voted: true, voteCount: 7 }),
  removeVote: vi.fn().mockResolvedValue({ removed: true, voteCount: 4 }),
}))

vi.mock('@/lib/server/domains/posts/post.access', () => ({
  assertPostViewable: vi.fn().mockResolvedValue(undefined),
  assertPostVotable: vi.fn().mockResolvedValue(undefined),
  assertCommentViewable: vi.fn().mockResolvedValue(undefined),
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
  getMergedPosts: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  getActivityForPost: vi.fn().mockResolvedValue([]),
  createActivity: vi.fn(),
}))

vi.mock('@/lib/server/domains/feedback/pipeline/suggestion.service', () => ({
  acceptCreateSuggestion: vi.fn().mockResolvedValue({ success: true, resultPostId: 'post_new' }),
  acceptVoteSuggestion: vi.fn().mockResolvedValue({ success: true, resultPostId: 'post_test' }),
  dismissSuggestion: vi.fn().mockResolvedValue(undefined),
  restoreSuggestion: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/domains/merge-suggestions/merge-suggestion.service', () => ({
  acceptMergeSuggestion: vi.fn().mockResolvedValue(undefined),
  dismissMergeSuggestion: vi.fn().mockResolvedValue(undefined),
  restoreMergeSuggestion: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/domains/posts/post.user-actions', () => ({
  softDeletePost: vi.fn().mockResolvedValue(undefined),
  restorePost: vi.fn().mockResolvedValue({
    id: 'post_test',
    title: 'Restored Post',
    deletedAt: null,
    deletedByPrincipalId: null,
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
      isPrivate: false,
      createdAt: new Date('2026-01-01'),
    },
    post: { id: 'post_test', title: 'Test Post', boardSlug: 'bugs' },
  }),
  deleteComment: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/domains/comments/comment.permissions', () => ({
  userEditComment: vi.fn().mockResolvedValue({
    id: 'comment_new',
    postId: 'post_test',
    content: 'Updated comment',
    updatedAt: new Date('2026-01-02'),
  }),
  softDeleteComment: vi.fn().mockResolvedValue(undefined),
  canEditComment: vi.fn().mockResolvedValue({ allowed: true }),
  canDeleteComment: vi.fn().mockResolvedValue({ allowed: true }),
}))

vi.mock('@/lib/server/domains/comments/comment.reactions', () => ({
  addReaction: vi.fn().mockResolvedValue({
    added: true,
    reactions: [{ emoji: '👍', count: 1, hasReacted: true }],
  }),
  removeReaction: vi.fn().mockResolvedValue({
    added: false,
    reactions: [],
  }),
}))

vi.mock('@/lib/server/domains/changelog/changelog.query', () => ({
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

// ── Ticketing & CRM mocks (Phases 2–4) ────────────────────────────────────

const MOCK_TICKET = {
  id: 'ticket_01test',
  subject: 'Test Ticket',
  descriptionText: 'Body',
  priority: 'normal',
  channel: 'manual',
  visibilityScope: 'team',
  statusId: 'ticket_status_01open',
  primaryTeamId: null,
  assigneePrincipalId: null,
  assigneeTeamId: null,
  requesterPrincipalId: null,
  requesterContactId: null,
  organizationId: null,
  inboxId: null,
  slaPolicyId: null,
  lastActivityAt: new Date('2026-01-01'),
  firstResponseAt: null,
  resolvedAt: null,
  closedAt: null,
  reopenedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  createTicket: vi.fn().mockResolvedValue(MOCK_TICKET),
  updateTicket: vi.fn().mockResolvedValue(MOCK_TICKET),
  assignTicket: vi.fn().mockResolvedValue(MOCK_TICKET),
  transitionStatus: vi.fn().mockResolvedValue(MOCK_TICKET),
  getTicket: vi.fn().mockResolvedValue(MOCK_TICKET),
}))

vi.mock('@/lib/server/domains/tickets/ticket.query', () => ({
  listTickets: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
}))

vi.mock('@/lib/server/domains/tickets/ticket.take-return', () => ({
  takeTicket: vi.fn().mockResolvedValue(MOCK_TICKET),
  returnTicket: vi.fn().mockResolvedValue(MOCK_TICKET),
}))

vi.mock('@/lib/server/domains/tickets/ticket.bulk', () => ({
  bulkAssign: vi.fn().mockResolvedValue({ ok: 0, denied: 0, errors: [] }),
  bulkTransition: vi.fn().mockResolvedValue({ ok: 0, denied: 0, errors: [] }),
  bulkChangeInbox: vi.fn().mockResolvedValue({ ok: 0, denied: 0, errors: [] }),
}))

vi.mock('@/lib/server/domains/tickets/ticket-statuses.service', () => ({
  getTicketStatus: vi.fn().mockResolvedValue(null),
  listTicketStatuses: vi.fn().mockResolvedValue([
    {
      id: 'ticket_status_01open',
      name: 'Open',
      slug: 'open',
      color: '#22c55e',
      category: 'open',
      position: 0,
      isDefault: true,
      isSystem: true,
    },
  ]),
  createTicketStatus: vi.fn().mockResolvedValue({ id: 'ticket_status_01new' }),
  updateTicketStatus: vi.fn().mockResolvedValue({ id: 'ticket_status_01open' }),
  archiveTicketStatus: vi
    .fn()
    .mockResolvedValue({ id: 'ticket_status_01open', deletedAt: new Date() }),
}))

vi.mock('@/lib/server/domains/tickets/ticket.threads', () => ({
  addThread: vi.fn().mockResolvedValue({ id: 'ticket_thread_01new' }),
  editThread: vi.fn().mockResolvedValue({ id: 'ticket_thread_01new' }),
  softDeleteThread: vi.fn().mockResolvedValue({ id: 'ticket_thread_01new', deletedAt: new Date() }),
  listThreads: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/server/domains/tickets/ticket.participants', () => ({
  addParticipant: vi.fn().mockResolvedValue({ id: 'ticket_participant_01new' }),
  removeParticipant: vi.fn().mockResolvedValue(undefined),
  listParticipants: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/server/domains/tickets/ticket.share', () => ({
  shareTicketWithTeam: vi.fn().mockResolvedValue({ id: 'ticket_share_01new' }),
  revokeShare: vi.fn().mockResolvedValue({ id: 'ticket_share_01new', revokedAt: new Date() }),
  listSharesForTicket: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/server/domains/tickets/ticket.subscriptions', () => ({
  safeSubscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribeFromTicket: vi.fn().mockResolvedValue(true),
  updateSubscriptionPrefs: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/server/domains/tickets/ticket.permissions', () => ({
  toResourceScope: vi.fn(() => ({})),
  canViewTicket: vi.fn(() => true),
  canReplyPublic: vi.fn(() => true),
  canCommentInternal: vi.fn(() => true),
  canShareCrossTeam: vi.fn(() => true),
  canManageParticipants: vi.fn(() => true),
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  loadPermissionSet: vi.fn().mockResolvedValue({
    principalId: 'principal_test',
    teamIds: [],
    workspacePermissions: new Set(),
    teamPermissions: new Map(),
  }),
  hasPermission: vi.fn(() => true),
  hasPermissionForResource: vi.fn(() => true),
}))

vi.mock('@/lib/server/domains/organizations/contact.service', () => ({
  searchContacts: vi.fn().mockResolvedValue([]),
  getContact: vi.fn().mockResolvedValue(null),
  createContact: vi.fn().mockResolvedValue({ id: 'contact_01new' }),
  updateContact: vi.fn().mockResolvedValue({ id: 'contact_01new' }),
  archiveContact: vi.fn().mockResolvedValue(undefined),
  findOrCreateByEmail: vi.fn().mockResolvedValue({ id: 'contact_01new' }),
  linkContactToUser: vi.fn().mockResolvedValue({ id: 'contact_user_link_01new' }),
  unlinkContactFromUser: vi.fn().mockResolvedValue(undefined),
  listLinksForContact: vi.fn().mockResolvedValue([]),
  listContactsForOrganization: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/server/domains/organizations/organization.service', () => ({
  listOrganizations: vi.fn().mockResolvedValue([]),
  getOrganization: vi.fn().mockResolvedValue(null),
  getOrganizationByDomain: vi.fn().mockResolvedValue(null),
  createOrganization: vi.fn().mockResolvedValue({ id: 'organization_01new' }),
  updateOrganization: vi.fn().mockResolvedValue({ id: 'organization_01new' }),
  archiveOrganization: vi.fn().mockResolvedValue(undefined),
  unarchiveOrganization: vi.fn().mockResolvedValue(undefined),
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
  scopes: [],
  allowedTeamIds: [],
  allowedInboxIds: [],
  lastIp: null,
  lastUserAgent: null,
  rotatedAt: null,
  compatLegacyFullAccess: true,
  compatAcknowledgedAt: null,
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
  const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
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
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(null)

      const { handleMcpRequest } = await import('../handler')
      const response = await handleMcpRequest(mcpRequest(jsonRpcRequest('initialize'), 'qb_bad'))

      expect(response.status).toBe(401)
    })

    it('should return 401 with WWW-Authenticate when API key auth fails', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(null)

      const { handleMcpRequest } = await import('../handler')
      const response = await handleMcpRequest(mcpRequest(jsonRpcRequest('initialize'), 'qb_bad'))

      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate')).toContain('resource_metadata=')
    })

    it('should return 403 when member is a portal user (not team)', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(MOCK_API_KEY)
      // Return role: 'user' for the role lookup in withApiKeyAuth
      mockFindFirst.mockResolvedValue({ role: 'user' })

      const { handleMcpRequest } = await import('../handler')
      const response = await handleMcpRequest(mcpRequest(jsonRpcRequest('initialize')))

      expect(response.status).toBe(403)
    })

    it('should return 401 when member record not found', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
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

    it('should return 429 with Retry-After header when rate limit is exceeded', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(MOCK_API_KEY)
      const { checkRateLimit } = await import('@/lib/server/domains/api/rate-limit')
      vi.mocked(checkRateLimit).mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        retryAfter: 30,
      })

      const { handleMcpRequest } = await import('../handler')
      const response = await handleMcpRequest(mcpRequest(jsonRpcRequest('initialize')))

      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('30')
    })

    it('should propagate unexpected errors from withApiKeyAuth instead of swallowing as 401', async () => {
      const { verifyApiKey } = await import('@/lib/server/domains/api-keys/api-key.service')
      vi.mocked(verifyApiKey).mockResolvedValue(MOCK_API_KEY)
      mockFindFirst.mockRejectedValueOnce(new Error('DB connection lost'))

      const { resolveAuthContext } = await import('../handler')
      const request = mcpRequest(jsonRpcRequest('initialize'))

      await expect(resolveAuthContext(request)).rejects.toThrow('DB connection lost')
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
      expect(toolNames).toContain('proxy_vote')
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
      expect(toolNames).toContain('delete_post')
      expect(toolNames).toContain('restore_post')
      // Phase 2–4 ticketing + CRM tools
      expect(toolNames).toContain('list_tickets')
      expect(toolNames).toContain('create_ticket')
      expect(toolNames).toContain('add_ticket_thread')
      expect(toolNames).toContain('manage_ticket_share')
      expect(toolNames).toContain('manage_ticket_status')
      expect(toolNames).toContain('manage_contact')
      expect(toolNames).toContain('manage_organization')
      expect(toolNames).toHaveLength(57)
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
      expect(uris).toContain('quackback://help-center/categories')
      expect(uris).toContain('quackback://ticket-statuses')
      expect(uris).toContain('quackback://tickets/inbox')
      expect(uris).toContain('quackback://contacts')
      expect(uris).toContain('quackback://organizations')
      expect(uris).toHaveLength(10)
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

    // ── search tool (showDeleted) ───────────────────────────────────────

    it('should pass showDeleted to listInboxPosts when showDeleted is true', async () => {
      const { listInboxPosts } = await import('@/lib/server/domains/posts/post.inbox')
      const handleMcpRequest = await initializeSession()

      await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'search',
            arguments: { query: 'deleted stuff', showDeleted: true },
          })
        )
      )

      expect(vi.mocked(listInboxPosts)).toHaveBeenCalledWith(
        expect.objectContaining({ showDeleted: true })
      )
    })

    it('should not pass showDeleted when showDeleted is false', async () => {
      const { listInboxPosts } = await import('@/lib/server/domains/posts/post.inbox')
      const handleMcpRequest = await initializeSession()

      await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'search',
            arguments: { query: 'test' },
          })
        )
      )

      expect(vi.mocked(listInboxPosts)).toHaveBeenCalledWith(
        expect.objectContaining({ showDeleted: undefined })
      )
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

    it('vote_post runs assertPostVotable (view+vote chokepoint) before recording the vote', async () => {
      // The existing happy-path test mocks assertPostVotable to resolve and
      // only checks the return value — a regression that dropped the call would
      // pass it. This pins that the chokepoint is invoked with the caller's
      // actor and runs BEFORE the mutation.
      const { assertPostVotable } = await import('@/lib/server/domains/posts/post.access')
      const { voteOnPost } = await import('@/lib/server/domains/posts/post.voting')
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', { name: 'vote_post', arguments: { postId: 'post_test' } })
        )
      )

      expect(response.status).toBe(200)
      expect(vi.mocked(assertPostVotable)).toHaveBeenCalledWith(
        'post_test',
        expect.objectContaining({ principalId: MOCK_MEMBER_ID, principalType: 'user' })
      )
      expect(vi.mocked(voteOnPost)).toHaveBeenCalled()
      expect(vi.mocked(assertPostVotable).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(voteOnPost).mock.invocationCallOrder[0]
      )
    })

    it('vote_post fails closed when assertPostVotable denies (the mutation never runs)', async () => {
      const { assertPostVotable } = await import('@/lib/server/domains/posts/post.access')
      const { voteOnPost } = await import('@/lib/server/domains/posts/post.voting')
      const { ForbiddenError } = await import('@/lib/shared/errors')
      const handleMcpRequest = await initializeSession()
      vi.mocked(assertPostVotable).mockRejectedValueOnce(
        new ForbiddenError('VOTE_NOT_ALLOWED', 'Sign in to vote on this board')
      )

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', { name: 'vote_post', arguments: { postId: 'post_test' } })
        )
      )

      const body = (await response.json()) as {
        result: { isError: boolean; content: Array<{ text: string }> }
      }
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('Sign in to vote on this board')
      expect(vi.mocked(voteOnPost)).not.toHaveBeenCalled()
    })

    // ── proxy_vote tool ─────────────────────────────────────────────────

    it('should handle tools/call for proxy_vote (add)', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'proxy_vote',
            arguments: {
              postId: 'post_test',
              voterPrincipalId: 'principal_voter',
            },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.voted).toBe(true)
      expect(text.voteCount).toBe(7)
      expect(text.voterPrincipalId).toBe('principal_voter')
    })

    it('should handle tools/call for proxy_vote (remove)', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'proxy_vote',
            arguments: {
              action: 'remove',
              postId: 'post_test',
              voterPrincipalId: 'principal_voter',
            },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.removed).toBe(true)
      expect(text.voteCount).toBe(4)
      expect(text.voterPrincipalId).toBe('principal_voter')
    })

    it('should handle proxy_vote with source attribution', async () => {
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'proxy_vote',
            arguments: {
              postId: 'post_test',
              voterPrincipalId: 'principal_voter',
              sourceType: 'zendesk',
              sourceExternalUrl: 'https://zendesk.com/ticket/123',
            },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.voted).toBe(true)
      expect(text.voteCount).toBe(7)
    })

    it('proxy_vote does NOT enforce the target principal vote tier (intentional team-attributed bypass)', async () => {
      // proxy_vote is a team-authority tool (requireTeamRole) for recording a
      // vote on behalf of a customer (e.g. from a Zendesk ticket). It routes
      // straight to addVoteOnBehalf and deliberately skips assertPostVotable —
      // the per-board vote-tier gate applies to a user voting for THEMSELVES,
      // not to a trusted teammate attributing signal gathered elsewhere.
      // This pins that design: adding assertPostVotable here (which would
      // reject a target outside the board's vote tier) breaks this test on
      // purpose, forcing a conscious decision rather than a silent change.
      const { addVoteOnBehalf } = await import('@/lib/server/domains/posts/post.voting')
      const { assertPostVotable } = await import('@/lib/server/domains/posts/post.access')
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'proxy_vote',
            arguments: { postId: 'post_test', voterPrincipalId: 'principal_voter' },
          })
        )
      )

      expect(response.status).toBe(200)
      // The vote is recorded for the target...
      expect(vi.mocked(addVoteOnBehalf)).toHaveBeenCalledWith(
        'post_test',
        'principal_voter',
        expect.any(Object),
        null,
        expect.any(String)
      )
      // ...without running the per-target vote-tier chokepoint.
      expect(vi.mocked(assertPostVotable)).not.toHaveBeenCalled()
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
      expect(text.isPrivate).toBe(false)
    })

    it('should handle tools/call for add_comment with isPrivate', async () => {
      const { createComment } = await import('@/lib/server/domains/comments/comment.service')
      const mockCreateComment = createComment as ReturnType<typeof vi.fn>
      mockCreateComment.mockResolvedValueOnce({
        comment: {
          id: 'comment_private',
          postId: 'post_test',
          content: 'Internal discussion note',
          parentId: null,
          principalId: 'principal_test',
          isTeamMember: true,
          isPrivate: true,
          createdAt: new Date('2026-01-01'),
        },
        post: { id: 'post_test', title: 'Test Post', boardSlug: 'bugs' },
      })

      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'add_comment',
            arguments: {
              postId: 'post_test',
              content: 'Internal discussion note',
              isPrivate: true,
            },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.id).toBe('comment_private')
      expect(text.isPrivate).toBe(true)

      // Verify isPrivate was passed through to the service
      expect(mockCreateComment).toHaveBeenCalledWith(
        expect.objectContaining({ isPrivate: true }),
        expect.any(Object),
        expect.any(Object)
      )
    })

    it('add_comment fails closed when createComment denies (comment tier / locked / private)', async () => {
      const { createComment } = await import('@/lib/server/domains/comments/comment.service')
      const { ForbiddenError } = await import('@/lib/shared/errors')
      const handleMcpRequest = await initializeSession()
      vi.mocked(createComment).mockRejectedValueOnce(
        new ForbiddenError('FORBIDDEN', 'Only specific groups can comment on this board')
      )

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'add_comment',
            arguments: { postId: 'post_test', content: 'hi' },
          })
        )
      )

      const body = (await response.json()) as {
        result: { isError: boolean; content: Array<{ text: string }> }
      }
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain(
        'Only specific groups can comment on this board'
      )
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

    it('react_to_comment passes the caller real-role actor to addReaction (view + isPrivate gate)', async () => {
      // The 4th arg is the policy actor whose canViewPost + isPrivate gate must
      // reflect the reacting caller — only the happy path is pinned today.
      const { addReaction } = await import('@/lib/server/domains/comments/comment.reactions')
      const handleMcpRequest = await initializeSession()

      await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'react_to_comment',
            arguments: { action: 'add', commentId: 'comment_new', emoji: '👍' },
          })
        )
      )

      expect(vi.mocked(addReaction).mock.calls[0][3]).toEqual(
        expect.objectContaining({
          principalId: MOCK_MEMBER_ID,
          role: 'admin',
          principalType: 'user',
        })
      )
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

    // ── delete_post tool ──────────────────────────────────────────────

    it('should handle tools/call for delete_post', async () => {
      const { softDeletePost } = await import('@/lib/server/domains/posts/post.user-actions')
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'delete_post',
            arguments: { postId: 'post_test' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.deleted).toBe(true)
      expect(text.postId).toBe('post_test')
      expect(vi.mocked(softDeletePost)).toHaveBeenCalledWith(
        'post_test',
        expect.objectContaining({ principalId: MOCK_MEMBER_ID })
      )
    })

    // ── restore_post tool ─────────────────────────────────────────────

    it('should handle tools/call for restore_post', async () => {
      const { restorePost } = await import('@/lib/server/domains/posts/post.user-actions')
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'restore_post',
            arguments: { postId: 'post_test' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { content: Array<{ text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.restored).toBe(true)
      expect(text.postId).toBe('post_test')
      expect(text.title).toBe('Restored Post')
      expect(vi.mocked(restorePost)).toHaveBeenCalledWith('post_test', expect.any(String))
    })

    // ── delete_post error handling ──────────────────────────────────

    it('should return error when delete_post fails', async () => {
      const { softDeletePost } = await import('@/lib/server/domains/posts/post.user-actions')
      vi.mocked(softDeletePost).mockRejectedValueOnce(new Error('Post has already been deleted'))
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'delete_post',
            arguments: { postId: 'post_test' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { isError: boolean; content: Array<{ text: string }> }
      }
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('Post has already been deleted')
    })

    // ── restore_post error handling ─────────────────────────────────

    it('should return error when restore_post fails (expired)', async () => {
      const { restorePost } = await import('@/lib/server/domains/posts/post.user-actions')
      vi.mocked(restorePost).mockRejectedValueOnce(
        new Error('Posts can only be restored within 30 days of deletion')
      )
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'restore_post',
            arguments: { postId: 'post_old' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { isError: boolean; content: Array<{ text: string }> }
      }
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('30 days')
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
      // After Phase 1's SCOPE_IMPLIES (write:feedback → read:feedback),
      // we use a strictly unrelated scope to assert the gate still fires.
      const handleMcpRequest = await initializeOAuthSession(['read:tickets'])

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

    it('should deny delete_post when write:feedback scope missing', async () => {
      const handleMcpRequest = await initializeOAuthSession(['read:feedback'])

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'delete_post',
            arguments: { postId: 'post_test' },
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

    it('should deny restore_post when write:feedback scope missing', async () => {
      const handleMcpRequest = await initializeOAuthSession(['read:feedback'])

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'restore_post',
            arguments: { postId: 'post_test' },
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

    it('should deny search posts for OAuth portal user (inbox is team-only)', async () => {
      const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })
      const handleMcpRequest = await initializeOAuthSession(['read:feedback'])
      await setupValidOAuth({
        role: 'user',
        scopes: ['read:feedback'],
      })
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })

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
      expect(body.result.content[0].text).toContain('team member')
    })

    it('should deny get_details(post) for OAuth portal user (inbox is team-only)', async () => {
      const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })
      const handleMcpRequest = await initializeOAuthSession(['read:feedback'])
      await setupValidOAuth({
        role: 'user',
        scopes: ['read:feedback'],
      })
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'get_details',
            arguments: { id: 'post_01jx0p1q3rh0d8t5a8j4f7y3p9' },
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

    it('should deny search(articles) for OAuth portal user (help center MCP is team-only)', async () => {
      const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
      const { isFeatureEnabled } = await import('@/lib/server/domains/settings/settings.service')
      vi.mocked(isFeatureEnabled).mockResolvedValue(true)
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })
      const handleMcpRequest = await initializeOAuthSession(['read:help-center'])
      await setupValidOAuth({
        role: 'user',
        scopes: ['read:help-center'],
      })
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'search',
            arguments: { entity: 'articles', query: 'getting started' },
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

    it('should deny get_details(article) for OAuth portal user (help center MCP is team-only)', async () => {
      const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
      const { isFeatureEnabled } = await import('@/lib/server/domains/settings/settings.service')
      vi.mocked(isFeatureEnabled).mockResolvedValue(true)
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })
      const handleMcpRequest = await initializeOAuthSession(['read:help-center'])
      await setupValidOAuth({
        role: 'user',
        scopes: ['read:help-center'],
      })
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'get_details',
            arguments: { id: 'article_01jx0p1q3rh0d8t5a8j4f7y3p9' },
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

    it('should deny get_details(changelog) for OAuth portal user (drafts/scheduled are team-only)', async () => {
      const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })
      const handleMcpRequest = await initializeOAuthSession(['read:feedback'])
      await setupValidOAuth({
        role: 'user',
        scopes: ['read:feedback'],
      })
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'get_details',
            arguments: { id: 'changelog_01jx0p1q3rh0d8t5a8j4f7y3p9' },
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

    it('should deny search showDeleted for OAuth portal user (role enforcement)', async () => {
      const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })
      const handleMcpRequest = await initializeOAuthSession(['read:feedback', 'write:feedback'])
      await setupValidOAuth({
        role: 'user',
        scopes: ['read:feedback', 'write:feedback'],
      })
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'search',
            arguments: { query: 'deleted', showDeleted: true },
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

    it('should deny delete_post for OAuth portal user (role enforcement)', async () => {
      const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })
      const handleMcpRequest = await initializeOAuthSession(['read:feedback', 'write:feedback'])
      await setupValidOAuth({
        role: 'user',
        scopes: ['read:feedback', 'write:feedback'],
      })
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'delete_post',
            arguments: { postId: 'post_test' },
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

    it('create_post builds the policy actor from the caller real role (not forced admin)', async () => {
      // Arrange: a portal user (role 'user') reaching create_post via MCP
      // portal access with the freely-consentable write:feedback scope. The
      // actor handed to createPost must carry the caller's REAL role so the
      // policy gate inside createPost (submit tier + moderation axis) applies
      // — forcing 'admin' would early-return tierAllows for every tier and
      // set requiresApproval:false, bypassing both gates.
      const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })
      const handleMcpRequest = await initializeOAuthSession(['write:feedback'])
      await setupValidOAuth({ role: 'user', scopes: ['write:feedback'] })
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })

      const { createPost } = await import('@/lib/server/domains/posts/post.service')

      await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'create_post',
            arguments: { boardId: 'board_test', title: 'X' },
          })
        )
      )

      // The second arg to createPost carries `actor`; its role must be the
      // caller's, so canCreatePost can apply the submit tier + moderation.
      const actor = vi.mocked(createPost).mock.calls[0][1].actor
      expect(actor?.role).toBe('user')
    })

    it('add_comment builds the policy actor from the caller real role (not forced admin)', async () => {
      // A portal user (role 'user') reaching add_comment via MCP portal access:
      // the actor handed to createComment must carry the caller's REAL role so
      // canCreateComment applies the comment tier + moderation axis — forcing
      // 'admin' would bypass both via the isTeamActor early-return.
      const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })
      const handleMcpRequest = await initializeOAuthSession(['write:feedback'])
      await setupValidOAuth({ role: 'user', scopes: ['write:feedback'] })
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })

      const { createComment } = await import('@/lib/server/domains/comments/comment.service')

      await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'add_comment',
            arguments: { postId: 'post_test', content: 'hi' },
          })
        )
      )

      // 3rd arg is the policy actor; its role must be the caller's.
      expect(vi.mocked(createComment).mock.calls[0][2]).toEqual(
        expect.objectContaining({ role: 'user', principalType: 'user' })
      )
    })

    it('update_comment runs assertCommentViewable before editing (view-gate on locked board)', async () => {
      // A portal author whose board view was tightened (dropped to team or out
      // of a segment) must not edit the comment via MCP. The view-gate runs
      // first; userEditComment is never reached.
      const { assertCommentViewable } = await import('@/lib/server/domains/posts/post.access')
      const { userEditComment } = await import('@/lib/server/domains/comments/comment.permissions')
      const { NotFoundError } = await import('@/lib/shared/errors')

      const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })
      const handleMcpRequest = await initializeOAuthSession(['write:feedback'])
      await setupValidOAuth({ role: 'user', scopes: ['write:feedback'] })
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })

      vi.mocked(assertCommentViewable).mockRejectedValueOnce(
        new NotFoundError('COMMENT_NOT_FOUND', 'Comment comment_1 not found')
      )

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'update_comment',
            arguments: { commentId: 'comment_1', content: 'edit' },
          })
        )
      )

      expect(vi.mocked(assertCommentViewable)).toHaveBeenCalledWith(
        'comment_1',
        expect.objectContaining({ role: 'user' })
      )
      expect(vi.mocked(userEditComment)).not.toHaveBeenCalled()
      const body = (await response.json()) as { result: { isError: boolean } }
      expect(body.result.isError).toBe(true)
    })

    it('delete_comment runs assertCommentViewable before the hard cascade delete', async () => {
      // delete_comment runs the irreversible cascading delete. View-gate first,
      // matching the portal path + react_to_comment; deleteComment is never
      // reached when the actor can no longer view the comment's board.
      const { assertCommentViewable } = await import('@/lib/server/domains/posts/post.access')
      const { deleteComment } = await import('@/lib/server/domains/comments/comment.service')
      const { NotFoundError } = await import('@/lib/shared/errors')

      const { getDeveloperConfig } = await import('@/lib/server/domains/settings/settings.service')
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })
      const handleMcpRequest = await initializeOAuthSession(['write:feedback'])
      await setupValidOAuth({ role: 'user', scopes: ['write:feedback'] })
      vi.mocked(getDeveloperConfig).mockResolvedValueOnce({
        mcpEnabled: true,
        mcpPortalAccessEnabled: true,
      })

      vi.mocked(assertCommentViewable).mockRejectedValueOnce(
        new NotFoundError('COMMENT_NOT_FOUND', 'Comment comment_1 not found')
      )

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'delete_comment',
            arguments: { commentId: 'comment_1' },
          })
        )
      )

      expect(vi.mocked(assertCommentViewable)).toHaveBeenCalledWith(
        'comment_1',
        expect.objectContaining({ role: 'user' })
      )
      expect(vi.mocked(deleteComment)).not.toHaveBeenCalled()
      const body = (await response.json()) as { result: { isError: boolean } }
      expect(body.result.isError).toBe(true)
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

  // ===========================================================================
  // Ticketing scope gating (Phase 5)
  // ===========================================================================

  describe('Ticketing tools', () => {
    it('should reject list_tickets when OAuth token lacks read:tickets scope', async () => {
      await setupValidOAuth({ scopes: ['read:feedback'] })

      const { handleMcpRequest } = await import('../handler')
      // Initialize first
      await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' },
          })
        )
      )
      await setupValidOAuth({ scopes: ['read:feedback'] })

      const response = await handleMcpRequest(
        oauthRequest(
          jsonRpcRequest('tools/call', {
            name: 'list_tickets',
            arguments: { scope: 'all' },
          })
        )
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: { isError?: boolean; content: Array<{ type: string; text: string }> }
      }
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('Insufficient scope')
      expect(body.result.content[0].text).toContain('read:tickets')
    })

    it('should handle tools/call for create_ticket via API key (full scope set)', async () => {
      const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      const handleMcpRequest = await initializeSession()

      const response = await handleMcpRequest(
        mcpRequest(
          jsonRpcRequest('tools/call', {
            name: 'create_ticket',
            arguments: { subject: 'New ticket', descriptionText: 'Body text' },
          })
        )
      )

      expect(response.status).toBe(200)
      expect(vi.mocked(createTicket)).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'New ticket',
          descriptionText: 'Body text',
        })
      )
      const body = (await response.json()) as {
        result: { content: Array<{ type: string; text: string }> }
      }
      const text = JSON.parse(body.result.content[0].text)
      expect(text.id).toBe('ticket_01test')
    })
  })
})
