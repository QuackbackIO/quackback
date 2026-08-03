import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentId, PrincipalId } from '@quackback/ids'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '@/lib/shared/errors'

// ── Mock state ────────────────────────────────────────────────────────────────
// The reactions route resolves its domain dependencies through dynamic
// `await import(...)` calls, so we mock the underlying modules rather than the
// route's static imports. Each mock simply delegates to a vi.fn() spy.

const mockWithApiKeyAuth = vi.fn()
const mockParseTypeId = vi.fn()
const mockAddReaction = vi.fn()
const mockRemoveReaction = vi.fn()
const mockSegmentIdsForPrincipal = vi.fn()
const mockPrincipalFindFirst = vi.fn()

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))

vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: (...args: unknown[]) => mockParseTypeId(...args),
}))

vi.mock('@/lib/server/domains/comments/comment.reactions', () => ({
  addReaction: (...args: unknown[]) => mockAddReaction(...args),
  removeReaction: (...args: unknown[]) => mockRemoveReaction(...args),
}))

vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: (...args: unknown[]) => mockSegmentIdsForPrincipal(...args),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: {
        findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args),
      },
    },
  },
  principal: { id: 'id', type: 'type' },
  eq: vi.fn(),
}))

// ── Route extraction ──────────────────────────────────────────────────────────

import { Route } from '../$commentId.reactions'

type MockedHandler = (ctx: {
  request: Request
  params: Record<string, string>
}) => Promise<Response>
type MockedRouteShape = { options: { server: { handlers: Record<string, MockedHandler> } } }
const handlers = (Route as unknown as MockedRouteShape).options.server.handlers

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMMENT_ID = 'comment_test123' as unknown as CommentId
const PRINCIPAL_ID = 'principal_1' as PrincipalId

const aggregatedReactions = [
  { emoji: '👍', count: 2, reactedByViewer: true, reactors: ['Alice', 'Bob'] },
]

