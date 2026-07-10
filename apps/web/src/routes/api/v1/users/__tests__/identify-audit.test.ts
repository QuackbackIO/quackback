/**
 * POST /api/v1/users/identify — verified-email assertion audit.
 *
 * The identify endpoint lets an API key assert `emailVerified: true`, which
 * grants the same portal access as a confirmed address. The route must emit
 * `user.email_verified.asserted` with the API actor when (and only when) the
 * call actually asserted it: created-verified or flipped false -> true.
 * Behavior (response shape/status) is otherwise unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockWithApiKeyAuth = vi.fn()
const mockIdentifyPortalUser = vi.fn()
const mockRecordAuditEvent = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/domains/users/user.identify', () => ({
  identifyPortalUser: (...args: unknown[]) => mockIdentifyPortalUser(...args),
}))
vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (...args: unknown[]) => mockRecordAuditEvent(...args),
}))

import { Route } from '../identify'

type Handlers = { POST: (args: { request: Request }) => Promise<Response> }
type RouteOpts = { server: { handlers: Handlers } }
const { POST } = (Route as unknown as { options: RouteOpts }).options.server.handlers

const AUTH_CONTEXT = {
  apiKey: { id: 'api_key_01jz000000000000000000test' },
  principalId: 'principal_owner',
  role: 'admin',
  principal: {
    userId: 'user_owner',
    user: { email: 'owner@example.com' },
  },
  importMode: false,
}

function identifyResult(overrides: Record<string, unknown>) {
  return {
    principalId: 'principal_target',
    userId: 'user_target',
    name: 'Target',
    email: 'target@example.com',
    image: null,
    emailVerified: false,
    externalId: null,
    attributes: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    created: false,
    emailVerifiedAsserted: false,
    ...overrides,
  }
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://test/api/v1/users/identify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWithApiKeyAuth.mockResolvedValue(AUTH_CONTEXT)
})

describe('POST /api/v1/users/identify — email_verified assertion audit', () => {
  it('audits with the API actor when a user is created verified', async () => {
    mockIdentifyPortalUser.mockResolvedValue(
      identifyResult({ created: true, emailVerified: true, emailVerifiedAsserted: true })
    )

    const res = await POST({
      request: makeRequest({ email: 'target@example.com', emailVerified: true }),
    })

    expect(res.status).toBe(201)
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('user.email_verified.asserted')
    expect(call.actor).toMatchObject({
      userId: 'user_owner',
      email: 'owner@example.com',
      role: 'admin',
      type: 'api_key',
      authMethod: 'api_key',
    })
    expect(call.target).toEqual({ type: 'user', id: 'user_target' })
    expect(call.before).toBeNull()
    expect(call.after).toEqual({ emailVerified: true })
    expect(call.metadata).toMatchObject({
      source: 'api.users.identify',
      apiKeyId: AUTH_CONTEXT.apiKey.id,
      created: true,
    })
  })

  it('audits a false -> true flip on an existing user with before/after values', async () => {
    mockIdentifyPortalUser.mockResolvedValue(
      identifyResult({ created: false, emailVerified: true, emailVerifiedAsserted: true })
    )

    const res = await POST({
      request: makeRequest({ email: 'target@example.com', emailVerified: true }),
    })

    expect(res.status).toBe(200)
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('user.email_verified.asserted')
    expect(call.before).toEqual({ emailVerified: false })
    expect(call.after).toEqual({ emailVerified: true })
    expect(call.metadata).toMatchObject({ created: false })
  })

  it('does not audit when nothing was asserted (already-verified no-op)', async () => {
    mockIdentifyPortalUser.mockResolvedValue(
      identifyResult({ emailVerified: true, emailVerifiedAsserted: false })
    )

    const res = await POST({
      request: makeRequest({ email: 'target@example.com', emailVerified: true }),
    })

    expect(res.status).toBe(200)
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('does not audit a plain identify without emailVerified', async () => {
    mockIdentifyPortalUser.mockResolvedValue(identifyResult({}))

    const res = await POST({ request: makeRequest({ email: 'target@example.com' }) })

    expect(res.status).toBe(200)
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })
})
