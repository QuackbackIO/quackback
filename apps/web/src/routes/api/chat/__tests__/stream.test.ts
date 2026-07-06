/**
 * Characterization tests for /api/chat/stream scope routing + authorization,
 * pinning CURRENT behavior ahead of the thread-extraction refactor. Covers
 * principal resolution (stream token vs session cookie), the conversations
 * feature gate, and the three scopes (inbox / presence / conversationId) -
 * NOT the SSE streaming internals (heartbeats, backfill, buffering).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockVerifyStreamToken = vi.fn()
const mockGetSession = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockConversationFindFirst = vi.fn()
const mockSubscribe = vi.fn()
const mockCanView = vi.fn()
const mockConversationsEnabled = vi.fn()
const mockPortalAccess = vi.fn()
const mockMarkPresent = vi.fn()
const mockClearPresence = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      principal: { findFirst: (...a: unknown[]) => mockPrincipalFindFirst(...a) },
      conversations: { findFirst: (...a: unknown[]) => mockConversationFindFirst(...a) },
    },
    select: vi.fn(),
  },
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  gt: vi.fn(),
  isNull: vi.fn(),
}))
vi.mock('@/lib/server/auth', () => ({
  auth: { api: { getSession: (...a: unknown[]) => mockGetSession(...a) } },
}))
vi.mock('@/lib/server/realtime/stream-token', () => ({
  verifyStreamToken: (...a: unknown[]) => mockVerifyStreamToken(...a),
}))
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  conversationChannel: (id: string) => `conversation:${id}`,
  CONVERSATION_INBOX_CHANNEL: 'conversation:inbox',
  parseConversationFrame: (message: string) => {
    try {
      return JSON.parse(message)
    } catch {
      return null
    }
  },
  isOwnTyping: () => false,
}))
const mockReadActivitySnapshot = vi.fn()
vi.mock('@/lib/server/domains/assistant/assistant-activity-snapshot', () => ({
  readActivitySnapshot: (...a: unknown[]) => mockReadActivitySnapshot(...a),
}))
vi.mock('@/lib/server/realtime/pubsub', () => ({
  subscribe: (...a: unknown[]) => mockSubscribe(...a),
}))
vi.mock('@/lib/server/realtime/presence', () => ({
  markPresent: (...a: unknown[]) => mockMarkPresent(...a),
  refreshPresence: vi.fn(),
  clearPresence: (...a: unknown[]) => mockClearPresence(...a),
}))
vi.mock('@/lib/server/policy/conversation', () => ({
  canViewConversation: (...a: unknown[]) => mockCanView(...a),
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  loadAuthors: vi.fn(async () => new Map()),
  toMessageDTO: vi.fn(),
  fallbackAuthor: vi.fn(),
  findBackfillCursor: vi.fn(),
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  normalizePrincipalType: (t: string) => t,
}))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabled: (...a: unknown[]) => mockConversationsEnabled(...a),
}))
vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: (...a: unknown[]) => mockPortalAccess(...a),
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  requeueUnansweredOnAgentOffline: vi.fn(),
}))
const mockAcquireSlot = vi.fn()
vi.mock('@/lib/server/realtime/stream-connection-limit', () => ({
  streamLimiter: { acquire: (...a: unknown[]) => mockAcquireSlot(...a) },
}))
vi.mock('@/lib/server/domains/api/rate-limit', () => ({
  getClientIp: () => '203.0.113.7',
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}))

import { Route } from '../stream'

type RouteOpts = { server: { handlers: { GET: (a: { request: Request }) => Promise<Response> } } }
const GET = (Route as unknown as { options: RouteOpts }).options.server.handlers.GET

const req = (qs: string, headers?: Record<string, string>) =>
  new Request(`http://test/api/chat/stream${qs}`, { headers })

/** Wait for the (async) stream start to run, then release the stream. */
async function settleAndClose(res: Response) {
  await vi.waitFor(() => expect(mockMarkPresent).toHaveBeenCalled())
  await res.body?.cancel()
}

/** Read frames off the SSE body until `want` shows up (or reads run out),
 *  then release the stream. Reads one chunk at a time rather than assuming a
 *  fixed count, since the underlying stream may coalesce or split enqueues. */
async function drainUntil(res: Response, want: string, maxReads = 10): Promise<string> {
  const reader = res.body!.getReader()
  let all = ''
  for (let i = 0; i < maxReads; i++) {
    const { value, done } = await reader.read()
    if (done) break
    all += new TextDecoder().decode(value)
    if (all.includes(want)) break
  }
  await reader.cancel()
  return all
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConversationsEnabled.mockResolvedValue(true)
  mockVerifyStreamToken.mockReturnValue(null)
  mockGetSession.mockResolvedValue(null)
  mockPrincipalFindFirst.mockResolvedValue(undefined)
  mockConversationFindFirst.mockResolvedValue(undefined)
  mockSubscribe.mockResolvedValue(async () => {})
  mockMarkPresent.mockResolvedValue(undefined)
  mockClearPresence.mockResolvedValue(false)
  mockCanView.mockReturnValue({ allowed: true })
  mockPortalAccess.mockResolvedValue({ granted: true })
  mockAcquireSlot.mockReturnValue({ ok: true, release: vi.fn() })
  mockReadActivitySnapshot.mockResolvedValue(null)
})

