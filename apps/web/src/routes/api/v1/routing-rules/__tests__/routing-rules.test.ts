import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  createRoutingRuleMock: vi.fn(),
  updateRoutingRuleMock: vi.fn(),
  deleteRoutingRuleMock: vi.fn(),
  getRoutingRuleMock: vi.fn(),
  listRoutingRulesMock: vi.fn(),
  reorderRoutingRulesMock: vi.fn(),
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

vi.mock('@/lib/server/domains/inboxes', () => ({
  createRoutingRule: (...args: unknown[]) => hoisted.createRoutingRuleMock(...args),
  updateRoutingRule: (...args: unknown[]) => hoisted.updateRoutingRuleMock(...args),
  deleteRoutingRule: (...args: unknown[]) => hoisted.deleteRoutingRuleMock(...args),
  getRoutingRule: (...args: unknown[]) => hoisted.getRoutingRuleMock(...args),
  listRoutingRules: (...args: unknown[]) => hoisted.listRoutingRulesMock(...args),
  reorderRoutingRules: (...args: unknown[]) => hoisted.reorderRoutingRulesMock(...args),
}))

import { Route as DetailRoute } from '../$ruleId'
import { Route as IndexRoute } from '../index'
import { Route as ReorderRoute } from '../reorder'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const indexHandlers = (IndexRoute as unknown as RouteWithHandlers).options.server.handlers
const detailHandlers = (DetailRoute as unknown as RouteWithHandlers).options.server.handlers
const reorderHandlers = (ReorderRoute as unknown as RouteWithHandlers).options.server.handlers

const PRINCIPAL = 'principal_admin'
const RULE = 'route_rule_123'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/routing-rules')
) {
  return { request, params: handlerParams }
}

function conditions() {
  return {
    match: 'all',
    conditions: [{ field: 'subject', op: 'contains', value: 'urgent' }],
  }
}

function actions() {
  return [{ type: 'assignToInbox', value: 'inbox_urgent' }]
}

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE,
    name: 'Urgent',
    enabled: true,
    priority: 10,
    conditions: conditions(),
    actions: actions(),
    inboxIdScope: null,
    ...overrides,
  }
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
  hoisted.reorderRoutingRulesMock.mockResolvedValue(undefined)
  hoisted.deleteRoutingRuleMock.mockResolvedValue(undefined)
})

