import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

// Hoisted mock functions for every dependency the SLA policy routes touch.
const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  // sla domain service functions
  listSlaPoliciesMock: vi.fn(),
  createSlaPolicyMock: vi.fn(),
  getSlaPolicyMock: vi.fn(),
  updateSlaPolicyMock: vi.fn(),
  archiveSlaPolicyMock: vi.fn(),
  listTargetsForPolicyMock: vi.fn(),
  replaceTargetsMock: vi.fn(),
  listEscalationRulesForPolicyMock: vi.fn(),
  createEscalationRuleMock: vi.fn(),
  updateEscalationRuleMock: vi.fn(),
  deleteEscalationRuleMock: vi.fn(),
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

vi.mock('@/lib/server/domains/sla', () => ({
  listSlaPolicies: (...args: unknown[]) => hoisted.listSlaPoliciesMock(...args),
  createSlaPolicy: (...args: unknown[]) => hoisted.createSlaPolicyMock(...args),
  getSlaPolicy: (...args: unknown[]) => hoisted.getSlaPolicyMock(...args),
  updateSlaPolicy: (...args: unknown[]) => hoisted.updateSlaPolicyMock(...args),
  archiveSlaPolicy: (...args: unknown[]) => hoisted.archiveSlaPolicyMock(...args),
  listTargetsForPolicy: (...args: unknown[]) => hoisted.listTargetsForPolicyMock(...args),
  replaceTargets: (...args: unknown[]) => hoisted.replaceTargetsMock(...args),
  listEscalationRulesForPolicy: (...args: unknown[]) =>
    hoisted.listEscalationRulesForPolicyMock(...args),
  createEscalationRule: (...args: unknown[]) => hoisted.createEscalationRuleMock(...args),
  updateEscalationRule: (...args: unknown[]) => hoisted.updateEscalationRuleMock(...args),
  deleteEscalationRule: (...args: unknown[]) => hoisted.deleteEscalationRuleMock(...args),
}))

// The routes only import enum constants from the db module, so mock just those.
vi.mock('@/lib/server/db', () => ({
  SLA_POLICY_SCOPES: ['workspace', 'team', 'inbox'],
  TICKET_PRIORITIES: ['low', 'normal', 'high', 'urgent'],
  SLA_TARGET_KINDS: ['first_response', 'next_response', 'resolution'],
  ESCALATION_RECIPIENT_TYPES: ['assignee', 'team', 'principals', 'inbox_members'],
  ESCALATION_CHANNELS: ['in_app', 'email', 'webhook'],
}))

import { Route as PolicyDetailRoute } from '../$policyId'
import { Route as EscalationRuleDetailRoute } from '../$policyId.escalation-rules.$ruleId'
import { Route as EscalationRulesRoute } from '../$policyId.escalation-rules'
import { Route as TargetsRoute } from '../$policyId.targets'
import { Route as PoliciesRoute } from '../index'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const policyHandlers = (PoliciesRoute as unknown as RouteWithHandlers).options.server.handlers
const policyDetailHandlers = (PolicyDetailRoute as unknown as RouteWithHandlers).options.server
  .handlers
const targetHandlers = (TargetsRoute as unknown as RouteWithHandlers).options.server.handlers
const escalationRulesHandlers = (EscalationRulesRoute as unknown as RouteWithHandlers).options
  .server.handlers
const escalationRuleDetailHandlers = (EscalationRuleDetailRoute as unknown as RouteWithHandlers)
  .options.server.handlers

const PRINCIPAL = 'principal_admin'
const POLICY = 'sla_pol_123'
const RULE = 'esc_rule_123'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/sla-policies')
) {
  return { request, params: handlerParams }
}

function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: POLICY,
    name: 'Standard SLA',
    description: null,
    priority: 0,
    enabled: true,
    scope: 'workspace',
    ...overrides,
  }
}

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sla_tgt_123',
    policyId: POLICY,
    kind: 'first_response',
    minutes: 60,
    ...overrides,
  }
}

function escalationRule(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE,
    policyId: POLICY,
    name: 'Escalate to lead',
    leadMinutes: 15,
    targetKind: 'resolution',
    recipientType: 'team',
    enabled: true,
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
})

