/**
 * Differential-coverage tests for routing.engine — the pure evaluator
 * (field extraction, every operator, all/any match, every action type) and the
 * db-aware route() fallback chain (matched rule, candidate inbox, default
 * inbox, derived primary team). Real zod schemas; only db is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ selectOrderBy: vi.fn(), inboxesFindFirst: vi.fn() }))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => m.selectOrderBy() }) }) }),
    query: { inboxes: { findFirst: m.inboxesFindFirst } },
  },
  eq: vi.fn(),
  asc: vi.fn(),
  isNull: vi.fn(),
  inboxes: { id: 'i.id', archivedAt: 'i.archivedAt', createdAt: 'i.createdAt' },
  routingRules: { enabled: 'rr.enabled', priority: 'rr.priority', createdAt: 'rr.createdAt' },
  // Constants the routing.types zod schema enumerates.
  TICKET_PRIORITIES: ['low', 'normal', 'high', 'urgent'],
  TICKET_VISIBILITY_SCOPES: ['team', 'workspace', 'private'],
  INBOX_CHANNEL_KINDS: ['support', 'email', 'chat', 'api', 'contact_form'],
}))

import { evalRuleSet, applyActions, evaluateRules, route } from '../routing.engine'
import type { RoutingInput } from '../routing.types'

const input: RoutingInput = {
  subject: 'Login broken',
  descriptionText: 'cannot log in',
  channel: 'email' as never,
  priority: 'high' as never,
  organizationDomain: 'acme.com',
  requesterEmail: 'a@acme.com',
  inboxChannelKind: 'support' as never,
}

beforeEach(() => {
  vi.clearAllMocks()
  m.selectOrderBy.mockResolvedValue([])
  m.inboxesFindFirst.mockResolvedValue(undefined)
})

describe('evalRuleSet', () => {
  it('is false for an empty condition set', () => {
    expect(evalRuleSet(input, { match: 'all', conditions: [] } as never)).toBe(false)
  })
  it("match='all' requires every condition", () => {
    expect(
      evalRuleSet(input, {
        match: 'all',
        conditions: [
          { field: 'subject', op: 'contains', value: 'login' },
          { field: 'channel', op: 'eq', value: 'EMAIL' },
        ],
      } as never)
    ).toBe(true)
    expect(
      evalRuleSet(input, {
        match: 'all',
        conditions: [{ field: 'subject', op: 'eq', value: 'nope' }],
      } as never)
    ).toBe(false)
  })
  it("match='any' requires one condition and covers all operators/fields", () => {
    expect(
      evalRuleSet(input, {
        match: 'any',
        conditions: [
          { field: 'descriptionText', op: 'matches', value: 'log\\s?in' },
          { field: 'priority', op: 'in', value: ['low', 'high'] },
          { field: 'organizationDomain', op: 'eq', value: 'acme.com' },
          { field: 'requesterEmail', op: 'contains', value: 'acme' },
          { field: 'inboxChannelKind', op: 'eq', value: 'support' },
        ],
      } as never)
    ).toBe(true)
  })
  it('handles null field values, bad regex, non-string/array values, and unknown ops', () => {
    const empty = {} as never
    expect(
      evalRuleSet(empty, {
        match: 'any',
        conditions: [
          { field: 'subject', op: 'eq', value: 'x' }, // actual null -> false
          { field: 'subject', op: 'matches', value: '(' }, // (set actual via other input below)
        ],
      } as never)
    ).toBe(false)
    // bad regex + non-string + non-array + unknown op, all -> false
    expect(
      evalRuleSet(input, {
        match: 'all',
        conditions: [
          { field: 'subject', op: 'matches', value: '(' }, // invalid regex -> false
        ],
      } as never)
    ).toBe(false)
    expect(
      evalRuleSet(input, {
        match: 'all',
        conditions: [
          { field: 'subject', op: 'eq', value: 123 }, // non-string -> false
        ],
      } as never)
    ).toBe(false)
    expect(
      evalRuleSet(input, {
        match: 'all',
        conditions: [
          { field: 'subject', op: 'in', value: 'x' }, // non-array -> false
        ],
      } as never)
    ).toBe(false)
    expect(
      evalRuleSet(input, {
        match: 'all',
        conditions: [
          { field: 'subject', op: 'weird' }, // unknown op -> false
        ],
      } as never)
    ).toBe(false)
    expect(
      evalRuleSet(input, {
        match: 'all',
        conditions: [
          { field: 'unknownField', op: 'eq', value: 'x' }, // unknown field -> null -> false
        ],
      } as never)
    ).toBe(false)
  })
})

describe('applyActions', () => {
  it('applies every action type', () => {
    const decision = applyActions(
      [
        { type: 'assignToInbox', value: 'inbox_1' },
        { type: 'assignToTeam', value: 'team_1' },
        { type: 'assignToPrincipal', value: 'p_1' },
        { type: 'setPriority', value: 'urgent' },
        { type: 'setVisibility', value: 'team' },
        { type: 'addParticipant', value: 'p_2' },
        { type: 'addParticipant', value: 'p_3' },
        { type: 'unknown' } as never,
      ] as never,
      'rule_1'
    )
    expect(decision).toMatchObject({
      matchedRuleId: 'rule_1',
      inboxId: 'inbox_1',
      primaryTeamId: 'team_1',
      assigneeTeamId: 'team_1',
      assigneePrincipalId: 'p_1',
      priority: 'urgent',
      visibilityScope: 'team',
      addParticipants: ['p_2', 'p_3'],
    })
  })
})

describe('evaluateRules', () => {
  const rule = (over: Record<string, unknown> = {}) => ({
    id: 'rule_1',
    enabled: true,
    conditions: {
      match: 'all',
      conditions: [{ field: 'subject', op: 'contains', value: 'login' }],
    },
    actions: [{ type: 'assignToInbox', value: 'inbox_1' }],
    ...over,
  })
  it('skips disabled and malformed rules, returns the first match', () => {
    const res = evaluateRules(
      [
        rule({ enabled: false }),
        rule({ id: 'bad_conditions', conditions: { nope: true } }),
        rule({ id: 'bad_actions', actions: 'not-an-array' }),
        rule({
          id: 'match',
          conditions: {
            match: 'all',
            conditions: [{ field: 'subject', op: 'eq', value: 'Login broken' }],
          },
        }),
      ] as never,
      input
    )
    expect(res).toMatchObject({ matchedRuleId: 'match', inboxId: 'inbox_1' })
  })
  it('returns null when nothing matches', () => {
    expect(
      evaluateRules(
        [
          rule({
            conditions: {
              match: 'all',
              conditions: [{ field: 'subject', op: 'eq', value: 'zzz' }],
            },
          }),
        ] as never,
        input
      )
    ).toBeNull()
  })
})

describe('route', () => {
  it('uses a matching rule (inbox + team) without fallback', async () => {
    m.selectOrderBy.mockResolvedValueOnce([
      {
        id: 'rule_1',
        enabled: true,
        conditions: {
          match: 'all',
          conditions: [{ field: 'subject', op: 'contains', value: 'login' }],
        },
        actions: [
          { type: 'assignToInbox', value: 'inbox_1' },
          { type: 'assignToTeam', value: 'team_1' },
        ],
      },
    ])
    const d = await route(input)
    expect(d).toMatchObject({ inboxId: 'inbox_1', primaryTeamId: 'team_1' })
    expect(m.inboxesFindFirst).not.toHaveBeenCalled()
  })
  it('falls back to the candidate inbox and derives the team', async () => {
    m.inboxesFindFirst.mockResolvedValueOnce({ id: 'inbox_c', primaryTeamId: 'team_c' }) // derive
    const d = await route({ ...input, subject: 'no match', candidateInboxId: 'inbox_c' } as never)
    expect(d.inboxId).toBe('inbox_c')
    expect(d.primaryTeamId).toBe('team_c')
  })
  it('falls back to the first active inbox', async () => {
    m.inboxesFindFirst
      .mockResolvedValueOnce({ id: 'inbox_default', primaryTeamId: null }) // fallback
      .mockResolvedValueOnce({ id: 'inbox_default', primaryTeamId: null }) // derive (no team)
    const d = await route({ ...input, subject: 'no match' } as never)
    expect(d.inboxId).toBe('inbox_default')
  })
  it('leaves inbox undefined when there is no fallback', async () => {
    m.inboxesFindFirst.mockResolvedValueOnce(undefined) // no fallback inbox
    const d = await route({ ...input, subject: 'no match' } as never)
    expect(d.inboxId).toBeUndefined()
  })
})
