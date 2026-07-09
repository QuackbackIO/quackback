/**
 * Exhaustive unit coverage for the pure condition evaluator (§4.6, Slice 4):
 * every operator, each field type, group combinators, and the defensive
 * non-matches (unknown field, type mismatch, nobody-waiting).
 */
import { describe, it, expect } from 'vitest'
import {
  evaluateCondition,
  type ConditionContext,
  type WorkflowCondition,
} from '../condition.evaluator'

const baseCtx = (over: Partial<ConditionContext> = {}): ConditionContext => ({
  conversation: {
    status: 'open',
    channel: 'messenger',
    priority: 'high',
    waitingMinutes: 45,
    tagIds: ['ctag_vip', 'ctag_billing'],
    assignedTeamId: 'team_support',
    attributes: {
      // Envelope-shaped (the write path) and bare legacy values both resolve.
      plan: { v: 'pro', src: 'teammate', at: '2026-07-05T00:00:00.000Z' },
      seats: { v: 12, src: 'workflow', at: '2026-07-05T00:00:00.000Z' },
      areas: { v: ['opt_billing'], src: 'ai', at: '2026-07-05T00:00:00.000Z' },
      legacy_note: 'bare',
    },
    ...over.conversation,
  },
  message: over.message === undefined ? { body: 'My card was double charged' } : over.message,
  person: over.person === undefined ? { segmentIds: ['seg_paid'] } : over.person,
  officeHours: over.officeHours,
  csatRating: over.csatRating,
})

const ok = (cond: WorkflowCondition, ctx = baseCtx()) =>
  expect(evaluateCondition(cond, ctx)).toBe(true)
const no = (cond: WorkflowCondition, ctx = baseCtx()) =>
  expect(evaluateCondition(cond, ctx)).toBe(false)

