/**
 * Differential-coverage tests for GET /api/widget/session — no-session 401,
 * anonymous vs linked-user projection, and the failure 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ getWidgetSession: vi.fn() }))
vi.mock('@/lib/server/functions/widget-auth', () => ({
  getWidgetSession: (...a: unknown[]) => m.getWidgetSession(...a),
}))
vi.mock('@/lib/server/logger', () => ({ logger: { child: () => ({ error: vi.fn() }) } }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({ options: cfg }),
}))

import { Route } from '../session'

type RouteShape = { options: { server: { handlers: { GET: () => Promise<Response> } } } }
const GET = (Route as unknown as RouteShape).options.server.handlers.GET

beforeEach(() => vi.clearAllMocks())

describe('widget session GET', () => {
  it('401s when there is no session', async () => {
    m.getWidgetSession.mockResolvedValueOnce(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })
  it('returns a null user for an anonymous session', async () => {
    m.getWidgetSession.mockResolvedValueOnce({
      principal: { type: 'anonymous' },
      user: {},
      contactId: null,
    })
    const body = await (await GET()).json()
    expect(body.data.user).toBeNull()
    expect(body.data.contactLinked).toBe(false)
  })
  it('returns user data + contactLinked for a linked user', async () => {
    m.getWidgetSession.mockResolvedValueOnce({
      principal: { type: 'user' },
      user: { id: 'u1', name: 'Jane', email: 'j@x.test', image: null },
      contactId: 'c1',
    })
    const body = await (await GET()).json()
    expect(body.data.user).toMatchObject({ id: 'u1' })
    expect(body.data.contactLinked).toBe(true)
  })
  it('500s when session load throws', async () => {
    m.getWidgetSession.mockRejectedValueOnce(new Error('boom'))
    expect((await GET()).status).toBe(500)
  })
})