function makeRequest(method: string, body?: unknown, search = ''): Request {
  return new Request(`http://localhost/api/v1/comments/${COMMENT_ID}/reactions${search}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-api-key',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

// A request whose .json() rejects, used to exercise the DELETE `.catch(() => ({}))`
// fallback branch when no emoji is supplied via the query string.
function makeBrokenJsonRequest(method: string, search = ''): Request {
  const request = makeRequest(method, undefined, search)
  Object.defineProperty(request, 'json', {
    value: () => Promise.reject(new Error('no body')),
  })
  return request
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockWithApiKeyAuth.mockResolvedValue({ principalId: PRINCIPAL_ID, role: 'team' })
  mockParseTypeId.mockImplementation((v: unknown) => v)
  mockSegmentIdsForPrincipal.mockResolvedValue(['segment_a'])
  mockPrincipalFindFirst.mockResolvedValue({ type: 'user' })
  mockAddReaction.mockResolvedValue({ added: true, reactions: aggregatedReactions })
  mockRemoveReaction.mockResolvedValue({ added: false, reactions: aggregatedReactions })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/v1/comments/:commentId/reactions', () => {
  it('returns 200 and adds a reaction with a user actor on success', async () => {
    const request = makeRequest('POST', { emoji: '👍' })
    const response = await handlers.POST({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data).toEqual({
      commentId: COMMENT_ID,
      emoji: '👍',
      added: true,
      reactions: aggregatedReactions,
    })

    // Auth is performed with the team role.
    expect(mockWithApiKeyAuth).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })

    // The comment ID param is parsed as a TypeId.
    expect(mockParseTypeId).toHaveBeenCalledWith(COMMENT_ID, 'comment', 'comment ID')

    // addReaction is called with the caller-derived actor (user principalType).
    expect(mockAddReaction).toHaveBeenCalledWith(
      COMMENT_ID,
      '👍',
      PRINCIPAL_ID,
      expect.objectContaining({
        principalId: PRINCIPAL_ID,
        role: 'team',
        principalType: 'user',
        segmentIds: ['segment_a'],
      })
    )
  })

  it('builds a service actor when the caller principal is a service principal', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ type: 'service' })
    const request = makeRequest('POST', { emoji: '🎉' })
    const response = await handlers.POST({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(200)
    expect(mockAddReaction).toHaveBeenCalledWith(
      COMMENT_ID,
      '🎉',
      PRINCIPAL_ID,
      expect.objectContaining({ principalType: 'service' })
    )
  })

  it('falls back to a user actor when the caller principal record is missing', async () => {
    // Exercises the optional-chaining branch (`callerRecord?.type`) when null.
    mockPrincipalFindFirst.mockResolvedValue(null)
    const request = makeRequest('POST', { emoji: '👍' })
    const response = await handlers.POST({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(200)
    expect(mockAddReaction).toHaveBeenCalledWith(
      COMMENT_ID,
      '👍',
      PRINCIPAL_ID,
      expect.objectContaining({ principalType: 'user' })
    )
  })

  it('reflects added=false from the service in the response body', async () => {
    mockAddReaction.mockResolvedValue({ added: false, reactions: aggregatedReactions })
    const request = makeRequest('POST', { emoji: '👍' })
    const response = await handlers.POST({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.added).toBe(false)
  })

  it('returns 400 when the emoji is empty and does not call the service', async () => {
    const request = makeRequest('POST', { emoji: '' })
    const response = await handlers.POST({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(400)
    expect(mockAddReaction).not.toHaveBeenCalled()
  })

  it('returns 400 when the emoji field is missing entirely', async () => {
    const request = makeRequest('POST', {})
    const response = await handlers.POST({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(400)
    expect(mockAddReaction).not.toHaveBeenCalled()
  })

  it('returns 400 when the emoji exceeds the 64 character maximum', async () => {
    const request = makeRequest('POST', { emoji: 'x'.repeat(65) })
    const response = await handlers.POST({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(400)
    expect(mockAddReaction).not.toHaveBeenCalled()
  })

  it('returns 401 via handleDomainError when API key auth fails', async () => {
    mockWithApiKeyAuth.mockRejectedValue(new UnauthorizedError('Invalid API key'))
    const request = makeRequest('POST', { emoji: '👍' })
    const response = await handlers.POST({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(401)
  })

  it('returns 404 via handleDomainError when addReaction throws NotFoundError', async () => {
    mockAddReaction.mockRejectedValue(new NotFoundError('COMMENT_NOT_FOUND', 'Comment not found'))
    const request = makeRequest('POST', { emoji: '👍' })
    const response = await handlers.POST({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(404)
  })

  it('returns 403 via handleDomainError when addReaction throws ForbiddenError', async () => {
    mockAddReaction.mockRejectedValue(new ForbiddenError('FORBIDDEN', 'Cannot view comment'))
    const request = makeRequest('POST', { emoji: '👍' })
    const response = await handlers.POST({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(403)
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/comments/:commentId/reactions', () => {
  it('removes a reaction using the emoji query parameter (no body read)', async () => {
    // Encodes the emoji into the query string so the body branch is skipped.
    const request = makeRequest('DELETE', undefined, `?emoji=${encodeURIComponent('👍')}`)
    const response = await handlers.DELETE({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data).toEqual({
      commentId: COMMENT_ID,
      emoji: '👍',
      added: false,
      reactions: aggregatedReactions,
    })
    expect(mockRemoveReaction).toHaveBeenCalledWith(
      COMMENT_ID,
      '👍',
      PRINCIPAL_ID,
      expect.objectContaining({ principalType: 'user', segmentIds: ['segment_a'] })
    )
  })

  it('removes a reaction using the emoji supplied in the JSON body', async () => {
    const request = makeRequest('DELETE', { emoji: '🎉' })
    const response = await handlers.DELETE({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(200)
    expect(mockRemoveReaction).toHaveBeenCalledWith(
      COMMENT_ID,
      '🎉',
      PRINCIPAL_ID,
      expect.any(Object)
    )
  })

  it('builds a service actor when the caller is a service principal', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ type: 'service' })
    const request = makeRequest('DELETE', { emoji: '👍' })
    const response = await handlers.DELETE({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(200)
    expect(mockRemoveReaction).toHaveBeenCalledWith(
      COMMENT_ID,
      '👍',
      PRINCIPAL_ID,
      expect.objectContaining({ principalType: 'service' })
    )
  })

  it('falls back to a user actor when the caller principal record is missing', async () => {
    mockPrincipalFindFirst.mockResolvedValue(null)
    const request = makeRequest('DELETE', { emoji: '👍' })
    const response = await handlers.DELETE({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(200)
    expect(mockRemoveReaction).toHaveBeenCalledWith(
      COMMENT_ID,
      '👍',
      PRINCIPAL_ID,
      expect.objectContaining({ principalType: 'user' })
    )
  })

  it('returns 400 when neither query nor body supply an emoji', async () => {
    const request = makeRequest('DELETE', {})
    const response = await handlers.DELETE({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(400)
    expect(mockRemoveReaction).not.toHaveBeenCalled()
  })

  it('returns 400 when the JSON body cannot be parsed and no query emoji is given', async () => {
    // Triggers the `.catch(() => ({}))` fallback, leaving the emoji undefined.
    const request = makeBrokenJsonRequest('DELETE')
    const response = await handlers.DELETE({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(400)
    expect(mockRemoveReaction).not.toHaveBeenCalled()
  })

  it('returns 400 when the body emoji is empty', async () => {
    const request = makeRequest('DELETE', { emoji: '' })
    const response = await handlers.DELETE({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(400)
    expect(mockRemoveReaction).not.toHaveBeenCalled()
  })

  it('returns 401 via handleDomainError when API key auth fails', async () => {
    mockWithApiKeyAuth.mockRejectedValue(new UnauthorizedError('Invalid API key'))
    const request = makeRequest('DELETE', { emoji: '👍' })
    const response = await handlers.DELETE({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(401)
  })

  it('returns 404 via handleDomainError when removeReaction throws NotFoundError', async () => {
    mockRemoveReaction.mockRejectedValue(
      new NotFoundError('COMMENT_NOT_FOUND', 'Comment not found')
    )
    const request = makeRequest('DELETE', { emoji: '👍' })
    const response = await handlers.DELETE({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(404)
  })

  it('returns 403 via handleDomainError when removeReaction throws ForbiddenError', async () => {
    mockRemoveReaction.mockRejectedValue(new ForbiddenError('FORBIDDEN', 'Cannot view comment'))
    const request = makeRequest('DELETE', { emoji: '👍' })
    const response = await handlers.DELETE({ request, params: { commentId: COMMENT_ID } })

    expect(response.status).toBe(403)
  })
})
