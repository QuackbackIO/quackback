import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  selectMock: vi.fn(),
  selectFromMock: vi.fn(),
  selectWhereMock: vi.fn(),
  selectOrderByMock: vi.fn(),
  findInboxMock: vi.fn(),
  eqMock: vi.fn(),
  ascMock: vi.fn(),
  isNullMock: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: (...args: unknown[]) => hoisted.selectMock(...args),
    query: {
      inboxes: { findFirst: (...args: unknown[]) => hoisted.findInboxMock(...args) },
    },
  },
  eq: (...args: unknown[]) => hoisted.eqMock(...args),
  asc: (...args: unknown[]) => hoisted.ascMock(...args),
  isNull: (...args: unknown[]) => hoisted.isNullMock(...args),
  inboxes: {
    id: 'inboxes.id',
    archivedAt: 'inboxes.archivedAt',
    createdAt: 'inboxes.createdAt',
  },
  routingRules: {
    id: 'routingRules.id',
    enabled: 'routingRules.enabled',
    priority: 'routingRules.priority',
    createdAt: 'routingRules.createdAt',
  },
  TICKET_PRIORITIES: ['low', 'normal', 'high', 'urgent'],
  TICKET_VISIBILITY_SCOPES: ['workspace', 'team', 'private'],
  INBOX_CHANNEL_KINDS: ['email', 'widget', 'api'],
}))

const { applyActions, evalRuleSet, evaluateRules, route } = await import('../routing.engine')

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule_1',
    name: 'Rule',
    enabled: true,
    priority: 10,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    conditions: {
      match: 'all',
      conditions: [{ field: 'subject', op: 'contains', value: 'urgent' }],
    },
    actions: [{ type: 'assignToInbox', value: 'inbox_urgent' }],
    ...overrides,
  }
}

const input = {
  subject: 'Urgent billing problem',
  descriptionText: 'The invoice failed twice',
  channel: 'email' as const,
  priority: 'high',
  organizationDomain: 'example.com',
  requesterEmail: 'owner@example.com',
  inboxChannelKind: 'email' as const,
}

beforeEach(() => {
  vi.resetAllMocks()
  hoisted.eqMock.mockImplementation((left: unknown, right: unknown) => ['eq', left, right])
  hoisted.ascMock.mockImplementation((value: unknown) => ['asc', value])
  hoisted.isNullMock.mockImplementation((value: unknown) => ['isNull', value])
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
})

describe('routing engine evaluator', () => {
  it('evaluates all supported condition operators case-insensitively', () => {
    expect(
      evalRuleSet(input, {
        match: 'all',
        conditions: [
          { field: 'subject', op: 'contains', value: 'URGENT' },
          { field: 'channel', op: 'eq', value: 'EMAIL' },
          { field: 'requesterEmail', op: 'matches', value: '^owner@' },
          { field: 'priority', op: 'in', value: ['low', 'HIGH'] },
          { field: 'inboxChannelKind', op: 'eq', value: 'Email' },
        ],
      })
    ).toBe(true)
  })

  it('returns false for missing fields, empty sets, invalid regex, and non-string payloads', () => {
    expect(evalRuleSet(input, { match: 'all', conditions: [] })).toBe(false)
    expect(
      evalRuleSet(
        { ...input, organizationDomain: null },
        { match: 'all', conditions: [{ field: 'organizationDomain', op: 'eq', value: 'example' }] }
      )
    ).toBe(false)
    expect(
      evalRuleSet(input, {
        match: 'any',
        conditions: [
          { field: 'subject', op: 'matches', value: '[' },
          { field: 'priority', op: 'in', value: 'high' },
          { field: 'channel', op: 'eq', value: ['email'] },
        ],
      })
    ).toBe(false)
  })

  it('applies every action kind into a single routing decision', () => {
    expect(
      applyActions(
        [
          { type: 'assignToInbox', value: 'inbox_1' },
          { type: 'assignToTeam', value: 'team_1' },
          { type: 'assignToPrincipal', value: 'principal_1' },
          { type: 'setPriority', value: 'urgent' },
          { type: 'setVisibility', value: 'team' },
          { type: 'addParticipant', value: 'principal_a' },
          { type: 'addParticipant', value: 'principal_b' },
        ],
        'rule_1'
      )
    ).toEqual({
      matchedRuleId: 'rule_1',
      inboxId: 'inbox_1',
      primaryTeamId: 'team_1',
      assigneeTeamId: 'team_1',
      assigneePrincipalId: 'principal_1',
      priority: 'urgent',
      visibilityScope: 'team',
      addParticipants: ['principal_a', 'principal_b'],
    })
  })

  it('returns the first enabled rule with valid conditions and actions', () => {
    const decision = evaluateRules(
      [
        rule({ id: 'disabled', enabled: false }),
        rule({ id: 'bad_conditions', conditions: { match: 'all', conditions: [] } }),
        rule({ id: 'bad_actions', actions: [] }),
        rule({
          id: 'rule_matching',
          actions: [
            { type: 'assignToInbox', value: 'inbox_2' },
            { type: 'setPriority', value: 'urgent' },
          ],
        }),
        rule({ id: 'rule_later', actions: [{ type: 'assignToInbox', value: 'inbox_3' }] }),
      ] as never,
      input
    )

    expect(decision).toEqual({
      matchedRuleId: 'rule_matching',
      inboxId: 'inbox_2',
      priority: 'urgent',
    })
  })

  it('returns null when no enabled valid rule matches', () => {
    expect(
      evaluateRules(
        [
          rule({
            conditions: {
              match: 'all',
              conditions: [{ field: 'subject', op: 'contains', value: 'refund-only' }],
            },
          }),
        ] as never,
        input
      )
    ).toBeNull()
  })
})

