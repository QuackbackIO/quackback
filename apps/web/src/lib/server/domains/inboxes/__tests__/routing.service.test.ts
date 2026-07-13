import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  findRoutingRuleMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  selectFromMock: vi.fn(),
  selectWhereMock: vi.fn(),
  selectOrderByMock: vi.fn(),
  insertMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  selectMock: vi.fn(),
  eqMock: vi.fn(),
  andMock: vi.fn(),
  ascMock: vi.fn(),
  sqlMock: vi.fn(),
  dispatchRoutingRuleCreatedMock: vi.fn(),
  dispatchRoutingRuleUpdatedMock: vi.fn(),
  dispatchRoutingRuleDeletedMock: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      routingRules: { findFirst: (...args: unknown[]) => hoisted.findRoutingRuleMock(...args) },
    },
    insert: (...args: unknown[]) => hoisted.insertMock(...args),
    update: (...args: unknown[]) => hoisted.updateMock(...args),
    delete: (...args: unknown[]) => hoisted.deleteMock(...args),
    select: (...args: unknown[]) => hoisted.selectMock(...args),
  },
  eq: (...args: unknown[]) => hoisted.eqMock(...args),
  and: (...args: unknown[]) => hoisted.andMock(...args),
  asc: (...args: unknown[]) => hoisted.ascMock(...args),
  sql: (...args: unknown[]) => hoisted.sqlMock(...args),
  routingRules: {
    id: 'routingRules.id',
    name: 'routingRules.name',
    enabled: 'routingRules.enabled',
    priority: 'routingRules.priority',
    createdAt: 'routingRules.createdAt',
    inboxIdScope: 'routingRules.inboxIdScope',
    matchCount: 'routingRules.matchCount',
  },
  TICKET_PRIORITIES: ['low', 'normal', 'high', 'urgent'],
  TICKET_VISIBILITY_SCOPES: ['workspace', 'team', 'private'],
  INBOX_CHANNEL_KINDS: ['email', 'widget', 'api'],
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchRoutingRuleCreated: (...args: unknown[]) =>
    hoisted.dispatchRoutingRuleCreatedMock(...args),
  dispatchRoutingRuleUpdated: (...args: unknown[]) =>
    hoisted.dispatchRoutingRuleUpdatedMock(...args),
  dispatchRoutingRuleDeleted: (...args: unknown[]) =>
    hoisted.dispatchRoutingRuleDeletedMock(...args),
}))

const {
  createRoutingRule,
  updateRoutingRule,
  deleteRoutingRule,
  getRoutingRule,
  listRoutingRules,
  reorderRoutingRules,
  bumpMatchStats,
} = await import('../routing.service')

function conditions() {
  return {
    match: 'all' as const,
    conditions: [{ field: 'subject' as const, op: 'contains' as const, value: 'urgent' }],
  }
}

function actions() {
  return [{ type: 'assignToInbox', value: 'inbox_urgent' }]
}

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule_1',
    name: 'Urgent',
    description: null,
    priority: 10,
    enabled: true,
    conditions: conditions(),
    actions: actions(),
    inboxIdScope: null,
    matchCount: 0,
    lastMatchedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  hoisted.eqMock.mockImplementation((left: unknown, right: unknown) => ['eq', left, right])
  hoisted.andMock.mockImplementation((...parts: unknown[]) => ['and', ...parts])
  hoisted.ascMock.mockImplementation((value: unknown) => ['asc', value])
  hoisted.sqlMock.mockImplementation((strings: unknown, ...values: unknown[]) => [
    'sql',
    strings,
    ...values,
  ])
  hoisted.insertMock.mockReturnValue({
    values: (values: unknown) => {
      hoisted.insertValuesMock(values)
      return { returning: hoisted.insertReturningMock }
    },
  })
  hoisted.updateMock.mockReturnValue({
    set: (patch: unknown) => {
      hoisted.updateSetMock(patch)
      return {
        where: (condition: unknown) => {
          hoisted.updateWhereMock(condition)
          return { returning: hoisted.updateReturningMock }
        },
      }
    },
  })
  hoisted.deleteMock.mockReturnValue({
    where: (...args: unknown[]) => hoisted.deleteWhereMock(...args),
  })
  hoisted.selectMock.mockReturnValue({
    from: (table: unknown) => {
      hoisted.selectFromMock(table)
      return {
        where: (condition: unknown) => {
          hoisted.selectWhereMock(condition)
          return { orderBy: (...args: unknown[]) => hoisted.selectOrderByMock(...args) }
        },
      }
    },
  })
  hoisted.dispatchRoutingRuleCreatedMock.mockResolvedValue(undefined)
  hoisted.dispatchRoutingRuleUpdatedMock.mockResolvedValue(undefined)
  hoisted.dispatchRoutingRuleDeletedMock.mockResolvedValue(undefined)
})

