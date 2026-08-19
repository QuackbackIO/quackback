import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = vi.fn()
const mockListPending = vi.fn()
const mockApprovePost = vi.fn()
const mockRejectPost = vi.fn()
const mockApproveComment = vi.fn()
const mockRejectComment = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...a: unknown[]) => mockAuth(...a),
}))
vi.mock('@/lib/server/domains/moderation', () => ({
  listPending: (...a: unknown[]) => mockListPending(...a),
  approvePost: (...a: unknown[]) => mockApprovePost(...a),
  rejectPost: (...a: unknown[]) => mockRejectPost(...a),
  approveComment: (...a: unknown[]) => mockApproveComment(...a),
  rejectComment: (...a: unknown[]) => mockRejectComment(...a),
}))

import { Route as PendingRoute } from '../pending'
import { Route as PostApproveRoute } from '../posts.$postId.approve'
import { Route as PostRejectRoute } from '../posts.$postId.reject'
import { Route as CommentApproveRoute } from '../comments.$commentId.approve'
import { Route as CommentRejectRoute } from '../comments.$commentId.reject'

type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>
const get = (route: unknown): Handler =>
  (route as { options: { server: { handlers: { GET: Handler } } } }).options.server.handlers.GET
const post = (route: unknown): Handler =>
  (route as { options: { server: { handlers: { POST: Handler } } } }).options.server.handlers.POST

const POST_ID = 'post_01h455vb4pex5vsknk084sn02q'
const COMMENT_ID = 'post_comment_01h455vb4pex5vsknk084sn02q'

const jsonReq = (url: string, body?: unknown) =>
  new Request(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({
    principalId: 'principal_key',
    role: 'admin',
    principal: { user: { id: 'user_1' } },
    apiKey: { id: 'api_key_1', scopes: null },
  })
})

describe('GET /moderation/pending', () => {
  it('lists the pending queue gated post.approve', async () => {
    mockListPending.mockResolvedValue({ posts: [{ id: POST_ID }], comments: [] })
    const res = await get(PendingRoute)({
      request: new Request('https://x.test/api/v1/moderation/pending'),
      params: {},
    })
    expect(res.status).toBe(200)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'post.approve' })
    const body = await res.json()
    expect(body.data).toEqual({ posts: [{ id: POST_ID }], comments: [] })
  })
})

describe('POST /moderation/posts/:id/approve', () => {
  it('approves with a service + api_key audit actor recording the key id', async () => {
    mockApprovePost.mockResolvedValue(undefined)
    const res = await post(PostApproveRoute)({
      request: jsonReq(`https://x.test/api/v1/moderation/posts/${POST_ID}/approve`),
      params: { postId: POST_ID },
    })
    expect(res.status).toBe(200)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'post.approve' })
    const [postId, audit] = mockApprovePost.mock.calls[0]
    expect(postId).toBe(POST_ID)
    expect(audit.actor).toMatchObject({ userId: 'user_1', type: 'service', authMethod: 'api_key' })
    expect(audit.metadata).toEqual({ apiKeyId: 'api_key_1' })
    expect((await res.json()).data).toEqual({ ok: true })
  })

  it('400s a malformed post id without calling the service', async () => {
    const res = await post(PostApproveRoute)({
      request: jsonReq('https://x.test/api/v1/moderation/posts/nope/approve'),
      params: { postId: 'nope' },
    })
    expect(res.status).toBe(400)
    expect(mockApprovePost).not.toHaveBeenCalled()
  })
})

describe('POST /moderation/posts/:id/reject', () => {
  it('passes the reason through', async () => {
    mockRejectPost.mockResolvedValue(undefined)
    await post(PostRejectRoute)({
      request: jsonReq(`https://x.test/api/v1/moderation/posts/${POST_ID}/reject`, {
        reason: 'link spam',
      }),
      params: { postId: POST_ID },
    })
    const [postId, reason, audit] = mockRejectPost.mock.calls[0]
    expect(postId).toBe(POST_ID)
    expect(reason).toBe('link spam')
    expect(audit.metadata).toEqual({ apiKeyId: 'api_key_1' })
  })

  it('tolerates an absent body (reason undefined)', async () => {
    mockRejectPost.mockResolvedValue(undefined)
    const res = await post(PostRejectRoute)({
      request: jsonReq(`https://x.test/api/v1/moderation/posts/${POST_ID}/reject`),
      params: { postId: POST_ID },
    })
    expect(res.status).toBe(200)
    expect(mockRejectPost.mock.calls[0][1]).toBeUndefined()
  })

  it('400s a reason over 500 chars', async () => {
    const res = await post(PostRejectRoute)({
      request: jsonReq(`https://x.test/api/v1/moderation/posts/${POST_ID}/reject`, {
        reason: 'x'.repeat(501),
      }),
      params: { postId: POST_ID },
    })
    expect(res.status).toBe(400)
    expect(mockRejectPost).not.toHaveBeenCalled()
  })
})

describe('POST /moderation/comments/:id/(approve|reject)', () => {
  it('approves a comment gated post.approve', async () => {
    mockApproveComment.mockResolvedValue(undefined)
    const res = await post(CommentApproveRoute)({
      request: jsonReq(`https://x.test/api/v1/moderation/comments/${COMMENT_ID}/approve`),
      params: { commentId: COMMENT_ID },
    })
    expect(res.status).toBe(200)
    expect(mockApproveComment.mock.calls[0][0]).toBe(COMMENT_ID)
  })

  it('rejects a comment with a reason', async () => {
    mockRejectComment.mockResolvedValue(undefined)
    await post(CommentRejectRoute)({
      request: jsonReq(`https://x.test/api/v1/moderation/comments/${COMMENT_ID}/reject`, {
        reason: 'off-topic',
      }),
      params: { commentId: COMMENT_ID },
    })
    const [commentId, reason] = mockRejectComment.mock.calls[0]
    expect(commentId).toBe(COMMENT_ID)
    expect(reason).toBe('off-topic')
  })

  it('400s a malformed comment id', async () => {
    const res = await post(CommentApproveRoute)({
      request: jsonReq('https://x.test/api/v1/moderation/comments/nope/approve'),
      params: { commentId: 'nope' },
    })
    expect(res.status).toBe(400)
    expect(mockApproveComment).not.toHaveBeenCalled()
  })
})
