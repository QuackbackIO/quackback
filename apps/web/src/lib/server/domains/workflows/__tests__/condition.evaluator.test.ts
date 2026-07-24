/**
 * Exhaustive unit coverage for the pure condition evaluator (§4.6, Slice 4):
 * every operator, each field type, group combinators, and the defensive
 * non-matches (unknown field, type mismatch, nobody-waiting).
 */
import { describe, it, expect } from 'vitest'
import { evaluateCondition, type WorkflowCondition } from '../condition.evaluator'
import { makeConditionContext } from './workflow-test-utils'

const baseCtx = makeConditionContext

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
    // Absent message -> body resolves null -> an unresolved subject, so
    // neither "contains" nor "not_contains" matches (not_contains is a
    // negative operator: it now requires the subject to be present, same as
    // every other operator except is_empty).
    const noMsg = baseCtx({ message: null })
    no({ field: 'message.body', op: 'contains', value: 'anything' }, noMsg)
    no({ field: 'message.body', op: 'not_contains', value: 'anything' }, noMsg)
    ok({ field: 'message.body', op: 'is_empty' }, noMsg)
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

    // Unassigned (assignedTeamId: null): per the evaluator's null contract
    // every operator is a non-match — including neq, so rules never silently
    // fire on unassigned conversations — and is_empty is the deliberate
    // "no team" test.
    const unassigned = baseCtx({
      conversation: { ...baseCtx().conversation, assignedTeamId: null },
    })
    no({ field: 'conversation.team', op: 'eq', value: 'team_support' }, unassigned)
    no({ field: 'conversation.team', op: 'neq', value: 'team_support' }, unassigned)
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
    // Negative operators used to get a free pass on an unresolved subject
    // (neq/not_contains/excludes_all all matched undefined) — a typo'd key
    // with a negative operator would always fire. They now require the
    // subject to be present, same as their positive counterparts.
    no({ field: 'conversation.attr.plan', op: 'neq', value: 'pro' }, bare)
    no({ field: 'conversation.attr.plan', op: 'not_contains', value: 'pro' }, bare)
    no({ field: 'conversation.attr.areas', op: 'excludes_all', value: ['opt_billing'] }, bare)
    ok({ field: 'conversation.attr.plan', op: 'is_empty' }, bare)
  })
})

describe('evaluateCondition — person.attr.<key> / company.attr.<key> (bare values, no envelope)', () => {
  it('reads person and company attributes directly, unlike conversation.attr envelopes', () => {
    ok({ field: 'person.attr.plan', op: 'eq', value: 'enterprise' })
    no({ field: 'person.attr.plan', op: 'eq', value: 'starter' })
    ok({ field: 'person.attr.seats', op: 'gt', value: 10 })
    ok({ field: 'person.attr.active', op: 'eq', value: true })
    ok({ field: 'company.attr.plan', op: 'eq', value: 'enterprise' })
    ok({ field: 'company.attr.arr', op: 'gte', value: 50000 })
    no({ field: 'company.attr.arr', op: 'gt', value: 50000 })
  })

  it('an unset key is unresolved: only is_empty matches', () => {
    ok({ field: 'person.attr.missing', op: 'is_empty' })
    no({ field: 'person.attr.missing', op: 'is_set' })
    no({ field: 'person.attr.missing', op: 'eq', value: 'x' })
    no({ field: 'person.attr.missing', op: 'neq', value: 'x' })
    ok({ field: 'company.attr.missing', op: 'is_empty' })
    no({ field: 'company.attr.missing', op: 'eq', value: 'x' })
  })

  it('an anonymous visitor (no person) resolves every person.attr as unresolved', () => {
    const anon = baseCtx({ person: null })
    no({ field: 'person.attr.plan', op: 'eq', value: 'enterprise' }, anon)
    no({ field: 'person.attr.plan', op: 'neq', value: 'enterprise' }, anon)
    ok({ field: 'person.attr.plan', op: 'is_empty' }, anon)
  })

  it('no linked company resolves every company.attr as unresolved', () => {
    const noCompany = baseCtx({ company: null })
    no({ field: 'company.attr.plan', op: 'eq', value: 'enterprise' }, noCompany)
    no({ field: 'company.attr.plan', op: 'neq', value: 'enterprise' }, noCompany)
    ok({ field: 'company.attr.plan', op: 'is_empty' }, noCompany)
  })
})

describe('evaluateCondition — person.email', () => {
  it('matches the resolved, realEmail-sanitized address', () => {
    ok({ field: 'person.email', op: 'eq', value: 'ana@example.com' })
    no({ field: 'person.email', op: 'eq', value: 'someone-else@example.com' })
    ok({ field: 'person.email', op: 'contains', value: '@example.com' })
    ok({ field: 'person.email', op: 'is_set' })
  })

  it('is unresolved (MISSING) for an anonymous visitor with no email', () => {
    const anon = baseCtx({ person: { segmentIds: [] } })
    no({ field: 'person.email', op: 'eq', value: 'ana@example.com' }, anon)
    no({ field: 'person.email', op: 'is_set' }, anon)
    ok({ field: 'person.email', op: 'is_empty' }, anon)
  })

  it('is unresolved for the synthetic anonymous placeholder — the context resolver never surfaces it, but the evaluator treats a null person.email the same either way', () => {
    const syntheticStripped = baseCtx({
      person: { segmentIds: [], email: null, attributes: {} },
    })
    no({ field: 'person.email', op: 'eq', value: 'ana@example.com' }, syntheticStripped)
    no({ field: 'person.email', op: 'is_set' }, syntheticStripped)
    ok({ field: 'person.email', op: 'is_empty' }, syntheticStripped)
  })
})