describe('/api/v1/sla-policies index route', () => {
  it('lists policies and forwards the includeArchived=true query toggle', async () => {
    const rows = [policy()]
    hoisted.listSlaPoliciesMock.mockResolvedValue(rows)

    const response = await policyHandlers.GET(
      args({}, new Request('http://test/api/v1/sla-policies?includeArchived=true'))
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(rows)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SLA_VIEW
    )
    expect(hoisted.listSlaPoliciesMock).toHaveBeenCalledWith({ includeArchived: true })
  })

  it('lists policies with includeArchived=false when the query param is absent', async () => {
    hoisted.listSlaPoliciesMock.mockResolvedValue([])

    const response = await policyHandlers.GET(args())

    expect(response.status).toBe(200)
    expect(hoisted.listSlaPoliciesMock).toHaveBeenCalledWith({ includeArchived: false })
  })

  it('returns 403 when the caller lacks sla.view on list', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await policyHandlers.GET(args())

    expect(response.status).toBe(403)
    expect(hoisted.listSlaPoliciesMock).not.toHaveBeenCalled()
  })

  it('creates a policy with the full optional payload', async () => {
    const row = policy()
    hoisted.createSlaPolicyMock.mockResolvedValue(row)

    const response = await policyHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/sla-policies', 'POST', {
          name: 'Standard SLA',
          description: 'Workspace default',
          priority: 1,
          enabled: true,
          scope: 'team',
          scopeTeamId: 'team_1',
          scopeInboxId: null,
          appliesToPriorities: ['high', 'urgent'],
          businessHoursId: 'bh_1',
          pauseOnPending: true,
          pauseOnOnHold: false,
        })
      )
    )

    expect(response.status).toBe(201)
    expect(await expectJsonData(response)).toEqual(row)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SLA_MANAGE
    )
    expect(hoisted.createSlaPolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Standard SLA', scope: 'team', priority: 1 })
    )
  })

  it('creates a policy with only the required fields', async () => {
    const row = policy()
    hoisted.createSlaPolicyMock.mockResolvedValue(row)

    const response = await policyHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/sla-policies', 'POST', {
          name: 'Minimal',
          scope: 'workspace',
        })
      )
    )

    expect(response.status).toBe(201)
    expect(hoisted.createSlaPolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Minimal', scope: 'workspace' })
    )
  })

  it('returns 403 when the caller lacks sla.manage on create', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await policyHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/sla-policies', 'POST', { name: 'x', scope: 'workspace' })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.createSlaPolicyMock).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid create body and never calls the service', async () => {
    const response = await policyHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/sla-policies', 'POST', {
          name: '',
          scope: 'invalid-scope',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.createSlaPolicyMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the create body is not valid JSON (null body)', async () => {
    // request.json() rejects, the .catch(() => null) feeds null into safeParse.
    const response = await policyHandlers.POST(
      args(
        {},
        new Request('http://test/api/v1/sla-policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not-json',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.createSlaPolicyMock).not.toHaveBeenCalled()
  })

  it('routes a thrown domain error through handleDomainError on list', async () => {
    hoisted.listSlaPoliciesMock.mockRejectedValue(new Error('boom'))

    const response = await policyHandlers.GET(args())

    expect(response.status).toBe(500)
  })

  it('routes a thrown domain error through handleDomainError on create', async () => {
    hoisted.createSlaPolicyMock.mockRejectedValue(new Error('boom'))

    const response = await policyHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/sla-policies', 'POST', {
          name: 'Standard SLA',
          scope: 'workspace',
        })
      )
    )

    expect(response.status).toBe(500)
  })
})

