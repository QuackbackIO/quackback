import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = vi.fn()
const mockList = vi.fn()
const mockAdd = vi.fn()
const mockRemove = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...a: unknown[]) => mockAuth(...a),
}))
vi.mock('@/lib/server/domains/posts/post.subscribers', () => ({
  listPostSubscribers: (...a: unknown[]) => mockList(...a),
  addPostSubscriber: (...a: unknown[]) => mockAdd(...a),
  removePostSubscriber: (...a: unknown[]) => mockRemove(...a),
}))

import { ValidationError } from '@/lib/shared/errors'
import { Route as SubscribersRoute } from '../$postId.subscribers'
import { Route as SubscriberRoute } from '../$postId.subscribers.$principalId'

type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>
const handler = (route: unknown, method: 'GET' | 'POST' | 'DELETE'): Handler =>
  (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers[
    method
  ]

const POST_ID = 'post_01h455vb4pex5vsknk084sn02q'
const ADA_ID = 'principal_01h455vb4pex5vsknk084sn02q'
const BASE = `https://x.test/api/v1/posts/${POST_ID}/subscribers`

const subscriber = {
  principalId: ADA_ID,
  displayName: 'Ada',
  email: 'ada@example.com',
  avatarUrl: null,
  isTeamMember: false,
  reason: 'added',
  level: 'all',
  canView: true,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({
    principalId: 'principal_key',
    role: 'admin',
    permissions: new Set(['post.view_private', 'post.vote_on_behalf']),
  })
  mockList.mockResolvedValue([subscriber])
})

describe('GET /api/v1/posts/:postId/subscribers', () => {
  it('lists subscribers on post.view_private', async () => {
    const res = await handler(
      SubscribersRoute,
      'GET'
    )({ request: new Request(BASE), params: { postId: POST_ID } })
    expect(res.status).toBe(200)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'post.view_private' })
    expect((await res.json()).data).toEqual([
      { ...subscriber, createdAt: '2026-10-01T00:00:00.000Z' },
    ])
    expect(mockList.mock.calls[0][1].principalType).toBe('service')
  })
})

describe('POST /api/v1/posts/:postId/subscribers', () => {
  const post = (body: unknown) =>
    handler(
      SubscribersRoute,
      'POST'
    )({
      request: new Request(BASE, { method: 'POST', body: JSON.stringify(body) }),
      params: { postId: POST_ID },
    })

  it('subscribes on post.vote_on_behalf: 201 when subscribed, 200 when already following', async () => {
    mockAdd.mockResolvedValueOnce({ added: true })
    const created = await post({ principalId: ADA_ID, level: 'status_only' })
    expect(created.status).toBe(201)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), {
      permission: 'post.vote_on_behalf',
    })
    expect(mockAdd).toHaveBeenCalledWith(POST_ID, ADA_ID, expect.anything(), {
      level: 'status_only',
    })

    mockAdd.mockResolvedValueOnce({ added: false })
    expect((await post({ principalId: ADA_ID })).status).toBe(200)
  })

  it('400s a missing or malformed principal before reaching the service', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ principalId: 'nope' })).status).toBe(400)
    expect((await post({ principalId: ADA_ID, level: 'loud' })).status).toBe(400)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('400s someone who cannot see the post', async () => {
    mockAdd.mockRejectedValue(
      new ValidationError('SUBSCRIBER_CANNOT_SEE_POST', 'This person cannot see this post')
    )
    const res = await post({ principalId: ADA_ID })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('cannot see this post')
  })
})

describe('DELETE /api/v1/posts/:postId/subscribers/:principalId', () => {
  it('unsubscribes on post.vote_on_behalf and answers 204', async () => {
    mockRemove.mockResolvedValue({ removed: true })
    const res = await handler(
      SubscriberRoute,
      'DELETE'
    )({
      request: new Request(`${BASE}/${ADA_ID}`, { method: 'DELETE' }),
      params: { postId: POST_ID, principalId: ADA_ID },
    })
    expect(res.status).toBe(204)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), {
      permission: 'post.vote_on_behalf',
    })
    expect(mockRemove).toHaveBeenCalledWith(POST_ID, ADA_ID, expect.anything())
  })
})