describe('/api/v1/routing-rules routes', () => {
  it('lists and creates routing rules after scope and permission checks', async () => {
    const row = rule()
    hoisted.listRoutingRulesMock.mockResolvedValue([row])
    hoisted.createRoutingRuleMock.mockResolvedValue(row)

    const listResponse = await indexHandlers.GET(
      args(
        {},
        new Request('http://test/api/v1/routing-rules?inboxIdScope=workspace&enabledOnly=true')
      )
    )
    expect(listResponse.status).toBe(200)
    expect(await expectJsonData(listResponse)).toEqual([row])
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ROUTING_RULE_MANAGE
    )
    expect(hoisted.listRoutingRulesMock).toHaveBeenCalledWith({
      inboxIdScope: 'workspace',
      enabledOnly: true,
    })

    const createResponse = await indexHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/routing-rules', 'POST', {
          name: 'Urgent',
          description: null,
          priority: 5,
          enabled: true,
          conditions: conditions(),
          actions: actions(),
          inboxIdScope: null,
        })
      )
    )
    expect(createResponse.status).toBe(201)
    expect(hoisted.createRoutingRuleMock).toHaveBeenCalledWith({
      name: 'Urgent',
      description: null,
      priority: 5,
      enabled: true,
      conditions: conditions(),
      actions: actions(),
      inboxIdScope: null,
    })
  })

  it('lists routing rules with omitted and inbox-specific filters', async () => {
    const row = rule()
    hoisted.listRoutingRulesMock.mockResolvedValue([row])

    const defaultResponse = await indexHandlers.GET(
      args({}, new Request('http://test/api/v1/routing-rules'))
    )
    expect(defaultResponse.status).toBe(200)
    expect(hoisted.listRoutingRulesMock).toHaveBeenLastCalledWith({
      inboxIdScope: undefined,
      enabledOnly: false,
    })

    const inboxResponse = await indexHandlers.GET(
      args({}, new Request('http://test/api/v1/routing-rules?inboxIdScope=inbox_support'))
    )
    expect(inboxResponse.status).toBe(200)
    expect(hoisted.listRoutingRulesMock).toHaveBeenLastCalledWith({
      inboxIdScope: 'inbox_support',
      enabledOnly: false,
    })
  })

  it('gets, patches, deletes, and returns not found for a routing rule', async () => {
    const row = rule({ name: 'Priority support' })
    hoisted.getRoutingRuleMock.mockResolvedValueOnce(row).mockResolvedValueOnce(null)
    hoisted.updateRoutingRuleMock.mockResolvedValue(row)

    const getResponse = await detailHandlers.GET(args({ ruleId: RULE }))
    expect(getResponse.status).toBe(200)
    expect(await expectJsonData(getResponse)).toEqual(row)
    expect(hoisted.getRoutingRuleMock).toHaveBeenCalledWith(RULE)

    const notFoundResponse = await detailHandlers.GET(args({ ruleId: RULE }))
    expect(notFoundResponse.status).toBe(404)

    const patchResponse = await detailHandlers.PATCH(
      args(
        { ruleId: RULE },
        jsonRequest('http://test/api/v1/routing-rules/route_rule_123', 'PATCH', {
          name: 'Priority support',
          priority: 1,
          enabled: false,
          conditions: conditions(),
          actions: actions(),
        })
      )
    )
    expect(patchResponse.status).toBe(200)
    expect(hoisted.updateRoutingRuleMock).toHaveBeenCalledWith(
      RULE,
      expect.objectContaining({ name: 'Priority support', priority: 1, enabled: false })
    )

    const deleteResponse = await detailHandlers.DELETE(args({ ruleId: RULE }))
    expect(deleteResponse.status).toBe(204)
    expect(hoisted.deleteRoutingRuleMock).toHaveBeenCalledWith(RULE)
  })

  it('reorders rules and returns an ok response', async () => {
    const response = await reorderHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/routing-rules/reorder', 'POST', {
          orderedIds: ['route_rule_a', 'route_rule_b'],
        })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual({ ok: true })
    expect(hoisted.reorderRoutingRulesMock).toHaveBeenCalledWith(['route_rule_a', 'route_rule_b'])
  })

  it('returns 403 before domain calls when each handler permission check fails', async () => {
    const cases = [
      [indexHandlers.GET, args()],
      [indexHandlers.POST, args({}, jsonRequest('http://test/api/v1/routing-rules', 'POST', {}))],
      [detailHandlers.GET, args({ ruleId: RULE })],
      [
        detailHandlers.PATCH,
        args(
          { ruleId: RULE },
          jsonRequest('http://test/api/v1/routing-rules/route_rule_123', 'PATCH', {})
        ),
      ],
      [detailHandlers.DELETE, args({ ruleId: RULE })],
      [
        reorderHandlers.POST,
        args({}, jsonRequest('http://test/api/v1/routing-rules/reorder', 'POST', {})),
      ],
    ] as const

    for (const [handler, handlerArgs] of cases) {
      hoisted.hasPermissionMock.mockReturnValueOnce(false)
      const response = await handler(handlerArgs)
      expect(response.status).toBe(403)
    }

    expect(hoisted.listRoutingRulesMock).not.toHaveBeenCalled()
    expect(hoisted.createRoutingRuleMock).not.toHaveBeenCalled()
    expect(hoisted.getRoutingRuleMock).not.toHaveBeenCalled()
    expect(hoisted.updateRoutingRuleMock).not.toHaveBeenCalled()
    expect(hoisted.deleteRoutingRuleMock).not.toHaveBeenCalled()
    expect(hoisted.reorderRoutingRulesMock).not.toHaveBeenCalled()
  })

  it('rejects invalid create, patch, and reorder bodies before mutating', async () => {
    const cases = [
      [
        indexHandlers.POST,
        args({}, jsonRequest('http://test/api/v1/routing-rules', 'POST', { name: '' })),
      ],
      [
        detailHandlers.PATCH,
        args(
          { ruleId: RULE },
          jsonRequest('http://test/api/v1/routing-rules/route_rule_123', 'PATCH', {
            priority: -1,
          })
        ),
      ],
      [
        reorderHandlers.POST,
        args(
          {},
          jsonRequest('http://test/api/v1/routing-rules/reorder', 'POST', {
            orderedIds: [],
          })
        ),
      ],
    ] as const

    for (const [handler, handlerArgs] of cases) {
      const response = await handler(handlerArgs)
      expect(response.status).toBe(400)
    }

    expect(hoisted.createRoutingRuleMock).not.toHaveBeenCalled()
    expect(hoisted.updateRoutingRuleMock).not.toHaveBeenCalled()
    expect(hoisted.reorderRoutingRulesMock).not.toHaveBeenCalled()
  })
})
