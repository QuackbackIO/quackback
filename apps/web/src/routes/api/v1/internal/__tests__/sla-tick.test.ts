import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  runEscalationTickMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/sla', () => ({
  runEscalationTick: (...args: unknown[]) => hoisted.runEscalationTickMock(...args),
}))

import { Route } from '../sla-tick'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const handlers = (Route as unknown as RouteWithHandlers).options.server.handlers
const originalSecret = process.env.INTERNAL_TASK_SECRET

function jsonRequest(body?: unknown, secret?: string) {
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  if (secret !== undefined) headers.set('x-internal-secret', secret)

  return new Request('http://test/api/v1/internal/sla-tick', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function rawRequest(body: string, secret: string) {
  return new Request('http://test/api/v1/internal/sla-tick', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': secret,
    },
    body,
  })
}

async function post(request: Request) {
  return handlers.POST({ request, params: {} })
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_TASK_SECRET = 'secret_test'
  hoisted.runEscalationTickMock.mockResolvedValue({
    considered: 2,
    breached: 1,
    escalated: 1,
  })
})

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.INTERNAL_TASK_SECRET
  } else {
    process.env.INTERNAL_TASK_SECRET = originalSecret
  }
})

describe('/api/v1/internal/sla-tick', () => {
  it('rejects requests when the internal secret is not configured', async () => {
    delete process.env.INTERNAL_TASK_SECRET

    const response = await post(jsonRequest({ batchSize: 10 }, 'secret_test'))

    expect(response.status).toBe(403)
    expect(await body(response)).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'INTERNAL_TASK_SECRET is not configured',
      },
    })
    expect(hoisted.runEscalationTickMock).not.toHaveBeenCalled()
  })

  it('rejects missing and invalid internal secrets', async () => {
    const missing = await post(jsonRequest({ batchSize: 10 }))
    const invalid = await post(jsonRequest({ batchSize: 10 }, 'wrong_secret'))

    expect(missing.status).toBe(403)
    expect(await body(missing)).toEqual({
      error: { code: 'FORBIDDEN', message: 'Invalid internal secret' },
    })
    expect(invalid.status).toBe(403)
    expect(await body(invalid)).toEqual({
      error: { code: 'FORBIDDEN', message: 'Invalid internal secret' },
    })
    expect(hoisted.runEscalationTickMock).not.toHaveBeenCalled()
  })

  it('runs the escalation tick with a parsed batch size', async () => {
    const response = await post(jsonRequest({ batchSize: 25 }, 'secret_test'))

    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({
      data: {
        considered: 2,
        breached: 1,
        escalated: 1,
      },
    })
    expect(hoisted.runEscalationTickMock).toHaveBeenCalledWith({ batchSize: 25 })
  })

  it('runs the escalation tick without a batch size when the body is absent or invalid', async () => {
    const empty = await post(jsonRequest(undefined, 'secret_test'))
    const invalid = await post(rawRequest('{', 'secret_test'))

    expect(empty.status).toBe(200)
    expect(invalid.status).toBe(200)
    expect(hoisted.runEscalationTickMock).toHaveBeenNthCalledWith(1, { batchSize: undefined })
    expect(hoisted.runEscalationTickMock).toHaveBeenNthCalledWith(2, { batchSize: undefined })
  })

  it('maps escalation service failures through the API error envelope', async () => {
    hoisted.runEscalationTickMock.mockRejectedValueOnce(new Error('boom'))

    const response = await post(jsonRequest({ batchSize: 1 }, 'secret_test'))

    expect(response.status).toBe(500)
    expect(await body(response)).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