function tokenPrincipal(role: string, type = 'user') {
  mockVerifyStreamToken.mockReturnValue('principal_tok')
  mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_tok', role, type })
}

function sessionPrincipal(role: string, type = 'user') {
  mockGetSession.mockResolvedValue({ user: { id: 'user_1' } })
  mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_sess', role, type })
}

describe('GET /api/chat/stream - principal resolution', () => {
  it('401s with neither a stream token nor a session', async () => {
    const res = await GET({ request: req('?scope=inbox') })
    expect(res.status).toBe(401)
  })

  it('401s for a session user with no principal row', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user_1' } })
    mockPrincipalFindFirst.mockResolvedValue(undefined)
    const res = await GET({ request: req('?scope=inbox') })
    expect(res.status).toBe(401)
  })

  it('401s for a valid-signature token whose principal no longer exists', async () => {
    mockVerifyStreamToken.mockReturnValue('principal_gone')
    mockPrincipalFindFirst.mockResolvedValue(undefined)
    const res = await GET({ request: req('?scope=inbox&token=t') })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/chat/stream - feature gate', () => {
  it('404s when every conversation surface is disabled', async () => {
    tokenPrincipal('admin')
    mockConversationsEnabled.mockResolvedValue(false)
    const res = await GET({ request: req('?scope=inbox&token=t') })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/chat/stream - inbox scope', () => {
  it('403s a non-team principal', async () => {
    tokenPrincipal('user')
    const res = await GET({ request: req('?scope=inbox&token=t') })
    expect(res.status).toBe(403)
    expect(mockSubscribe).not.toHaveBeenCalled()
  })

  it('opens an SSE stream on the inbox channel for a team member', async () => {
    sessionPrincipal('member')
    const res = await GET({ request: req('?scope=inbox') })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    await settleAndClose(res)
    expect(mockSubscribe).toHaveBeenCalledWith(['conversation:inbox'], expect.any(Function))
  })
})

describe('GET /api/chat/stream - presence scope', () => {
  it('403s a non-team principal', async () => {
    sessionPrincipal('user')
    const res = await GET({ request: req('?scope=presence') })
    expect(res.status).toBe(403)
  })

  it('opens a heartbeat-only stream (no channels) for a team member', async () => {
    sessionPrincipal('admin')
    const res = await GET({ request: req('?scope=presence') })
    expect(res.status).toBe(200)
    await settleAndClose(res)
    // Presence subscribes to no channels - it only maintains the heartbeat.
    expect(mockSubscribe).toHaveBeenCalledWith([], expect.any(Function))
  })
})

describe('GET /api/chat/stream - conversationId scope', () => {
  it('subscribes a token-authed visitor to their conversation channel', async () => {
    tokenPrincipal('user', 'anonymous')
    mockConversationFindFirst.mockResolvedValue({
      id: 'conversation_1',
      visitorPrincipalId: 'principal_tok',
    })
    const res = await GET({ request: req('?conversationId=conversation_1&token=t') })
    expect(res.status).toBe(200)
    await settleAndClose(res)
    expect(mockSubscribe).toHaveBeenCalledWith(
      ['conversation:conversation_1'],
      expect.any(Function)
    )
    // Token streams were portal-gated at mint time; no re-check here.
    expect(mockPortalAccess).not.toHaveBeenCalled()
  })

  it('404s when the conversation does not exist (no existence leak)', async () => {
    tokenPrincipal('user')
    mockConversationFindFirst.mockResolvedValue(undefined)
    const res = await GET({ request: req('?conversationId=conversation_missing&token=t') })
    expect(res.status).toBe(404)
  })

  it('404s (not 403) when the policy denies viewing', async () => {
    tokenPrincipal('user')
    mockConversationFindFirst.mockResolvedValue({ id: 'conversation_1' })
    mockCanView.mockReturnValue({ allowed: false })
    const res = await GET({ request: req('?conversationId=conversation_1&token=t') })
    expect(res.status).toBe(404)
  })

  it('re-gates a cookie-authed (non-team) visitor on portal access: denied -> 404', async () => {
    sessionPrincipal('user')
    mockPortalAccess.mockResolvedValue({ granted: false })
    const res = await GET({ request: req('?conversationId=conversation_1') })
    expect(res.status).toBe(404)
    expect(mockPortalAccess).toHaveBeenCalled()
    // Denied before the conversation is even looked up.
    expect(mockConversationFindFirst).not.toHaveBeenCalled()
  })

  it('allows a cookie-authed visitor once portal access is granted', async () => {
    sessionPrincipal('user')
    mockConversationFindFirst.mockResolvedValue({
      id: 'conversation_1',
      visitorPrincipalId: 'principal_sess',
    })
    const res = await GET({ request: req('?conversationId=conversation_1') })
    expect(res.status).toBe(200)
    await settleAndClose(res)
    expect(mockPortalAccess).toHaveBeenCalled()
    expect(mockSubscribe).toHaveBeenCalledWith(
      ['conversation:conversation_1'],
      expect.any(Function)
    )
  })

  it('skips the portal re-check for cookie-authed team members', async () => {
    sessionPrincipal('admin')
    mockConversationFindFirst.mockResolvedValue({ id: 'conversation_1' })
    const res = await GET({ request: req('?conversationId=conversation_1') })
    expect(res.status).toBe(200)
    await settleAndClose(res)
    expect(mockPortalAccess).not.toHaveBeenCalled()
  })
})

describe('GET /api/chat/stream - no scope', () => {
  it('400s when neither scope nor conversationId is supplied', async () => {
    tokenPrincipal('admin')
    const res = await GET({ request: req('?token=t') })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/chat/stream - connection cap (Phase 6 R1)', () => {
  it('503s when the connection limiter refuses a slot', async () => {
    tokenPrincipal('member')
    mockAcquireSlot.mockReturnValueOnce({ ok: false, release: vi.fn() })
    const res = await GET({ request: req('?scope=inbox') })
    expect(res.status).toBe(503)
    // Refused before any stream setup — presence must never be marked.
    expect(mockMarkPresent).not.toHaveBeenCalled()
  })

  it('reserves the slot keyed on the client IP, only after auth + scope pass', async () => {
    tokenPrincipal('member')
    const res = await GET({ request: req('?scope=inbox') })
    expect(res.status).toBe(200)
    expect(mockAcquireSlot).toHaveBeenCalledWith('203.0.113.7')
    await settleAndClose(res)
  })

  it('does NOT reserve a slot when auth fails (cap gate is the last gate)', async () => {
    // No principal → 401 well before the cap gate, so no slot is consumed.
    const res = await GET({ request: req('?scope=inbox') })
    expect(res.status).toBe(401)
    expect(mockAcquireSlot).not.toHaveBeenCalled()
  })

  it('releases the slot when the stream tears down', async () => {
    const release = vi.fn()
    mockAcquireSlot.mockReturnValue({ ok: true, release })
    tokenPrincipal('member')
    const res = await GET({ request: req('?scope=inbox') })
    await settleAndClose(res)
    await vi.waitFor(() => expect(release).toHaveBeenCalled())
  })
})

describe('GET /api/chat/stream - assistant activity snapshot replay', () => {
  it('replays a pending Quinn activity snapshot as an SSE frame for a fresh conversation subscriber', async () => {
    tokenPrincipal('user', 'anonymous')
    mockConversationFindFirst.mockResolvedValue({
      id: 'conversation_1',
      visitorPrincipalId: 'principal_tok',
    })
    mockReadActivitySnapshot.mockResolvedValue({
      kind: 'assistant_activity',
      conversationId: 'conversation_1',
      status: 'thinking',
      at: '2026-01-01T00:00:00.000Z',
    })

    const res = await GET({ request: req('?conversationId=conversation_1&token=t') })
    expect(res.status).toBe(200)
    const body = await drainUntil(res, 'assistant_activity')

    expect(mockReadActivitySnapshot).toHaveBeenCalledWith('conversation_1')
    expect(body).toContain('event: assistant_activity')
    expect(body).toContain('"status":"thinking"')
  })

  it('reads the snapshot only after subscribing (no gap between subscribe and replay)', async () => {
    tokenPrincipal('user', 'anonymous')
    mockConversationFindFirst.mockResolvedValue({
      id: 'conversation_1',
      visitorPrincipalId: 'principal_tok',
    })
    const order: string[] = []
    mockSubscribe.mockImplementation(async () => {
      order.push('subscribe')
      return async () => {}
    })
    mockReadActivitySnapshot.mockImplementation(async () => {
      order.push('read-snapshot')
      return null
    })

    const res = await GET({ request: req('?conversationId=conversation_1&token=t') })
    await settleAndClose(res)
    await vi.waitFor(() => expect(mockReadActivitySnapshot).toHaveBeenCalled())

    expect(order).toEqual(['subscribe', 'read-snapshot'])
  })

  it('emits no frame and never reads the snapshot for the inbox/presence scopes', async () => {
    tokenPrincipal('member')
    const res = await GET({ request: req('?scope=inbox') })
    await settleAndClose(res)
    expect(mockReadActivitySnapshot).not.toHaveBeenCalled()
  })

  it('emits nothing extra when no turn is in flight (snapshot miss)', async () => {
    tokenPrincipal('user', 'anonymous')
    mockConversationFindFirst.mockResolvedValue({
      id: 'conversation_1',
      visitorPrincipalId: 'principal_tok',
    })
    mockReadActivitySnapshot.mockResolvedValue(null)

    const res = await GET({ request: req('?conversationId=conversation_1&token=t') })
    await settleAndClose(res)
    expect(mockReadActivitySnapshot).toHaveBeenCalledWith('conversation_1')
  })
})
