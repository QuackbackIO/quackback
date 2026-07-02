import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

// Hoisted mocks for every dependency the moderation routes touch. The route
// handlers pull the moderation service in via a dynamic `await import(...)`, so
// mocking the module path below means those calls resolve to these spies.
const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  listPendingCommentsMock: vi.fn(),
  listPendingPostsMock: vi.fn(),
  approveCommentMock: vi.fn(),
  rejectCommentMock: vi.fn(),
  approvePostMock: vi.fn(),
  rejectPostMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => hoisted.withApiKeyAuthMock(...args),
  assertScopeAllowed: (...args: unknown[]) => hoisted.assertScopeAllowedMock(...args),
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  loadPermissionSet: (...args: unknown[]) => hoisted.loadPermissionSetMock(...args),
  hasPermission: (...args: unknown[]) => hoisted.hasPermissionMock(...args),
}))

vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: (...args: unknown[]) => hoisted.parseTypeIdMock(...args),
}))

vi.mock('@/lib/server/domains/moderation/moderation.service', () => ({
  listPendingComments: (...args: unknown[]) => hoisted.listPendingCommentsMock(...args),
  listPendingPosts: (...args: unknown[]) => hoisted.listPendingPostsMock(...args),
  approveComment: (...args: unknown[]) => hoisted.approveCommentMock(...args),
  rejectComment: (...args: unknown[]) => hoisted.rejectCommentMock(...args),
  approvePost: (...args: unknown[]) => hoisted.approvePostMock(...args),
  rejectPost: (...args: unknown[]) => hoisted.rejectPostMock(...args),
}))

import { Route as CommentsRoute } from '../comments'
import { Route as CommentApproveRoute } from '../comments.$commentId.approve'
import { Route as CommentRejectRoute } from '../comments.$commentId.reject'
import { Route as PostsRoute } from '../posts'
import { Route as PostApproveRoute } from '../posts.$postId.approve'
import { Route as PostRejectRoute } from '../posts.$postId.reject'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const commentsHandlers = (CommentsRoute as unknown as RouteWithHandlers).options.server.handlers
const commentApproveHandlers = (CommentApproveRoute as unknown as RouteWithHandlers).options.server
  .handlers
const commentRejectHandlers = (CommentRejectRoute as unknown as RouteWithHandlers).options.server
  .handlers
const postsHandlers = (PostsRoute as unknown as RouteWithHandlers).options.server.handlers
const postApproveHandlers = (PostApproveRoute as unknown as RouteWithHandlers).options.server
  .handlers
const postRejectHandlers = (PostRejectRoute as unknown as RouteWithHandlers).options.server.handlers

const PRINCIPAL = 'principal_admin'
const COMMENT = 'comment_123'
const POST = 'post_123'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/moderation')
) {
  return { request, params: handlerParams }
}

async function expectJsonData(response: Response) {
  return (await response.json()).data
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({
    principalId: PRINCIPAL,
    role: 'team',
    key: { scopes: [] },
  })
  hoisted.loadPermissionSetMock.mockResolvedValue(new Set<string>())
  hoisted.hasPermissionMock.mockReturnValue(true)
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
})

describe('GET /api/v1/moderation/comments', () => {
  it('lists pending comments after scope and permission checks', async () => {
    const rows = [{ id: COMMENT, body: 'pending comment' }]
    hoisted.listPendingCommentsMock.mockResolvedValue(rows)

    const response = await commentsHandlers.GET(args())

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(rows)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.MODERATION_VIEW
    )
    expect(hoisted.loadPermissionSetMock).toHaveBeenCalledWith(PRINCIPAL)
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.MODERATION_VIEW
    )
    expect(hoisted.listPendingCommentsMock).toHaveBeenCalledTimes(1)
  })

  it('returns 403 before listing when moderation.view permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await commentsHandlers.GET(args())

    expect(response.status).toBe(403)
    expect(hoisted.listPendingCommentsMock).not.toHaveBeenCalled()
  })

  it('maps domain errors via handleDomainError', async () => {
    hoisted.listPendingCommentsMock.mockRejectedValue({
      code: 'COMMENT_NOT_FOUND',
      message: 'gone',
    })

    const response = await commentsHandlers.GET(args())

    expect(response.status).toBe(404)
  })
})

