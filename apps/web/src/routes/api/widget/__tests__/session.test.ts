/**
 * GET /api/widget/session: the widget's mount-time session check. A missing
 * session is a 401; a failure loading it is a 500 SERVER_ERROR, never an
 * unhandled throw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let sessionImpl: (opts: unknown) => Promise<unknown> = async () => null
const calls: unknown[] = []

vi.mock('@/lib/server/functions/widget-auth', () => ({
  getWidgetSession: (opts: unknown) => {
    calls.push(opts)
    return sessionImpl(opts)
  },
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ error: () => {}, info: () => {}, warn: () => {}, debug: () => {} }) },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
}))

import { Route } from '../session'

const GET = (
  Route as unknown as { options: { server: { handlers: { GET: () => Promise<Response> } } } }
).options.server.handlers.GET

describe('GET /api/widget/session', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('answers 500 SERVER_ERROR when loading the session fails', async () => {
    sessionImpl = async () => {
      throw new Error('db down')
    }
    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: { code: 'SERVER_ERROR', message: 'Failed to load widget session' },
    })
  })

  it('answers 401 AUTH_REQUIRED without a valid session, and rolls the session when there is one', async () => {
    sessionImpl = async () => null
    const res = await GET()
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('AUTH_REQUIRED')
    expect(calls).toEqual([{ roll: true }])
  })
})