describe('routing engine route helper', () => {
  it('loads enabled rules, evaluates a match, and derives the inbox primary team', async () => {
    hoisted.selectOrderByMock.mockResolvedValue([
      rule({
        id: 'rule_urgent',
        actions: [{ type: 'assignToInbox', value: 'inbox_urgent' }],
      }),
    ])
    hoisted.findInboxMock.mockResolvedValue({ id: 'inbox_urgent', primaryTeamId: 'team_support' })

    await expect(route(input)).resolves.toEqual({
      matchedRuleId: 'rule_urgent',
      inboxId: 'inbox_urgent',
      primaryTeamId: 'team_support',
    })

    expect(hoisted.selectWhereMock).toHaveBeenCalledWith(['eq', 'routingRules.enabled', true])
    expect(hoisted.findInboxMock).toHaveBeenCalledWith({
      where: ['eq', 'inboxes.id', 'inbox_urgent'],
    })
  })

  it('falls back to candidate inbox and preserves explicit team actions', async () => {
    hoisted.selectOrderByMock.mockResolvedValue([])

    await expect(
      route({
        ...input,
        candidateInboxId: 'inbox_candidate',
      })
    ).resolves.toEqual({ matchedRuleId: null, inboxId: 'inbox_candidate' })
    expect(hoisted.findInboxMock).toHaveBeenCalledWith({
      where: ['eq', 'inboxes.id', 'inbox_candidate'],
    })

    hoisted.selectOrderByMock.mockResolvedValueOnce([
      rule({
        actions: [
          { type: 'assignToInbox', value: 'inbox_rule' },
          { type: 'assignToTeam', value: 'team_rule' },
        ],
      }),
    ])
    await expect(route(input)).resolves.toMatchObject({
      inboxId: 'inbox_rule',
      primaryTeamId: 'team_rule',
      assigneeTeamId: 'team_rule',
    })
  })

  it('falls back to the first active inbox when no rule or candidate chooses one', async () => {
    hoisted.selectOrderByMock.mockResolvedValue([])
    hoisted.findInboxMock.mockResolvedValueOnce({ id: 'inbox_default', primaryTeamId: null })

    await expect(route(input)).resolves.toEqual({
      matchedRuleId: null,
      inboxId: 'inbox_default',
    })

    expect(hoisted.findInboxMock).toHaveBeenCalledWith({
      where: ['isNull', 'inboxes.archivedAt'],
      orderBy: ['asc', 'inboxes.createdAt'],
    })
  })
})
