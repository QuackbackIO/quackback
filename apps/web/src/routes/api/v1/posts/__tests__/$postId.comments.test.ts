import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, PostId } from '@quackback/ids'

const mockWithApiKeyAuth = vi.fn()
const mockCreateComment = vi.fn()
const mockPrincipalFindFirst = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/comments/comment.service', () => ({
  createComment: (...args: unknown[]) => mockCreateComment(...args),
}))
vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
    },
  },
  principal: { id: 'id' },
  eq: vi.fn(),
}))

import { Route } from '../$postId.comments'

type RouteOpts = { server: { handlers: { POST: (...args: unknown[]) => Promise<Response> } } }
const POST = (Route as unknown as { options: RouteOpts }).options.server.handlers.POST

const ADMIN_KEY_PRINCIPAL = 'principal_01kqhxq697fvgat0fn8rr1r7ew' as unknown as PrincipalId
const OVERRIDE_PRINCIPAL = 'principal_01kqhxq697fvgat0fvps13rmy2' as unknown as PrincipalId
const SERVICE_PRINCIPAL = 'principal_01kqhxq697fvgat0g3rfzp3971' as unknown as PrincipalId
const POST_ID = 'post_01kqhxq697fvgat0h1abc12345' as unknown as PostId

const adminAuth = { principalId: ADMIN_KEY_PRINCIPAL, role: 'admin', importMode: false }
const memberAuth = { principalId: ADMIN_KEY_PRINCIPAL, role: 'member', importMode: false }

const apiKeyHolderRecord = {
  id: ADMIN_KEY_PRINCIPAL,
  displayName: 'API Key',
  role: 'admin',
  type: 'service',
  user: { id: null, name: 'API Key', email: null },
}
const userPrincipalRecord = {
  id: OVERRIDE_PRINCIPAL,
  displayName: null,
  role: 'user',
  type: 'user',
  user: { id: 'user_uv', name: 'UV User', email: 'uv@example.com' },
}
const servicePrincipalRecord = {
  id: SERVICE_PRINCIPAL,
  displayName: 'Other API Key',
  role: 'admin',
  type: 'service',
  user: null,
}

const fakeComment = {
  id: 'comment_01kqhxq697fvgat0h1xyz12345',
  postId: POST_ID,
  parentId: null,
  content: 'Hello',
  principalId: OVERRIDE_PRINCIPAL,
  isTeamMember: false,
  isPrivate: false,
  createdAt: new Date(),
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request(`http://test/api/v1/posts/${POST_ID}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/posts/:postId/comments authorPrincipalId override', () => {
  beforeEach(() => {
    mockWithApiKeyAuth.mockReset()
    mockCreateComment.mockReset()
    mockPrincipalFindFirst.mockReset()
    mockCreateComment.mockResolvedValue({ comment: fakeComment })
  })

  it('attributes to the override principal for an admin caller', async () => {
    mockWithApiKeyAuth.mockResolvedValue(adminAuth)
    mockPrincipalFindFirst.mockResolvedValue(userPrincipalRecord)
    const res = await POST({
      request: makeRequest({ content: 'Hello', authorPrincipalId: OVERRIDE_PRINCIPAL }),
      params: { postId: POST_ID },
    })
    expect(res.status).toBe(201)
    const author = mockCreateComment.mock.calls[0][1]
    expect(author.principalId).toBe(OVERRIDE_PRINCIPAL)
    expect(author.role).toBe('user')
    expect(author.email).toBe('uv@example.com')
  })

  it('ignores authorPrincipalId for non-admin callers', async () => {
    mockWithApiKeyAuth.mockResolvedValue(memberAuth)
    mockPrincipalFindFirst.mockResolvedValue(apiKeyHolderRecord)
    await POST({
      request: makeRequest({ content: 'Hello', authorPrincipalId: OVERRIDE_PRINCIPAL }),
      params: { postId: POST_ID },
    })
    const author = mockCreateComment.mock.calls[0][1]
    expect(author.principalId).toBe(ADMIN_KEY_PRINCIPAL)
    expect(author.role).toBe('admin')
  })

  it('returns 404 when authorPrincipalId does not exist', async () => {
    mockWithApiKeyAuth.mockResolvedValue(adminAuth)
    mockPrincipalFindFirst.mockResolvedValue(null)
    const res = await POST({
      request: makeRequest({ content: 'Hello', authorPrincipalId: OVERRIDE_PRINCIPAL }),
      params: { postId: POST_ID },
    })
    expect(res.status).toBe(404)
    const json = await res.json()
    // handleDomainError normalises PRINCIPAL_NOT_FOUND → NOT_FOUND in the response body
    expect(json.error.code).toBe('NOT_FOUND')
    expect(mockCreateComment).not.toHaveBeenCalled()
  })

  it('returns 400 when authorPrincipalId points at a service principal', async () => {
    mockWithApiKeyAuth.mockResolvedValue(adminAuth)
    mockPrincipalFindFirst.mockResolvedValue(servicePrincipalRecord)
    const res = await POST({
      request: makeRequest({ content: 'Hello', authorPrincipalId: SERVICE_PRINCIPAL }),
      params: { postId: POST_ID },
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    // handleDomainError normalises INVALID_AUTHOR (a ValidationError) → VALIDATION_ERROR in the response body
    expect(json.error.code).toBe('VALIDATION_ERROR')
    expect(mockCreateComment).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed authorPrincipalId', async () => {
    mockWithApiKeyAuth.mockResolvedValue(adminAuth)
    const res = await POST({
      request: makeRequest({ content: 'Hello', authorPrincipalId: 'not-a-typeid' }),
      params: { postId: POST_ID },
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('VALIDATION_ERROR')
    expect(mockCreateComment).not.toHaveBeenCalled()
  })
})