describe('POST /api/v1/moderation/comments/:commentId/approve', () => {
  it('approves a comment after scope and permission checks', async () => {
    hoisted.approveCommentMock.mockResolvedValue(undefined)
    const request = jsonRequest(
      'http://test/api/v1/moderation/comments/comment_123/approve',
      'POST'
    )

    const response = await commentApproveHandlers.POST({ request, params: { commentId: COMMENT } })

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual({ ok: true, commentId: COMMENT })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.MODERATION_MANAGE
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.MODERATION_MANAGE
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(COMMENT, 'comment', 'comment ID')
    expect(hoisted.approveCommentMock).toHaveBeenCalledWith(
      COMMENT,
      { role: 'team', type: 'api_key' },
      request.headers
    )
  })

  it('returns 403 before approving when moderation.manage permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await commentApproveHandlers.POST(args({ commentId: COMMENT }))

    expect(response.status).toBe(403)
    expect(hoisted.approveCommentMock).not.toHaveBeenCalled()
  })

  it('maps domain errors via handleDomainError', async () => {
    hoisted.approveCommentMock.mockRejectedValue({ code: 'COMMENT_NOT_FOUND', message: 'gone' })

    const response = await commentApproveHandlers.POST(args({ commentId: COMMENT }))

    expect(response.status).toBe(404)
  })
})

describe('POST /api/v1/moderation/comments/:commentId/reject', () => {
  it('rejects a comment with a supplied reason', async () => {
    hoisted.rejectCommentMock.mockResolvedValue(undefined)
    const request = jsonRequest(
      'http://test/api/v1/moderation/comments/comment_123/reject',
      'POST',
      { reason: 'spam' }
    )

    const response = await commentRejectHandlers.POST({ request, params: { commentId: COMMENT } })

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual({ ok: true, commentId: COMMENT })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.MODERATION_MANAGE
    )
    expect(hoisted.rejectCommentMock).toHaveBeenCalledWith(
      COMMENT,
      'spam',
      { role: 'team', type: 'api_key' },
      request.headers
    )
  })

  it('rejects a comment with no body, falling back to an undefined reason', async () => {
    hoisted.rejectCommentMock.mockResolvedValue(undefined)
    // Empty body forces the `.catch(() => ({}))` fallback; reason is optional.
    const request = new Request('http://test/api/v1/moderation/comments/comment_123/reject', {
      method: 'POST',
    })

    const response = await commentRejectHandlers.POST({ request, params: { commentId: COMMENT } })

    expect(response.status).toBe(200)
    expect(hoisted.rejectCommentMock).toHaveBeenCalledWith(
      COMMENT,
      undefined,
      { role: 'team', type: 'api_key' },
      request.headers
    )
  })

  it('returns 400 for an invalid reason without calling the service', async () => {
    const request = jsonRequest(
      'http://test/api/v1/moderation/comments/comment_123/reject',
      'POST',
      { reason: 'x'.repeat(1001) }
    )

    const response = await commentRejectHandlers.POST({ request, params: { commentId: COMMENT } })

    expect(response.status).toBe(400)
    expect(hoisted.rejectCommentMock).not.toHaveBeenCalled()
  })

  it('returns 403 before rejecting when moderation.manage permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await commentRejectHandlers.POST(args({ commentId: COMMENT }))

    expect(response.status).toBe(403)
    expect(hoisted.rejectCommentMock).not.toHaveBeenCalled()
  })

  it('maps domain errors via handleDomainError', async () => {
    hoisted.rejectCommentMock.mockRejectedValue({ code: 'COMMENT_NOT_FOUND', message: 'gone' })
    const request = jsonRequest(
      'http://test/api/v1/moderation/comments/comment_123/reject',
      'POST',
      {}
    )

    const response = await commentRejectHandlers.POST({ request, params: { commentId: COMMENT } })

    expect(response.status).toBe(404)
  })
})

