/**
 * The sidebar apps call /api/v1/apps/* from iframes on other origins, so an
 * error answer needs the CORS headers as much as a success does: without
 * them the browser hides the status and body from the app, and a bad key or
 * a bad request reads as a network failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UnauthorizedError } from '@/lib/shared/errors'

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockAuth(...args),
}))

type Handler = (ctx: { request: Request }) => Promise<Response>
type Method = 'GET' | 'POST'

const ROUTES: [string, Method, () => Promise<{ Route: { options: unknown } }>][] = [
  ['boards', 'GET', () => import('../boards')],
  ['linked', 'GET', () => import('../linked')],
  ['link', 'POST', () => import('../link')],
  ['posts', 'POST', () => import('../posts')],
  ['search', 'GET', () => import('../search')],
  ['suggest', 'GET', () => import('../suggest')],
  ['unlink', 'POST', () => import('../unlink')],
]

async function call(name: string, method: Method, load: (typeof ROUTES)[number][2]) {
  const mod = await load()
  const handler = (mod.Route.options as { server: { handlers: Record<Method, Handler> } }).server
    .handlers[method]
  return handler({
    request: new Request(`http://test/api/v1/apps/${name}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/api/v1/apps/* error responses carry CORS headers', () => {
  it.each(ROUTES)('%s: a 401 for a bad key', async (name, method, load) => {
    mockAuth.mockRejectedValue(new UnauthorizedError('Invalid or missing API key'))

    const res = await call(name, method, load)

    expect(res.status).toBe(401)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('www-authenticate')).toContain('Bearer')
  })

  it.each(ROUTES.filter(([name]) => !['boards', 'search'].includes(name)))(
    '%s: a 400 for a bad request',
    async (name, method, load) => {
      mockAuth.mockResolvedValue({ principalId: 'principal_test', role: 'admin' })

      const res = await call(name, method, load)

      expect(res.status).toBe(400)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    }
  )
})
