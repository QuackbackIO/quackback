import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getEffectiveTabConfigForUserMock: vi.fn(),
  setOrgPortalTabConfigMock: vi.fn(),
  principalFindFirstMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/auth/session', () => ({
  getSession: (...args: unknown[]) => hoisted.getSessionMock(...args),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (...args: unknown[]) => hoisted.loggerErrorMock(...args),
      warn: (...args: unknown[]) => hoisted.loggerWarnMock(...args),
    }),
  },
}))

vi.mock('@/lib/server/domains/portal/index.server', () => ({
  getEffectiveTabConfigForUser: (...args: unknown[]) =>
    hoisted.getEffectiveTabConfigForUserMock(...args),
  setOrgPortalTabConfig: (...args: unknown[]) => hoisted.setOrgPortalTabConfigMock(...args),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: {
        findFirst: (...args: unknown[]) => hoisted.principalFindFirstMock(...args),
      },
    },
  },
  principal: { userId: 'principal.userId' },
  eq: vi.fn((column, value) => ({ kind: 'eq', column, value })),
}))

import { Route } from '../portal-tabs'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const handlers = (Route as unknown as RouteWithHandlers).options.server.handlers

function jsonRequest(body?: unknown) {
  return new Request('http://test/api/v1/internal/portal-tabs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.getSessionMock.mockResolvedValue({ user: { id: 'user_admin' } })
  hoisted.getEffectiveTabConfigForUserMock.mockResolvedValue({
    feedback: true,
    roadmap: false,
    changelog: true,
    myTickets: true,
    helpCenter: true,
    support: false,
  })
  hoisted.setOrgPortalTabConfigMock.mockResolvedValue(undefined)
  hoisted.principalFindFirstMock.mockResolvedValue({ role: 'admin' })
})

describe('/api/v1/internal/portal-tabs', () => {
  it('returns the effective portal tab config for the signed-in user', async () => {
    const response = await handlers.GET({
      request: new Request('http://test/api/v1/internal/portal-tabs'),
      params: {},
    })

    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({
      config: {
        feedback: true,
        roadmap: false,
        changelog: true,
        myTickets: true,
        helpCenter: true,
        support: false,
      },
    })
    expect(hoisted.getEffectiveTabConfigForUserMock).toHaveBeenCalledWith('user_admin')
  })

  it('rejects GET and POST when there is no signed-in user', async () => {
    hoisted.getSessionMock.mockResolvedValue(null)

    const getResponse = await handlers.GET({
      request: new Request('http://test/api/v1/internal/portal-tabs'),
      params: {},
    })
    const postResponse = await handlers.POST({
      request: jsonRequest({ config: { feedback: true } }),
      params: {},
    })

    expect(getResponse.status).toBe(401)
    expect(postResponse.status).toBe(401)
    expect(hoisted.setOrgPortalTabConfigMock).not.toHaveBeenCalled()
  })

  it('requires an admin principal to update org portal tabs', async () => {
    hoisted.principalFindFirstMock.mockResolvedValue({ role: 'member' })

    const response = await handlers.POST({
      request: jsonRequest({ config: { feedback: true } }),
      params: {},
    })

    expect(response.status).toBe(403)
    expect(await body(response)).toEqual({ error: 'Forbidden: Admin only' })
    expect(hoisted.setOrgPortalTabConfigMock).not.toHaveBeenCalled()
  })

  it('updates org portal tabs with a validated config and rejects invalid configs', async () => {
    const response = await handlers.POST({
      request: jsonRequest({
        config: {
          feedback: false,
          roadmap: true,
          changelog: true,
          myTickets: false,
          helpCenter: true,
          support: true,
        },
      }),
      params: {},
    })

    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({
      config: {
        feedback: false,
        roadmap: true,
        changelog: true,
        myTickets: false,
        helpCenter: true,
        support: true,
      },
    })
    expect(hoisted.setOrgPortalTabConfigMock).toHaveBeenCalledWith({
      feedback: false,
      roadmap: true,
      changelog: true,
      myTickets: false,
      helpCenter: true,
      support: true,
    })

    const invalid = await handlers.POST({
      request: jsonRequest({ config: { feedback: 'yes' } }),
      params: {},
    })
    expect(invalid.status).toBe(400)
    expect(await body(invalid)).toEqual({ error: 'Invalid configuration' })
    expect(hoisted.loggerWarnMock).toHaveBeenCalled()
  })

  it('updates org portal tabs with an empty config when config is omitted', async () => {
    const response = await handlers.POST({
      request: jsonRequest({}),
      params: {},
    })

    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({ config: {} })
    expect(hoisted.setOrgPortalTabConfigMock).toHaveBeenCalledWith({})
  })

  it('logs and returns 500 for unexpected read and write failures', async () => {
    hoisted.getEffectiveTabConfigForUserMock.mockRejectedValueOnce(new Error('read failed'))
    const getResponse = await handlers.GET({
      request: new Request('http://test/api/v1/internal/portal-tabs'),
      params: {},
    })
    expect(getResponse.status).toBe(500)

    hoisted.setOrgPortalTabConfigMock.mockRejectedValueOnce(new Error('write failed'))
    const postResponse = await handlers.POST({
      request: jsonRequest({ config: { feedback: true } }),
      params: {},
    })
    expect(postResponse.status).toBe(500)
    expect(hoisted.loggerErrorMock).toHaveBeenCalledTimes(2)
  })
})