describe('evaluateCondition — leaves', () => {
  it('eq / neq on scalar fields', () => {
    ok({ field: 'conversation.status', op: 'eq', value: 'open' })
    no({ field: 'conversation.status', op: 'eq', value: 'closed' })
    ok({ field: 'conversation.channel', op: 'neq', value: 'email' })
    no({ field: 'conversation.priority', op: 'neq', value: 'high' })
  })

  it('contains / not_contains on message body (case-insensitive, absent body)', () => {
    ok({ field: 'message.body', op: 'contains', value: 'DOUBLE charged' })
    no({ field: 'message.body', op: 'contains', value: 'refund' })
    ok({ field: 'message.body', op: 'not_contains', value: 'refund' })
    // Absent message -> body resolves null -> "contains" false, "not_contains" true.
    const noMsg = baseCtx({ message: null })
    no({ field: 'message.body', op: 'contains', value: 'anything' }, noMsg)
    ok({ field: 'message.body', op: 'not_contains', value: 'anything' }, noMsg)
  })

  it('numeric comparisons on waiting minutes, with nobody-waiting as a non-match', () => {
    ok({ field: 'conversation.waiting_minutes', op: 'gt', value: 30 })
    ok({ field: 'conversation.waiting_minutes', op: 'gte', value: 45 })
    no({ field: 'conversation.waiting_minutes', op: 'lt', value: 45 })
    ok({ field: 'conversation.waiting_minutes', op: 'lte', value: 45 })
    // null waitingMinutes (nobody waiting) never matches a numeric compare.
    const idle = baseCtx({ conversation: { ...baseCtx().conversation, waitingMinutes: null } })
    no({ field: 'conversation.waiting_minutes', op: 'gt', value: 0 }, idle)
    no({ field: 'conversation.waiting_minutes', op: 'lt', value: 999 }, idle)
  })

  it('includes_any / excludes_all on array fields (tags, segments)', () => {
    ok({ field: 'conversation.tags', op: 'includes_any', value: ['ctag_vip', 'ctag_other'] })
    no({ field: 'conversation.tags', op: 'includes_any', value: ['ctag_other'] })
    ok({ field: 'conversation.tags', op: 'excludes_all', value: ['ctag_other'] })
    no({ field: 'conversation.tags', op: 'excludes_all', value: ['ctag_vip'] })
    ok({ field: 'person.segments', op: 'includes_any', value: ['seg_paid'] })
    // Absent person -> empty segments -> includes_any false, excludes_all true.
    const anon = baseCtx({ person: null })
    no({ field: 'person.segments', op: 'includes_any', value: ['seg_paid'] }, anon)
    ok({ field: 'person.segments', op: 'excludes_all', value: ['seg_paid'] }, anon)
  })

  it('is_set / is_empty across scalar, array, and absent values', () => {
    ok({ field: 'conversation.priority', op: 'is_set' })
    ok({ field: 'conversation.tags', op: 'is_set' })
    ok({ field: 'csat.rating', op: 'is_empty' }) // unset by default
    no({ field: 'csat.rating', op: 'is_set' })
    const rated = baseCtx({ csatRating: 5 })
    ok({ field: 'csat.rating', op: 'is_set' }, rated)
    ok({ field: 'csat.rating', op: 'eq', value: 5 }, rated)
    // Empty tag list reads as empty.
    const untagged = baseCtx({ conversation: { ...baseCtx().conversation, tagIds: [] } })
    ok({ field: 'conversation.tags', op: 'is_empty' }, untagged)
  })

  it('message.sender tells a customer message from a teammate reply', () => {
    const fromVisitor = baseCtx({ message: { body: 'hi', senderType: 'visitor' } })
    const fromAgent = baseCtx({ message: { body: 'hi', senderType: 'agent' } })
    ok({ field: 'message.sender', op: 'eq', value: 'visitor' }, fromVisitor)
    no({ field: 'message.sender', op: 'eq', value: 'visitor' }, fromAgent)
  })

  it('office-hours boolean', () => {
    ok({ field: 'office_hours', op: 'eq', value: true }, baseCtx({ officeHours: true }))
    no({ field: 'office_hours', op: 'eq', value: true }, baseCtx({ officeHours: false }))
  })

  it('conversation.team: eq / neq / is_set / is_empty, including the unassigned case', () => {
    ok({ field: 'conversation.team', op: 'eq', value: 'team_support' })
    no({ field: 'conversation.team', op: 'eq', value: 'team_billing' })
    ok({ field: 'conversation.team', op: 'neq', value: 'team_billing' })
    no({ field: 'conversation.team', op: 'neq', value: 'team_support' })
    ok({ field: 'conversation.team', op: 'is_set' })
    no({ field: 'conversation.team', op: 'is_empty' })

    // Unassigned (assignedTeamId: null): eq to any concrete team is a
    // non-match, neq to any concrete team matches (there's no team to equal),
    // is_set is false, and is_empty — the deliberate "no team" test — holds.
    const unassigned = baseCtx({
      conversation: { ...baseCtx().conversation, assignedTeamId: null },
    })
    no({ field: 'conversation.team', op: 'eq', value: 'team_support' }, unassigned)
    ok({ field: 'conversation.team', op: 'neq', value: 'team_support' }, unassigned)
    no({ field: 'conversation.team', op: 'is_set' }, unassigned)
    ok({ field: 'conversation.team', op: 'is_empty' }, unassigned)
  })

  it('is defensive: unknown field and type-mismatched compares never match', () => {
    no({ field: 'nope.unknown', op: 'eq', value: 'x' })
    no({ field: 'conversation.status', op: 'gt', value: 3 }) // 'open' is not numeric
    no({ field: 'message.body', op: 'gt', value: 3 })
  })

  it('attribute predicates (conversation.attr.<key>) unwrap value envelopes', () => {
    ok({ field: 'conversation.attr.plan', op: 'eq', value: 'pro' })
    no({ field: 'conversation.attr.plan', op: 'eq', value: 'starter' })
    ok({ field: 'conversation.attr.plan', op: 'neq', value: 'starter' })
    ok({ field: 'conversation.attr.plan', op: 'is_set' })
    no({ field: 'conversation.attr.plan', op: 'is_empty' })
    // Unset key: is_empty holds, everything else is a non-match.
    ok({ field: 'conversation.attr.missing', op: 'is_empty' })
    no({ field: 'conversation.attr.missing', op: 'is_set' })
    no({ field: 'conversation.attr.missing', op: 'eq', value: 'pro' })
  })

  it('attribute predicates compare numbers and match multi-select arrays', () => {
    ok({ field: 'conversation.attr.seats', op: 'gt', value: 10 })
    no({ field: 'conversation.attr.seats', op: 'lt', value: 10 })
    ok({ field: 'conversation.attr.seats', op: 'eq', value: 12 })
    ok({ field: 'conversation.attr.areas', op: 'includes_any', value: ['opt_billing'] })
    no({ field: 'conversation.attr.areas', op: 'includes_any', value: ['opt_auth'] })
  })

  it('attribute predicates read bare legacy values (no envelope)', () => {
    ok({ field: 'conversation.attr.legacy_note', op: 'eq', value: 'bare' })
    ok({ field: 'conversation.attr.legacy_note', op: 'is_set' })
  })

  it('attribute predicates never match when the snapshot has no attributes', () => {
    const bare = baseCtx({ conversation: { ...baseCtx().conversation, attributes: undefined } })
    no({ field: 'conversation.attr.plan', op: 'eq', value: 'pro' }, bare)
    ok({ field: 'conversation.attr.plan', op: 'is_empty' }, bare)
  })
})

describe('evaluateCondition — groups', () => {
  it('all = every child holds', () => {
    ok({
      all: [
        { field: 'conversation.status', op: 'eq', value: 'open' },
        { field: 'conversation.priority', op: 'eq', value: 'high' },
      ],
    })
    no({
      all: [
        { field: 'conversation.status', op: 'eq', value: 'open' },
        { field: 'conversation.priority', op: 'eq', value: 'low' },
      ],
    })
  })

  it('any = at least one child holds; empty/absent any is no constraint', () => {
    ok({
      any: [
        { field: 'conversation.channel', op: 'eq', value: 'email' },
        { field: 'conversation.channel', op: 'eq', value: 'messenger' },
      ],
    })
    no({
      any: [
        { field: 'conversation.channel', op: 'eq', value: 'email' },
        { field: 'conversation.channel', op: 'eq', value: 'web_form' },
      ],
    })
    ok({ any: [] }) // no constraint
    ok({ all: [] }) // vacuously true
  })

  it('all + any combine (AND of the two constraints), and groups nest', () => {
    ok({
      all: [{ field: 'conversation.status', op: 'eq', value: 'open' }],
      any: [
        { field: 'conversation.priority', op: 'eq', value: 'high' },
        { field: 'conversation.priority', op: 'eq', value: 'urgent' },
      ],
    })
    // Nested: VIP customer AND (billing tag OR mentions "charged").
    ok({
      all: [
        { field: 'conversation.tags', op: 'includes_any', value: ['ctag_vip'] },
        {
          any: [
            { field: 'conversation.tags', op: 'includes_any', value: ['ctag_billing'] },
            { field: 'message.body', op: 'contains', value: 'charged' },
          ],
        },
      ],
    })
  })
})