describe('GET /api/v1/moderation/posts', () => {
  it('lists pending posts after scope and permission checks', async () => {
    const rows = [{ id: POST, title: 'pending post' }]
    hoisted.listPendingPostsMock.mockResolvedValue({ posts: rows })

    const response = await postsHandlers.GET(args())

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(rows)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.MODERATION_VIEW
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.MODERATION_VIEW
    )
    expect(hoisted.listPendingPostsMock).toHaveBeenCalledTimes(1)
  })

  it('returns 403 before listing when moderation.view permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await postsHandlers.GET(args())

    expect(response.status).toBe(403)
    expect(hoisted.listPendingPostsMock).not.toHaveBeenCalled()
  })

  it('maps domain errors via handleDomainError', async () => {
    hoisted.listPendingPostsMock.mockRejectedValue({ code: 'POST_NOT_FOUND', message: 'gone' })

    const response = await postsHandlers.GET(args())

    expect(response.status).toBe(404)
  })
})

describe('POST /api/v1/moderation/posts/:postId/approve', () => {
  it('approves a post after scope and permission checks', async () => {
    hoisted.approvePostMock.mockResolvedValue(undefined)
    const request = jsonRequest('http://test/api/v1/moderation/posts/post_123/approve', 'POST')

    const response = await postApproveHandlers.POST({ request, params: { postId: POST } })

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual({ ok: true, postId: POST })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.MODERATION_MANAGE
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(POST, 'post', 'post ID')
    expect(hoisted.approvePostMock).toHaveBeenCalledWith(
      POST,
      { role: 'team', type: 'api_key' },
      request.headers
    )
  })

  it('returns 403 before approving when moderation.manage permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await postApproveHandlers.POST(args({ postId: POST }))

    expect(response.status).toBe(403)
    expect(hoisted.approvePostMock).not.toHaveBeenCalled()
  })

  it('maps domain errors via handleDomainError', async () => {
    hoisted.approvePostMock.mockRejectedValue({ code: 'POST_NOT_FOUND', message: 'gone' })

    const response = await postApproveHandlers.POST(args({ postId: POST }))

    expect(response.status).toBe(404)
  })
})

describe('POST /api/v1/moderation/posts/:postId/reject', () => {
  it('rejects a post with a supplied reason', async () => {
    hoisted.rejectPostMock.mockResolvedValue(undefined)
    const request = jsonRequest('http://test/api/v1/moderation/posts/post_123/reject', 'POST', {
      reason: 'off-topic',
    })

    const response = await postRejectHandlers.POST({ request, params: { postId: POST } })

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual({ ok: true, postId: POST })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.MODERATION_MANAGE
    )
    expect(hoisted.rejectPostMock).toHaveBeenCalledWith(
      POST,
      'off-topic',
      { role: 'team', type: 'api_key' },
      request.headers
    )
  })

  it('rejects a post with no body, falling back to an undefined reason', async () => {
    hoisted.rejectPostMock.mockResolvedValue(undefined)
    const request = new Request('http://test/api/v1/moderation/posts/post_123/reject', {
      method: 'POST',
    })

    const response = await postRejectHandlers.POST({ request, params: { postId: POST } })

    expect(response.status).toBe(200)
    expect(hoisted.rejectPostMock).toHaveBeenCalledWith(
      POST,
      undefined,
      { role: 'team', type: 'api_key' },
      request.headers
    )
  })

  it('returns 400 for an invalid reason without calling the service', async () => {
    const request = jsonRequest('http://test/api/v1/moderation/posts/post_123/reject', 'POST', {
      reason: 'x'.repeat(1001),
    })

    const response = await postRejectHandlers.POST({ request, params: { postId: POST } })

    expect(response.status).toBe(400)
    expect(hoisted.rejectPostMock).not.toHaveBeenCalled()
  })

  it('returns 403 before rejecting when moderation.manage permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await postRejectHandlers.POST(args({ postId: POST }))

    expect(response.status).toBe(403)
    expect(hoisted.rejectPostMock).not.toHaveBeenCalled()
  })

  it('maps domain errors via handleDomainError', async () => {
    hoisted.rejectPostMock.mockRejectedValue({ code: 'POST_NOT_FOUND', message: 'gone' })
    const request = jsonRequest('http://test/api/v1/moderation/posts/post_123/reject', 'POST', {})

    const response = await postRejectHandlers.POST({ request, params: { postId: POST } })

    expect(response.status).toBe(404)
  })
})