describe('routing rule service', () => {
  it('creates a routing rule with defaults, trimmed name, optional scope, and dispatch', async () => {
    const created = rule({ name: 'Urgent tickets', priority: 100, inboxIdScope: 'inbox_1' })
    hoisted.insertReturningMock.mockResolvedValue([created])

    await expect(
      createRoutingRule({
        name: '  Urgent tickets  ',
        conditions: conditions(),
        actions: actions() as never,
        inboxIdScope: 'inbox_1' as never,
      })
    ).resolves.toBe(created)

    expect(hoisted.insertValuesMock).toHaveBeenCalledWith({
      name: 'Urgent tickets',
      description: null,
      priority: 100,
      enabled: true,
      conditions: conditions(),
      actions: actions(),
      inboxIdScope: 'inbox_1',
    })
    expect(hoisted.dispatchRoutingRuleCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'service', displayName: 'routing-system' }),
      expect.objectContaining({
        id: 'rule_1',
        name: 'Urgent tickets',
        enabled: true,
        priority: 100,
        inboxIdScope: 'inbox_1',
      })
    )
  })

  it('rejects invalid create and update payloads before writing', async () => {
    await expect(
      createRoutingRule({ name: ' ', conditions: conditions(), actions: actions() as never })
    ).rejects.toMatchObject({ code: 'ROUTING_NAME_REQUIRED' })
    await expect(
      createRoutingRule({
        name: 'Rule',
        conditions: { match: 'all', conditions: [] } as never,
        actions: actions() as never,
      })
    ).rejects.toMatchObject({ code: 'ROUTING_CONDITIONS_INVALID' })
    await expect(
      createRoutingRule({ name: 'Rule', conditions: conditions(), actions: [] as never })
    ).rejects.toMatchObject({ code: 'ROUTING_ACTIONS_INVALID' })

    hoisted.findRoutingRuleMock.mockResolvedValueOnce(rule())
    await expect(updateRoutingRule('rule_1' as never, { name: ' ' })).rejects.toMatchObject({
      code: 'ROUTING_NAME_REQUIRED',
    })
    expect(hoisted.insertValuesMock).not.toHaveBeenCalled()
  })

  it('updates routing rules, validates condition/action combinations, and dispatches changed fields', async () => {
    const existing = rule({ actions: [{ type: 'assignToInbox', value: 'inbox_old' }] })
    const updated = rule({
      name: 'Escalations',
      priority: 5,
      enabled: false,
      description: 'Only escalations',
      actions: [{ type: 'assignToTeam', value: 'team_escalations' }],
      inboxIdScope: 'inbox_1',
    })
    hoisted.findRoutingRuleMock.mockResolvedValueOnce(undefined)
    await expect(updateRoutingRule('missing' as never, { name: 'Nope' })).rejects.toMatchObject({
      code: 'ROUTING_RULE_NOT_FOUND',
    })

    hoisted.findRoutingRuleMock.mockResolvedValueOnce(existing)
    await expect(updateRoutingRule('rule_1' as never, {})).resolves.toBe(existing)
    expect(hoisted.updateSetMock).not.toHaveBeenCalled()

    hoisted.findRoutingRuleMock.mockResolvedValueOnce(existing)
    hoisted.updateReturningMock.mockResolvedValueOnce([updated])
    await expect(
      updateRoutingRule('rule_1' as never, {
        name: ' Escalations ',
        description: 'Only escalations',
        priority: 5,
        enabled: false,
        conditions: {
          match: 'any',
          conditions: [{ field: 'descriptionText', op: 'contains', value: 'escalated' }],
        },
        actions: [{ type: 'assignToTeam', value: 'team_escalations' }] as never,
        inboxIdScope: 'inbox_1' as never,
      })
    ).resolves.toBe(updated)

    expect(hoisted.updateSetMock).toHaveBeenCalledWith({
      name: 'Escalations',
      description: 'Only escalations',
      priority: 5,
      enabled: false,
      conditions: {
        match: 'any',
        conditions: [{ field: 'descriptionText', op: 'contains', value: 'escalated' }],
      },
      actions: [{ type: 'assignToTeam', value: 'team_escalations' }],
      inboxIdScope: 'inbox_1',
    })
    expect(hoisted.dispatchRoutingRuleUpdatedMock).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'routing-system' }),
      expect.objectContaining({ id: 'rule_1', name: 'Escalations' }),
      ['name', 'description', 'priority', 'enabled', 'conditions', 'actions', 'inboxIdScope']
    )

    hoisted.findRoutingRuleMock.mockResolvedValueOnce(existing)
    await expect(
      updateRoutingRule('rule_1' as never, {
        actions: [] as never,
      })
    ).rejects.toMatchObject({ code: 'ROUTING_ACTIONS_INVALID' })
  })

  it('deletes existing rules with dispatch and missing rules without dispatch', async () => {
    const existing = rule()
    hoisted.findRoutingRuleMock.mockResolvedValueOnce(existing)
    await deleteRoutingRule('rule_1' as never)
    expect(hoisted.deleteWhereMock).toHaveBeenCalledWith(['eq', 'routingRules.id', 'rule_1'])
    expect(hoisted.dispatchRoutingRuleDeletedMock).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'routing-system' }),
      expect.objectContaining({ id: 'rule_1' })
    )

    vi.clearAllMocks()
    hoisted.findRoutingRuleMock.mockResolvedValueOnce(undefined)
    await deleteRoutingRule('missing' as never)
    expect(hoisted.deleteWhereMock).toHaveBeenCalledWith(['eq', 'routingRules.id', 'missing'])
    expect(hoisted.dispatchRoutingRuleDeletedMock).not.toHaveBeenCalled()
  })

  it('gets and lists routing rules with optional enabled and scope filters', async () => {
    const rows = [rule()]
    hoisted.findRoutingRuleMock.mockResolvedValue(rows[0])
    hoisted.selectOrderByMock.mockResolvedValue(rows)

    await expect(getRoutingRule('rule_1' as never)).resolves.toBe(rows[0])
    await expect(listRoutingRules()).resolves.toEqual(rows)
    expect(hoisted.selectWhereMock).toHaveBeenLastCalledWith(undefined)

    await expect(
      listRoutingRules({ enabledOnly: true, inboxIdScope: 'workspace' })
    ).resolves.toEqual(rows)
    expect(hoisted.selectWhereMock).toHaveBeenLastCalledWith(expect.arrayContaining(['and']))
    expect(hoisted.sqlMock).toHaveBeenCalled()

    await expect(listRoutingRules({ inboxIdScope: 'inbox_1' as never })).resolves.toEqual(rows)
    expect(hoisted.selectWhereMock).toHaveBeenLastCalledWith([
      'and',
      ['eq', 'routingRules.inboxIdScope', 'inbox_1'],
    ])
  })

  it('reorders rules and bumps match stats', async () => {
    await reorderRoutingRules(['rule_a', 'rule_b', 'rule_c'] as never)

    expect(hoisted.updateSetMock).toHaveBeenNthCalledWith(1, { priority: 10 })
    expect(hoisted.updateSetMock).toHaveBeenNthCalledWith(2, { priority: 20 })
    expect(hoisted.updateSetMock).toHaveBeenNthCalledWith(3, { priority: 30 })
    expect(hoisted.updateWhereMock).toHaveBeenNthCalledWith(3, ['eq', 'routingRules.id', 'rule_c'])

    await bumpMatchStats('rule_1' as never)
    expect(hoisted.updateSetMock).toHaveBeenLastCalledWith({
      matchCount: expect.arrayContaining(['sql']),
      lastMatchedAt: expect.any(Date),
    })
    expect(hoisted.updateWhereMock).toHaveBeenLastCalledWith(['eq', 'routingRules.id', 'rule_1'])
  })
})
