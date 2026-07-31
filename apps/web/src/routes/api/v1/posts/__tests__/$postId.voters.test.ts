import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostId, PostVoteId, PrincipalId } from '@quackback/ids'

const mockWithApiKeyAuth = vi.fn()
const mockListPostVoters = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/posts/post.voting', () => ({
  listPostVoters: (...args: unknown[]) => mockListPostVoters(...args),
}))

import { Route } from '../$postId.voters'

type RouteOpts = { server: { handlers: { GET: (...args: unknown[]) => Promise<Response> } } }
const GET = (Route as unknown as { options: RouteOpts }).options.server.handlers.GET

const POST_ID = 'post_01kqhxq697fvgat0h1abc12345' as unknown as PostId
const VOTE_ID = 'post_vote_01kqhxq697fvgat0h2def67890' as unknown as PostVoteId
const KEY_PRINCIPAL = 'principal_01kqhxq697fvgat0fn8rr1r7ew' as unknown as PrincipalId

const adminAuth = { principalId: KEY_PRINCIPAL, role: 'admin', importMode: false }

const voterRow = {
  principalId: 'principal_01kqhxq697fvgat0fvps13rmy2',
  displayName: 'Voter One',
  email: 'voter@example.com',
  avatarUrl: null,
  isAnonymous: false,
  sourceType: null,
  sourceExternalUrl: null,
  addedByName: null,
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  subscriptionLevel: 'all',
}

function makeRequest(query = ''): Request {
  return new Request(`http://test/api/v1/posts/${POST_ID}/voters${query}`, { method: 'GET' })
}

describe('GET /api/v1/posts/:postId/voters', () => {
  beforeEach(() => {
    mockWithApiKeyAuth.mockReset()
    mockListPostVoters.mockReset()
    mockWithApiKeyAuth.mockResolvedValue(adminAuth)
    mockListPostVoters.mockResolvedValue({ items: [voterRow], nextCursor: VOTE_ID, hasMore: true })
  })

  it('returns serialized voters with pagination meta', async () => {
    const res = await GET({ request: makeRequest(), params: { postId: POST_ID } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
    expect(json.data[0].principalId).toBe(voterRow.principalId)
    expect(json.data[0].displayName).toBe('Voter One')
    expect(json.data[0].createdAt).toBe('2026-01-02T03:04:05.000Z')
    expect(json.meta.pagination).toEqual({ cursor: VOTE_ID, hasMore: true })
  })

  it('passes a clamped limit and valid cursor to the domain query', async () => {
    await GET({
      request: makeRequest(`?limit=500&cursor=${VOTE_ID}`),
      params: { postId: POST_ID },
    })
    expect(mockListPostVoters).toHaveBeenCalledWith(POST_ID, { limit: 100, cursor: VOTE_ID })
  })

  it('defaults limit to 20 and ignores a malformed cursor', async () => {
    await GET({ request: makeRequest('?cursor=not-a-typeid'), params: { postId: POST_ID } })
    expect(mockListPostVoters).toHaveBeenCalledWith(POST_ID, { limit: 20, cursor: undefined })
  })

  it('returns 400 for a malformed post ID', async () => {
    const res = await GET({ request: makeRequest(), params: { postId: 'not-a-typeid' } })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('VALIDATION_ERROR')
    expect(mockListPostVoters).not.toHaveBeenCalled()
  })

  it('propagates auth failures', async () => {
    const { UnauthorizedError } = await import('@/lib/shared/errors')
    mockWithApiKeyAuth.mockRejectedValue(new UnauthorizedError('UNAUTHORIZED', 'Invalid API key'))
    const res = await GET({ request: makeRequest(), params: { postId: POST_ID } })
    expect(res.status).toBe(401)
    expect(mockListPostVoters).not.toHaveBeenCalled()
  })
})