describe('evaluateCondition — unresolved-subject contract', () => {
  // Every operator exercised against undefined (a typo'd/archived attribute
  // key), null (an absent message), and an empty string (a genuinely
  // resolved but blank value) — the three behave differently. undefined and
  // null are "unresolved": no operator matches except is_empty. An empty
  // string IS resolved (the field has a value, it's just blank) and is
  // compared normally.
  const undefinedSubjectCtx = baseCtx({
    conversation: { ...baseCtx().conversation, attributes: {} },
  })
  const nullSubjectCtx = baseCtx({ message: null })
  const emptyStringSubjectCtx = baseCtx({ message: { body: '' } })

  it('undefined subject (conversation.attr.<key not present on the snapshot>): only is_empty matches', () => {
    const f = 'conversation.attr.missing' as const
    no({ field: f, op: 'eq', value: 'x' }, undefinedSubjectCtx)
    no({ field: f, op: 'neq', value: 'x' }, undefinedSubjectCtx)
    no({ field: f, op: 'contains', value: 'x' }, undefinedSubjectCtx)
    no({ field: f, op: 'not_contains', value: 'x' }, undefinedSubjectCtx)
    no({ field: f, op: 'gt', value: 1 }, undefinedSubjectCtx)
    no({ field: f, op: 'gte', value: 1 }, undefinedSubjectCtx)
    no({ field: f, op: 'lt', value: 1 }, undefinedSubjectCtx)
    no({ field: f, op: 'lte', value: 1 }, undefinedSubjectCtx)
    no({ field: f, op: 'includes_any', value: ['x'] }, undefinedSubjectCtx)
    no({ field: f, op: 'excludes_all', value: ['x'] }, undefinedSubjectCtx)
    no({ field: f, op: 'is_set' }, undefinedSubjectCtx)
    ok({ field: f, op: 'is_empty' }, undefinedSubjectCtx)
  })

  it('null subject (message.body with no triggering message): only is_empty matches', () => {
    const f = 'message.body' as const
    no({ field: f, op: 'eq', value: 'x' }, nullSubjectCtx)
    no({ field: f, op: 'neq', value: 'x' }, nullSubjectCtx)
    no({ field: f, op: 'contains', value: 'x' }, nullSubjectCtx)
    no({ field: f, op: 'not_contains', value: 'x' }, nullSubjectCtx)
    no({ field: f, op: 'includes_any', value: ['x'] }, nullSubjectCtx)
    no({ field: f, op: 'excludes_all', value: ['x'] }, nullSubjectCtx)
    no({ field: f, op: 'is_set' }, nullSubjectCtx)
    ok({ field: f, op: 'is_empty' }, nullSubjectCtx)
  })

  it('empty-string subject (a real, resolved, blank message body) compares normally — NOT unresolved', () => {
    const f = 'message.body' as const
    no({ field: f, op: 'eq', value: 'x' }, emptyStringSubjectCtx)
    // Unlike null/undefined, a resolved '' really is not 'x' — neq matches.
    ok({ field: f, op: 'neq', value: 'x' }, emptyStringSubjectCtx)
    no({ field: f, op: 'contains', value: 'x' }, emptyStringSubjectCtx)
    // Unlike null/undefined, a resolved '' really doesn't contain 'x'.
    ok({ field: f, op: 'not_contains', value: 'x' }, emptyStringSubjectCtx)
    ok({ field: f, op: 'is_empty' }, emptyStringSubjectCtx)
    no({ field: f, op: 'is_set' }, emptyStringSubjectCtx)
  })

  it('eq with a null condition value never matches an unresolved subject (null === null would otherwise slip through)', () => {
    // JSON-mode authoring leaves `value` unknown/optional, so a saved
    // condition can carry value: null. Against an unresolved (null/undefined)
    // subject, eq must stay a non-match like every other operator here — a
    // bare `actual === value` would let null === null match, contradicting
    // the contract and neq's own symmetry (neq already guards on unresolved).
    no({ field: 'message.body', op: 'eq', value: null }, nullSubjectCtx)
    no({ field: 'conversation.attr.missing', op: 'eq', value: null }, undefinedSubjectCtx)
  })
})

describe('evaluateCondition — numeric-aware eq/neq', () => {
  it('a numeric attribute matches a numeric-string condition value (5 vs "5")', () => {
    ok({ field: 'conversation.attr.seats', op: 'eq', value: '12' })
    no({ field: 'conversation.attr.seats', op: 'eq', value: '13' })
    ok({ field: 'conversation.attr.seats', op: 'neq', value: '13' })
    no({ field: 'conversation.attr.seats', op: 'neq', value: '12' })
  })

  it('an empty-string condition value never numeric-coerces to 0', () => {
    // Number('') === 0 — a naive coercion would wrongly treat an empty
    // (unset placeholder) condition value as matching a seats value of 0.
    no({ field: 'conversation.attr.seats', op: 'eq', value: '' })
    ok({ field: 'conversation.attr.seats', op: 'neq', value: '' })
  })

  it('a non-numeric string never numeric-coerces', () => {
    no({ field: 'conversation.attr.seats', op: 'eq', value: 'twelve' })
    ok({ field: 'conversation.attr.seats', op: 'neq', value: 'twelve' })
  })

  it('booleans stay strict against a string — "true" vs true do NOT match', () => {
    const withFlag = baseCtx({
      conversation: {
        ...baseCtx().conversation,
        attributes: { active: { v: true, src: 'teammate', at: '2026-07-05T00:00:00.000Z' } },
      },
    })
    no({ field: 'conversation.attr.active', op: 'eq', value: 'true' }, withFlag)
    ok({ field: 'conversation.attr.active', op: 'eq', value: true }, withFlag)
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
        { field: 'conversation.channel', op: 'eq', value: 'sms' },
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
