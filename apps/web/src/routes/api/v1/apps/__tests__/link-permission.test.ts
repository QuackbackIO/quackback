/**
 * Sidebar apps link and unlink external tickets with the key of the team
 * member who installed them. A member-created key resolves to the Manager
 * preset, so link/unlink must sit at a permission Manager holds, not at an
 * admin-only one. The real withApiKeyAuth runs; only the key lookup, the
 * rate limiter and the link service are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateId } from '@quackback/ids'

const { mockFindFirst, mockLink, mockUnlink } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockLink: vi.fn(),
  mockUnlink: vi.fn(),
}))

vi.mock('@/lib/server/domains/api-keys/api-key.service', () => ({
  verifyApiKey: vi.fn().mockResolvedValue({
    id: 'apikey_01h455vb4pex5vsknk084sn02q',
    principalId: 'principal_01h455vb4pex5vsknk084sn02s',
    scopes: null,
  }),
}))
vi.mock('@/lib/server/domains/api/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: { principal: { findFirst: mockFindFirst } } },
}))
vi.mock('@/lib/server/integrations/apps/service', () => ({
  linkTicketToPost: (...args: unknown[]) => mockLink(...args),
  unlinkTicketFromPost: (...args: unknown[]) => mockUnlink(...args),
}))

type Handler = (ctx: { request: Request }) => Promise<Response>

function postHandler(mod: { Route: { options: unknown } }): Handler {
  return (mod.Route.options as { server: { handlers: { POST: Handler } } }).server.handlers.POST
}

function request(body: unknown) {
  return new Request('http://test/api/v1/apps/link', {
    method: 'POST',
    headers: { authorization: 'Bearer qb_test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const BODY = { postId: generateId('post'), integrationType: 'zendesk', externalId: '42' }

beforeEach(() => {
  vi.clearAllMocks()
  mockLink.mockResolvedValue({ linked: true })
  mockUnlink.mockResolvedValue(undefined)
})

describe.each([
  ['link', () => import('../link'), mockLink],
  ['unlink', () => import('../unlink'), mockUnlink],
])('POST /api/v1/apps/%s', (_name, load, service) => {
  it('accepts a member-created key (Manager preset)', async () => {
    mockFindFirst.mockResolvedValue({ role: 'member', user: null })
    const res = await postHandler(await load())({ request: request(BODY) })
    expect(res.status).toBeLessThan(300)
    expect(service).toHaveBeenCalledOnce()
  })

  it('rejects a key whose principal holds no team role', async () => {
    mockFindFirst.mockResolvedValue({ role: 'user', user: null })
    const res = await postHandler(await load())({ request: request(BODY) })
    expect(res.status).toBe(403)
    expect(service).not.toHaveBeenCalled()
  })
})