describe('/api/v1/sla-policies/$policyId route', () => {
  it('gets a policy with its targets and escalations', async () => {
    const policyRow = policy()
    const targets = [target()]
    const escalations = [escalationRule()]
    hoisted.getSlaPolicyMock.mockResolvedValue(policyRow)
    hoisted.listTargetsForPolicyMock.mockResolvedValue(targets)
    hoisted.listEscalationRulesForPolicyMock.mockResolvedValue(escalations)

    const response = await policyDetailHandlers.GET(args({ policyId: POLICY }))

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual({ policy: policyRow, targets, escalations })
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(POLICY, 'sla_pol', 'policy ID')
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SLA_VIEW
    )
    expect(hoisted.getSlaPolicyMock).toHaveBeenCalledWith(POLICY)
    expect(hoisted.listTargetsForPolicyMock).toHaveBeenCalledWith(POLICY)
    expect(hoisted.listEscalationRulesForPolicyMock).toHaveBeenCalledWith(POLICY)
  })

  it('returns 404 when the policy does not exist and skips the follow-up lookups', async () => {
    hoisted.getSlaPolicyMock.mockResolvedValue(null)

    const response = await policyDetailHandlers.GET(args({ policyId: POLICY }))

    expect(response.status).toBe(404)
    expect(hoisted.listTargetsForPolicyMock).not.toHaveBeenCalled()
    expect(hoisted.listEscalationRulesForPolicyMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller lacks sla.view on get', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await policyDetailHandlers.GET(args({ policyId: POLICY }))

    expect(response.status).toBe(403)
    expect(hoisted.getSlaPolicyMock).not.toHaveBeenCalled()
  })

  it('patches a policy', async () => {
    const updated = policy({ name: 'Updated' })
    hoisted.updateSlaPolicyMock.mockResolvedValue(updated)

    const response = await policyDetailHandlers.PATCH(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123', 'PATCH', {
          name: 'Updated',
          description: null,
          priority: 5,
          enabled: false,
          appliesToPriorities: ['low'],
          businessHoursId: null,
          pauseOnPending: false,
          pauseOnOnHold: true,
        })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(updated)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SLA_MANAGE
    )
    expect(hoisted.updateSlaPolicyMock).toHaveBeenCalledWith(
      POLICY,
      expect.objectContaining({ name: 'Updated', priority: 5 })
    )
  })

  it('returns 403 when the caller lacks sla.manage on patch', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await policyDetailHandlers.PATCH(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123', 'PATCH', { name: 'x' })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.updateSlaPolicyMock).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid patch body', async () => {
    const response = await policyDetailHandlers.PATCH(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123', 'PATCH', { name: '' })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.updateSlaPolicyMock).not.toHaveBeenCalled()
  })

  it('archives (deletes) a policy with 204', async () => {
    hoisted.archiveSlaPolicyMock.mockResolvedValue(undefined)

    const response = await policyDetailHandlers.DELETE(args({ policyId: POLICY }))

    expect(response.status).toBe(204)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SLA_MANAGE
    )
    expect(hoisted.archiveSlaPolicyMock).toHaveBeenCalledWith(POLICY)
  })

  it('returns 403 when the caller lacks sla.manage on delete', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await policyDetailHandlers.DELETE(args({ policyId: POLICY }))

    expect(response.status).toBe(403)
    expect(hoisted.archiveSlaPolicyMock).not.toHaveBeenCalled()
  })

  it('routes a thrown domain error through handleDomainError on get', async () => {
    hoisted.getSlaPolicyMock.mockRejectedValue(new Error('boom'))

    const response = await policyDetailHandlers.GET(args({ policyId: POLICY }))

    expect(response.status).toBe(500)
  })

  it('routes a thrown domain error through handleDomainError on patch', async () => {
    hoisted.updateSlaPolicyMock.mockRejectedValue(new Error('boom'))

    const response = await policyDetailHandlers.PATCH(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123', 'PATCH', { name: 'x' })
      )
    )

    expect(response.status).toBe(500)
  })

  it('routes a thrown domain error through handleDomainError on delete', async () => {
    hoisted.archiveSlaPolicyMock.mockRejectedValue(new Error('boom'))

    const response = await policyDetailHandlers.DELETE(args({ policyId: POLICY }))

    expect(response.status).toBe(500)
  })
})

