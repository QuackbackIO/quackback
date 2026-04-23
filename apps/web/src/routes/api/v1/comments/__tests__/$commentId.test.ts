import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CommentId, PrincipalId } from '@quackback/ids'
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
} from '@/lib/shared/errors'

// ── Mock state ────────────────────────────────────────────────────────────────

const mockWithApiKeyAuth = vi.fn()
const mockParseTypeId = vi.fn()
const mockUserEditComment = vi.fn()
const mockSoftDeleteComment = vi.fn()
const mockGetCommentById = vi.fn()
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

vi.mock('@/lib/server/domains/comments/comment.permissions', () => ({
  userEditComment: (...args: unknown[]) => mockUserEditComment(...args),
  softDeleteComment: (...args: unknown[]) => mockSoftDeleteComment(...args),
}))

vi.mock('@/lib/server/domains/comments/comment.query', () => ({
  getCommentById: (...args: unknown[]) => mockGetCommentById(...args),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: {
        findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args),
      },
    },
  },
  principal: { id: 'id', userId: 'user_id' },
  eq: vi.fn(),
}))

// ── Route extraction ──────────────────────────────────────────────────────────

import { Route } from '../$commentId'

type MockedHandler = (ctx: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>
type MockedRouteShape = { options: { server: { handlers: Record<string, MockedHandler> } } }
const handlers = (Route as unknown as MockedRouteShape).options.server.handlers

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMMENT_ID_STR = 'comment_test123'
const PRINCIPAL_ID = 'principal_1' as PrincipalId

const mockComment = {
  id: COMMENT_ID_STR as unknown as CommentId,
  postId: 'post_test',
  parentId: null,
  content: 'Original comment',
  authorName: 'Test User',
  authorEmail: 'test@example.com',
  principalId: PRINCIPAL_ID,
  isTeamMember: false,
  isPrivate: false,
  createdAt: new Date('2026-01-01'),
  deletedAt: null,
}

const mockUpdatedComment = {
  ...mockComment,
  content: 'Updated comment',
  updatedAt: new Date('2026-01-02'),
}

function makeRequest(method: string, body?: unknown): Request {
  return new Request(`http://localhost/api/v1/comments/${COMMENT_ID_STR}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-api-key',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockWithApiKeyAuth.mockResolvedValue({ principalId: PRINCIPAL_ID, role: 'admin' })
  mockParseTypeId.mockImplementation((v: unknown) => v)
  mockUserEditComment.mockResolvedValue(mockUpdatedComment)
  mockSoftDeleteComment.mockResolvedValue(undefined)
  mockGetCommentById.mockResolvedValue(mockComment)
  mockPrincipalFindFirst.mockResolvedValue({
    role: 'admin',
    user: { name: 'Test User' },
  })
})

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/comments/:commentId', () => {
  it('returns 200 with updated comment on success', async () => {
    const request = makeRequest('PATCH', { content: 'Updated comment' })
    const response = await handlers.PATCH({ request, params: { commentId: COMMENT_ID_STR } })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.id).toBe(COMMENT_ID_STR)
    expect(json.data.content).toBe('Updated comment')
    expect(json.data.authorName).toBe('Test User')
  })

  it('calls userEditComment with commentId, content, and actor role', async () => {
    const request = makeRequest('PATCH', { content: 'Hello world' })
    await handlers.PATCH({ request, params: { commentId: COMMENT_ID_STR } })

    expect(mockUserEditComment).toHaveBeenCalledWith(
      COMMENT_ID_STR,
      'Hello world',
      expect.objectContaining({ principalId: PRINCIPAL_ID })
    )
  })

  it('returns 400 for empty content (Zod validation)', async () => {
    const request = makeRequest('PATCH', { content: '' })
    const response = await handlers.PATCH({ request, params: { commentId: COMMENT_ID_STR } })
    expect(response.status).toBe(400)
  })

  it('returns 400 when content field is missing', async () => {
    const request = makeRequest('PATCH', {})
    const response = await handlers.PATCH({ request, params: { commentId: COMMENT_ID_STR } })
    expect(response.status).toBe(400)
  })

  it('returns 400 for content exceeding 5000 characters (Zod validation)', async () => {
    const request = makeRequest('PATCH', { content: 'x'.repeat(5001) })
    const response = await handlers.PATCH({ request, params: { commentId: COMMENT_ID_STR } })
    expect(response.status).toBe(400)
  })

  it('returns 401 when API key auth fails', async () => {
    mockWithApiKeyAuth.mockRejectedValue(new UnauthorizedError('Invalid API key'))
    const request = makeRequest('PATCH', { content: 'Updated' })
    const response = await handlers.PATCH({ request, params: { commentId: COMMENT_ID_STR } })
    expect(response.status).toBe(401)
  })

  it('returns 400 when comment ID format is invalid', async () => {
    mockParseTypeId.mockImplementation(() => {
      throw new ValidationError('VALIDATION_ERROR', 'Invalid comment ID format')
    })
    const request = makeRequest('PATCH', { content: 'Updated' })
    const response = await handlers.PATCH({ request, params: { commentId: 'not-valid' } })
    expect(response.status).toBe(400)
  })

  it('returns 403 when userEditComment throws ForbiddenError', async () => {
    mockUserEditComment.mockRejectedValue(
      new ForbiddenError('EDIT_NOT_ALLOWED', 'Cannot edit after team member replied')
    )
    const request = makeRequest('PATCH', { content: 'Updated' })
    const response = await handlers.PATCH({ request, params: { commentId: COMMENT_ID_STR } })
    expect(response.status).toBe(403)
  })

  it('returns 404 when userEditComment throws NotFoundError', async () => {
    mockUserEditComment.mockRejectedValue(
      new NotFoundError('COMMENT_NOT_FOUND', 'Comment not found')
    )
    const request = makeRequest('PATCH', { content: 'Updated' })
    const response = await handlers.PATCH({ request, params: { commentId: COMMENT_ID_STR } })
    expect(response.status).toBe(404)
  })
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/v1/comments/:commentId', () => {
  it('returns 200 with comment data', async () => {
    const request = makeRequest('GET')
    const response = await handlers.GET({ request, params: { commentId: COMMENT_ID_STR } })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.id).toBe(COMMENT_ID_STR)
    expect(json.data.content).toBe('Original comment')
    expect(json.data.principalId).toBe(PRINCIPAL_ID)
  })

  it('returns 404 when comment does not exist', async () => {
    mockGetCommentById.mockRejectedValue(
      new NotFoundError('COMMENT_NOT_FOUND', 'Comment not found')
    )
    const request = makeRequest('GET')
    const response = await handlers.GET({ request, params: { commentId: COMMENT_ID_STR } })
    expect(response.status).toBe(404)
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/comments/:commentId', () => {
  it('returns 204 on successful deletion', async () => {
    const request = makeRequest('DELETE')
    const response = await handlers.DELETE({ request, params: { commentId: COMMENT_ID_STR } })
    expect(response.status).toBe(204)
  })

  it('returns 403 when softDeleteComment throws ForbiddenError', async () => {
    mockSoftDeleteComment.mockRejectedValue(
      new ForbiddenError('DELETE_NOT_ALLOWED', 'Cannot delete after team member replied')
    )
    const request = makeRequest('DELETE')
    const response = await handlers.DELETE({ request, params: { commentId: COMMENT_ID_STR } })
    expect(response.status).toBe(403)
  })
})
