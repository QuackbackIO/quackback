/**
 * POST /api/v1/users/identify and a person's language: `language` is the
 * person's language in the caller's app and reaches the identify as the
 * detected language only; nothing an API key sends sets the language the
 * person chose. The answer carries both.
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

const LANGUAGE = { chosen: 'nl', detected: 'de' }

function post(body: Record<string, unknown>): Promise<Response> {
  return POST({
    request: new Request('http://test/api/v1/users/identify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
}

describe('POST /api/v1/users/identify language', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWithApiKeyAuth.mockResolvedValue(AUTH_CONTEXT)
    mockIdentifyPortalUser.mockResolvedValue({
      principalId: 'principal_target',
      userId: 'user_target',
      name: 'Target',
      email: 'target@example.com',
      image: null,
      emailVerified: false,
      externalId: null,
      attributes: {},
      createdAt: new Date('2026-01-01T00:00:00Z'),
      language: LANGUAGE,
      created: false,
      emailVerifiedAsserted: false,
    })
  })

  it('passes the language on as the detected language and answers with both', async () => {
    const res = await post({ email: 'target@example.com', language: 'de-DE' })
    expect(res.status).toBe(200)
    expect(mockIdentifyPortalUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'target@example.com', language: 'de-DE' })
    )
    const body = (await res.json()) as { data: { language: unknown } }
    expect(body.data.language).toEqual(LANGUAGE)
  })

  it('never passes on a chosen language, whatever the key sends', async () => {
    await post({
      email: 'target@example.com',
      preferredLanguage: 'fr',
      chosen: 'fr',
      language: 'pl',
    })
    const input = mockIdentifyPortalUser.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(input).sort()).toEqual(['email', 'language'])
  })

  it('refuses a language that is not a tag', async () => {
    const res = await post({ email: 'target@example.com', language: { chosen: 'de' } })
    expect(res.status).toBe(400)
    expect(mockIdentifyPortalUser).not.toHaveBeenCalled()
  })
})