describe('/api/v1/sla-policies/$policyId/targets route', () => {
  it('lists targets for a policy', async () => {
    const targets = [target()]
    hoisted.listTargetsForPolicyMock.mockResolvedValue(targets)

    const response = await targetHandlers.GET(args({ policyId: POLICY }))

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(targets)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SLA_VIEW
    )
    expect(hoisted.listTargetsForPolicyMock).toHaveBeenCalledWith(POLICY)
  })

  it('returns 403 when the caller lacks sla.view on target list', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await targetHandlers.GET(args({ policyId: POLICY }))

    expect(response.status).toBe(403)
    expect(hoisted.listTargetsForPolicyMock).not.toHaveBeenCalled()
  })

  it('replaces the target set via PUT', async () => {
    const replaced = [target(), target({ id: 'sla_tgt_456', kind: 'resolution', minutes: 480 })]
    hoisted.replaceTargetsMock.mockResolvedValue(replaced)

    const response = await targetHandlers.PUT(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123/targets', 'PUT', {
          targets: [
            { kind: 'first_response', minutes: 60 },
            { kind: 'resolution', minutes: 480 },
          ],
        })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(replaced)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SLA_MANAGE
    )
    expect(hoisted.replaceTargetsMock).toHaveBeenCalledWith(POLICY, [
      { kind: 'first_response', minutes: 60 },
      { kind: 'resolution', minutes: 480 },
    ])
  })

  it('replaces with an empty target set', async () => {
    hoisted.replaceTargetsMock.mockResolvedValue([])

    const response = await targetHandlers.PUT(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123/targets', 'PUT', { targets: [] })
      )
    )

    expect(response.status).toBe(200)
    expect(hoisted.replaceTargetsMock).toHaveBeenCalledWith(POLICY, [])
  })

  it('returns 403 when the caller lacks sla.manage on PUT', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await targetHandlers.PUT(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123/targets', 'PUT', { targets: [] })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.replaceTargetsMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the PUT body is invalid (non-positive minutes)', async () => {
    const response = await targetHandlers.PUT(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123/targets', 'PUT', {
          targets: [{ kind: 'first_response', minutes: 0 }],
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.replaceTargetsMock).not.toHaveBeenCalled()
  })

  it('routes a thrown domain error through handleDomainError on target list', async () => {
    hoisted.listTargetsForPolicyMock.mockRejectedValue(new Error('boom'))

    const response = await targetHandlers.GET(args({ policyId: POLICY }))

    expect(response.status).toBe(500)
  })

  it('routes a thrown domain error through handleDomainError on target replace', async () => {
    hoisted.replaceTargetsMock.mockRejectedValue(new Error('boom'))

    const response = await targetHandlers.PUT(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123/targets', 'PUT', { targets: [] })
      )
    )

    expect(response.status).toBe(500)
  })
})

describe('/api/v1/sla-policies/$policyId/escalation-rules route', () => {
  it('lists escalation rules for a policy', async () => {
    const rules = [escalationRule()]
    hoisted.listEscalationRulesForPolicyMock.mockResolvedValue(rules)

    const response = await escalationRulesHandlers.GET(args({ policyId: POLICY }))

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(rules)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SLA_VIEW
    )
    expect(hoisted.listEscalationRulesForPolicyMock).toHaveBeenCalledWith(POLICY)
  })

  it('returns 403 when the caller lacks sla.view on escalation list', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await escalationRulesHandlers.GET(args({ policyId: POLICY }))

    expect(response.status).toBe(403)
    expect(hoisted.listEscalationRulesForPolicyMock).not.toHaveBeenCalled()
  })

  it('creates an escalation rule with the full optional payload and injects policyId', async () => {
    const row = escalationRule()
    hoisted.createEscalationRuleMock.mockResolvedValue(row)

    const response = await escalationRulesHandlers.POST(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123/escalation-rules', 'POST', {
          name: 'Escalate to lead',
          leadMinutes: 15,
          targetKind: 'resolution',
          recipientType: 'principals',
          recipientTeamId: null,
          recipientPrincipalIds: ['principal_lead'],
          channels: ['in_app', 'email'],
          enabled: true,
        })
      )
    )

    expect(response.status).toBe(201)
    expect(await expectJsonData(response)).toEqual(row)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ESCALATION_RULE_MANAGE
    )
    expect(hoisted.createEscalationRuleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Escalate to lead',
        leadMinutes: 15,
        targetKind: 'resolution',
        recipientType: 'principals',
        policyId: POLICY,
      })
    )
  })

  it('creates an escalation rule with only the required fields', async () => {
    const row = escalationRule()
    hoisted.createEscalationRuleMock.mockResolvedValue(row)

    const response = await escalationRulesHandlers.POST(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123/escalation-rules', 'POST', {
          name: 'Minimal rule',
          leadMinutes: 0,
          targetKind: 'first_response',
          recipientType: 'assignee',
        })
      )
    )

    expect(response.status).toBe(201)
    expect(hoisted.createEscalationRuleMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Minimal rule', policyId: POLICY })
    )
  })

  it('returns 403 when the caller lacks escalation.rule_manage on create', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await escalationRulesHandlers.POST(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123/escalation-rules', 'POST', {
          name: 'x',
          leadMinutes: 1,
          targetKind: 'resolution',
          recipientType: 'team',
        })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.createEscalationRuleMock).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid escalation create body', async () => {
    const response = await escalationRulesHandlers.POST(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123/escalation-rules', 'POST', {
          name: '',
          leadMinutes: 1,
          targetKind: 'not-a-kind',
          recipientType: 'team',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.createEscalationRuleMock).not.toHaveBeenCalled()
  })

  it('routes a thrown domain error through handleDomainError on escalation list', async () => {
    hoisted.listEscalationRulesForPolicyMock.mockRejectedValue(new Error('boom'))

    const response = await escalationRulesHandlers.GET(args({ policyId: POLICY }))

    expect(response.status).toBe(500)
  })

  it('routes a thrown domain error through handleDomainError on escalation create', async () => {
    hoisted.createEscalationRuleMock.mockRejectedValue(new Error('boom'))

    const response = await escalationRulesHandlers.POST(
      args(
        { policyId: POLICY },
        jsonRequest('http://test/api/v1/sla-policies/sla_pol_123/escalation-rules', 'POST', {
          name: 'Minimal rule',
          leadMinutes: 0,
          targetKind: 'first_response',
          recipientType: 'assignee',
        })
      )
    )

    expect(response.status).toBe(500)
  })
})

