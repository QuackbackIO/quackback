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

  it('office-hours boolean', () => {
    ok({ field: 'office_hours', op: 'eq', value: true }, baseCtx({ officeHours: true }))
    no({ field: 'office_hours', op: 'eq', value: true }, baseCtx({ officeHours: false }))
  })

  it('is defensive: unknown field and type-mismatched compares never match', () => {
    no({ field: 'nope.unknown', op: 'eq', value: 'x' })
    no({ field: 'conversation.status', op: 'gt', value: 3 }) // 'open' is not numeric
    no({ field: 'message.body', op: 'gt', value: 3 })
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
