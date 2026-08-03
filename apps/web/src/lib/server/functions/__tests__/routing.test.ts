import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
  mockCreateRoutingRule: vi.fn(),
  mockUpdateRoutingRule: vi.fn(),
  mockDeleteRoutingRule: vi.fn(),
  mockGetRoutingRule: vi.fn(),
  mockListRoutingRules: vi.fn(),
  mockReorderRoutingRules: vi.fn(),
  mockRecordEvent: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requirePermission: (...args: unknown[]) => hoisted.mockRequirePermission(...args),
}))

vi.mock('@/lib/server/domains/inboxes', () => ({
  createRoutingRule: (...args: unknown[]) => hoisted.mockCreateRoutingRule(...args),
  updateRoutingRule: (...args: unknown[]) => hoisted.mockUpdateRoutingRule(...args),
  deleteRoutingRule: (...args: unknown[]) => hoisted.mockDeleteRoutingRule(...args),
  getRoutingRule: (...args: unknown[]) => hoisted.mockGetRoutingRule(...args),
  listRoutingRules: (...args: unknown[]) => hoisted.mockListRoutingRules(...args),
  reorderRoutingRules: (...args: unknown[]) => hoisted.mockReorderRoutingRules(...args),
}))

vi.mock('@/lib/server/domains/audit', () => ({
  recordEvent: (...args: unknown[]) => hoisted.mockRecordEvent(...args),
}))

await import('../routing')

const [
  listRoutingRulesFn,
  getRoutingRuleFn,
  createRoutingRuleFn,
  updateRoutingRuleFn,
  deleteRoutingRuleFn,
  reorderRoutingRulesFn,
] = handlersByIndex

if (!reorderRoutingRulesFn) {
  throw new Error(`routing handlers were not registered; found ${handlersByIndex.length}`)
}

const ctx = {
  principal: { id: 'principal_admin' },
}

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'route_rule_123',
    name: 'Urgent',
    priority: 10,
    enabled: true,
    ...overrides,
  }
}

function conditions() {
  return { match: 'all', conditions: [{ field: 'subject', op: 'contains', value: 'urgent' }] }
}

function actions() {
  return [{ type: 'assignToInbox', value: 'inbox_support' }]
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequirePermission.mockResolvedValue(ctx)
  hoisted.mockListRoutingRules.mockResolvedValue([rule()])
  hoisted.mockGetRoutingRule.mockResolvedValue(rule())
  hoisted.mockCreateRoutingRule.mockResolvedValue(rule({ name: 'Created' }))
  hoisted.mockUpdateRoutingRule.mockResolvedValue(rule({ name: 'Updated' }))
  hoisted.mockDeleteRoutingRule.mockResolvedValue(undefined)
  hoisted.mockReorderRoutingRules.mockResolvedValue(undefined)
  hoisted.mockRecordEvent.mockResolvedValue(undefined)
})

describe('routing-rule server functions', () => {
  it('lists and fetches routing rules behind routing.rule.manage', async () => {
    await expect(
      listRoutingRulesFn({ data: { inboxIdScope: 'workspace', enabledOnly: true } })
    ).resolves.toEqual([rule()])
    expect(hoisted.mockListRoutingRules).toHaveBeenCalledWith({
      inboxIdScope: 'workspace',
      enabledOnly: true,
    })

    await expect(getRoutingRuleFn({ data: { ruleId: 'route_rule_123' } })).resolves.toEqual(rule())
    expect(hoisted.mockGetRoutingRule).toHaveBeenCalledWith('route_rule_123')
    expect(hoisted.mockRequirePermission).toHaveBeenCalledWith(PERMISSIONS.ROUTING_RULE_MANAGE)
  })

  it('creates and updates routing rules with audit events', async () => {
    await expect(
      createRoutingRuleFn({
        data: {
          name: 'Created',
          description: null,
          priority: 10,
          enabled: true,
          conditions: conditions(),
          actions: actions(),
          inboxIdScope: 'inbox_support',
        },
      })
    ).resolves.toEqual(rule({ name: 'Created' }))
    expect(hoisted.mockCreateRoutingRule).toHaveBeenCalledWith({
      name: 'Created',
      description: null,
      priority: 10,
      enabled: true,
      conditions: conditions(),
      actions: actions(),
      inboxIdScope: 'inbox_support',
    })

    await expect(
      updateRoutingRuleFn({
        data: {
          ruleId: 'route_rule_123',
          name: 'Updated',
          priority: 20,
          conditions: conditions(),
        },
      })
    ).resolves.toEqual(rule({ name: 'Updated' }))
    expect(hoisted.mockUpdateRoutingRule).toHaveBeenCalledWith('route_rule_123', {
      name: 'Updated',
      priority: 20,
      conditions: conditions(),
    })
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'routing_rule.created', targetId: 'route_rule_123' })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'routing_rule.updated', targetId: 'route_rule_123' })
    )
  })

  it('deletes and reorders routing rules with audit events', async () => {
    await expect(deleteRoutingRuleFn({ data: { ruleId: 'route_rule_123' } })).resolves.toEqual({
      ok: true,
    })
    expect(hoisted.mockDeleteRoutingRule).toHaveBeenCalledWith('route_rule_123')

    await expect(
      reorderRoutingRulesFn({ data: { orderedIds: ['route_rule_123', 'route_rule_456'] } })
    ).resolves.toEqual({ ok: true })
    expect(hoisted.mockReorderRoutingRules).toHaveBeenCalledWith([
      'route_rule_123',
      'route_rule_456',
    ])
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'routing_rule.deleted', targetId: 'route_rule_123' })
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'routing_rule.reordered', targetId: 'route_rule_123' })
    )
  })

  it('does not call routing domains when permission is denied', async () => {
    hoisted.mockRequirePermission.mockRejectedValueOnce(new Error('routing required'))

    await expect(listRoutingRulesFn({ data: {} })).rejects.toThrow('routing required')

    expect(hoisted.mockListRoutingRules).not.toHaveBeenCalled()
    expect(hoisted.mockCreateRoutingRule).not.toHaveBeenCalled()
  })
})
