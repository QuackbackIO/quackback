import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardId, PrincipalId } from '@quackback/ids'

const mockWithApiKeyAuth = vi.fn()
const mockCreatePost = vi.fn()
const mockPrincipalFindFirst = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/posts/post.service', () => ({
  createPost: (...args: unknown[]) => mockCreatePost(...args),
}))
vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
    },
  },
  principal: { id: 'id', userId: 'user_id' },
  eq: vi.fn(),
}))

import { Route } from '../index'

type RouteOpts = { server: { handlers: { POST: (...args: unknown[]) => Promise<Response> } } }
const POST = (Route as unknown as { options: RouteOpts }).options.server.handlers.POST

const ADMIN_KEY_PRINCIPAL = 'principal_01kqhxq697fvgat0fn8rr1r7ew' as unknown as PrincipalId
const OVERRIDE_PRINCIPAL = 'principal_01kqhxq697fvgat0fvps13rmy2' as unknown as PrincipalId
const SERVICE_PRINCIPAL = 'principal_01kqhxq697fvgat0g3rfzp3971' as unknown as PrincipalId
const BOARD_ID = 'board_01kqhxq697fvgat0geegv834v0' as unknown as BoardId

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

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://test/api/v1/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/posts authorPrincipalId override', () => {
  beforeEach(() => {
    mockWithApiKeyAuth.mockReset()
    mockCreatePost.mockReset()
    mockPrincipalFindFirst.mockReset()
    mockCreatePost.mockResolvedValue({
      id: 'post_new',
      title: 'T',
      content: 'C',
      voteCount: 1,
      boardId: BOARD_ID,
      statusId: 'status_open',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  it('attributes to the override principal for an admin caller', async () => {
    mockWithApiKeyAuth.mockResolvedValue(adminAuth)
    mockPrincipalFindFirst.mockResolvedValue(userPrincipalRecord)
    const res = await POST({
      request: makeRequest({
        boardId: BOARD_ID,
        title: 'T',
        content: 'C',
        authorPrincipalId: OVERRIDE_PRINCIPAL,
      }),
    })
    expect(res.status).toBe(201)
    const author = mockCreatePost.mock.calls[0][1]
    expect(author.principalId).toBe(OVERRIDE_PRINCIPAL)
    expect(author.email).toBe('uv@example.com')
  })

  it('ignores authorPrincipalId for non-admin callers', async () => {
    mockWithApiKeyAuth.mockResolvedValue(memberAuth)
    mockPrincipalFindFirst.mockResolvedValue(apiKeyHolderRecord)
    await POST({
      request: makeRequest({
        boardId: BOARD_ID,
        title: 'T',
        content: 'C',
        authorPrincipalId: OVERRIDE_PRINCIPAL,
      }),
    })
    const author = mockCreatePost.mock.calls[0][1]
    expect(author.principalId).toBe(ADMIN_KEY_PRINCIPAL)
  })

  it('returns 404 when authorPrincipalId does not exist', async () => {
    mockWithApiKeyAuth.mockResolvedValue(adminAuth)
    mockPrincipalFindFirst.mockResolvedValue(null)
    const res = await POST({
      request: makeRequest({
        boardId: BOARD_ID,
        title: 'T',
        content: 'C',
        authorPrincipalId: OVERRIDE_PRINCIPAL,
      }),
    })
    expect(res.status).toBe(404)
    const json = await res.json()
    // handleDomainError normalises PRINCIPAL_NOT_FOUND → NOT_FOUND in the response body
    expect(json.error.code).toBe('NOT_FOUND')
    expect(mockCreatePost).not.toHaveBeenCalled()
  })

  it('returns 400 when authorPrincipalId points at a service principal', async () => {
    mockWithApiKeyAuth.mockResolvedValue(adminAuth)
    mockPrincipalFindFirst.mockResolvedValue(servicePrincipalRecord)
    const res = await POST({
      request: makeRequest({
        boardId: BOARD_ID,
        title: 'T',
        content: 'C',
        authorPrincipalId: SERVICE_PRINCIPAL,
      }),
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    // handleDomainError normalises INVALID_AUTHOR (a ValidationError) → VALIDATION_ERROR in the response body
    expect(json.error.code).toBe('VALIDATION_ERROR')
    expect(mockCreatePost).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed authorPrincipalId', async () => {
    mockWithApiKeyAuth.mockResolvedValue(adminAuth)
    const res = await POST({
      request: makeRequest({
        boardId: BOARD_ID,
        title: 'T',
        content: 'C',
        authorPrincipalId: 'not-a-typeid',
      }),
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('VALIDATION_ERROR')
    expect(mockCreatePost).not.toHaveBeenCalled()
  })
})