describe('/api/v1/sla-policies/$policyId/escalation-rules/$ruleId route', () => {
  it('patches an escalation rule', async () => {
    const updated = escalationRule({ name: 'Updated rule' })
    hoisted.updateEscalationRuleMock.mockResolvedValue(updated)

    const response = await escalationRuleDetailHandlers.PATCH(
      args(
        { policyId: POLICY, ruleId: RULE },
        jsonRequest(
          'http://test/api/v1/sla-policies/sla_pol_123/escalation-rules/esc_rule_123',
          'PATCH',
          {
            name: 'Updated rule',
            leadMinutes: 30,
            targetKind: 'next_response',
            recipientType: 'inbox_members',
            recipientTeamId: null,
            recipientPrincipalIds: ['principal_x'],
            channels: ['webhook'],
            enabled: false,
          }
        )
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(updated)
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(RULE, 'esc_rule', 'rule ID')
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ESCALATION_RULE_MANAGE
    )
    expect(hoisted.updateEscalationRuleMock).toHaveBeenCalledWith(
      RULE,
      expect.objectContaining({ name: 'Updated rule', leadMinutes: 30 })
    )
  })

  it('returns 403 when the caller lacks escalation.rule_manage on patch', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await escalationRuleDetailHandlers.PATCH(
      args(
        { policyId: POLICY, ruleId: RULE },
        jsonRequest(
          'http://test/api/v1/sla-policies/sla_pol_123/escalation-rules/esc_rule_123',
          'PATCH',
          { name: 'x' }
        )
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.updateEscalationRuleMock).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid escalation patch body', async () => {
    const response = await escalationRuleDetailHandlers.PATCH(
      args(
        { policyId: POLICY, ruleId: RULE },
        jsonRequest(
          'http://test/api/v1/sla-policies/sla_pol_123/escalation-rules/esc_rule_123',
          'PATCH',
          { leadMinutes: 1.5 }
        )
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.updateEscalationRuleMock).not.toHaveBeenCalled()
  })

  it('routes a thrown domain error through handleDomainError on patch', async () => {
    hoisted.updateEscalationRuleMock.mockRejectedValue(new Error('boom'))

    const response = await escalationRuleDetailHandlers.PATCH(
      args(
        { policyId: POLICY, ruleId: RULE },
        jsonRequest(
          'http://test/api/v1/sla-policies/sla_pol_123/escalation-rules/esc_rule_123',
          'PATCH',
          { name: 'Updated rule' }
        )
      )
    )

    expect(response.status).toBe(500)
  })

  it('deletes an escalation rule with 204', async () => {
    hoisted.deleteEscalationRuleMock.mockResolvedValue(undefined)

    const response = await escalationRuleDetailHandlers.DELETE(
      args({ policyId: POLICY, ruleId: RULE })
    )

    expect(response.status).toBe(204)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ESCALATION_RULE_MANAGE
    )
    expect(hoisted.deleteEscalationRuleMock).toHaveBeenCalledWith(RULE)
  })

  it('returns 403 when the caller lacks escalation.rule_manage on delete', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await escalationRuleDetailHandlers.DELETE(
      args({ policyId: POLICY, ruleId: RULE })
    )

    expect(response.status).toBe(403)
    expect(hoisted.deleteEscalationRuleMock).not.toHaveBeenCalled()
  })

  it('routes a thrown domain error through handleDomainError on delete', async () => {
    hoisted.deleteEscalationRuleMock.mockRejectedValue(new Error('boom'))

    const response = await escalationRuleDetailHandlers.DELETE(
      args({ policyId: POLICY, ruleId: RULE })
    )

    expect(response.status).toBe(500)
  })
})
