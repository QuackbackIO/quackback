/**
 * The workflow Condition evaluator (support platform §4.6, Slice 4). A PURE
 * `evaluateCondition(cond, ctx)` over an already-resolved snapshot — no DB access
 * inside — so it unit-tests exhaustively. The engine (Slice 5) resolves the
 * snapshot once per trigger and reuses it for both branch nodes (first path whose
 * condition matches wins) and apply-rules nodes (run every matching rule); the
 * evaluator itself only answers "does this condition hold for this context?".
 *
 * Conditions are a small generic tree: leaves are `{ field, op, value }` and
 * groups combine children with `all` (every) / `any` (some). The catalogue of
 * fields/operators is validated at the authoring (save) layer; the evaluator is
 * deliberately defensive — an unknown field or a type-mismatched compare yields
 * false rather than throwing, so a malformed graph can never crash a run.
 *
 * Unresolved-subject contract: when a field resolves to null/undefined (an
 * absent message, a typo'd `conversation.attr.<key>`, an unset csat rating,
 * ...) every operator is a non-match EXCEPT `is_empty` — see applyOp's doc.
 * A negative operator (neq/not_contains/excludes_all) does NOT get a free
 * pass here: it requires the subject to be present, same as eq/contains/
 * includes_any do, so a typo'd field can never make a negative condition
 * fire. `eq`/`neq` are numeric-aware: a number compared against a numeric
 * string (5 vs "5") matches; any other cross-type compare (e.g. a boolean
 * against the string "true") stays strict.
 */
import { readAttributeValue } from '@/lib/shared/conversation/attribute-values'

/** The resolved snapshot conditions read. Optional branches are absent when the
 *  trigger has no message/person/etc. in scope (a leaf over an absent branch
 *  simply doesn't match). */
export interface ConditionContext {
  conversation: {
    status: string
    channel: string
    priority: string
    /** Minutes the customer has been waiting on a reply; null = nobody waiting. */
    waitingMinutes: number | null
    tagIds: string[]
    /** The team the conversation is assigned to, or null when unassigned. */
    assignedTeamId: string | null
    /** Raw custom_attributes ({ v, src, at } envelopes or bare legacy values);
     *  `conversation.attr.<key>` predicates read through readAttributeValue. */
    attributes?: Record<string, unknown>
    /** The conversation's visitor principal — the actor a block CSAT resume
     *  records the rating as (recordCsat requires the caller to BE the
     *  visitor). Not a condition field; carried here purely so the engine
     *  doesn't need a second query to learn it. */
    visitorPrincipalId?: string | null
  }
  message?: { body: string; senderType?: 'visitor' | 'agent' } | null
  person?: {
    segmentIds: string[]
    /** realEmail()-sanitized — the synthetic anonymous placeholder
     *  (temp-<id>@anon.quackback.io) never surfaces here, so `person.email`
     *  reads as unresolved (MISSING) for an anonymous visitor, same as one
     *  with no email captured at all. */
    email?: string | null
    /** The user row's first-class columns (ISO-3166-1 alpha-2 country,
     *  captured from geo-aware proxy headers; BCP-47 locale) — NOT part of
     *  `attributes`, which only carries user.metadata. Null when never
     *  captured; unresolved either way. */
    country?: string | null
    locale?: string | null
    /** The visitor's plan/tier label — the `plan` key of user.metadata, the
     *  same source the segment evaluator's own `plan` attribute reads
     *  (segment.evaluation.ts), so workflows and segments share one plan
     *  vocabulary. First-class (like person.email) rather than only
     *  person.attr.plan so the three targeting staples (country, locale,
     *  plan) sit together in the static catalogue. Null when unset. */
    plan?: string | null
    /** The identified visitor's own attributes (user.metadata), bare values
     *  (no envelope — unlike conversation.attributes, this store was never
     *  enveloped). Absent/undefined for an anonymous visitor. */
    attributes?: Record<string, unknown>
  } | null
  /** The visitor's company (principal.company_id -> companies), when linked.
   *  Absent when the visitor has no company (including every anonymous
   *  visitor, who can never be linked). */
  company?: {
    /** Bare values in companies.custom_attributes — no envelope, same as
     *  person.attributes. */
    attributes?: Record<string, unknown>
  } | null
  /** The CUSTOMER ticket paired with the conversation — for a ticket trigger,
   *  the very ticket that fired the workflow (the pair is 1:1, so resolving it
   *  back from the conversation the trigger resolved cannot land on a
   *  different ticket). Null when the conversation has no customer ticket, or
   *  when the caller skipped the resolution; either way `ticket.type` reads as
   *  unresolved (MISSING). */
  ticket?: { typeId: string | null } | null
  /** Whether the workspace is within office hours at evaluation time. */
  officeHours?: boolean | null
  /** The conversation's last CSAT rating (1-5), or null. */
  csatRating?: number | null
  /** The customer's structured reply, threaded in ONLY when resuming a run
   *  parked at an input wait (resumeWorkflowRun's blockAnswer option). The
   *  walker reads this to tell "reached this interactive node fresh" (park)
   *  from "resuming this exact node" (route/write and continue) apart — see
   *  graph.ts's per-kind handling. Absent on every ordinary trigger walk. */
  blockAnswer?: BlockAnswer | null
  /** How Quinn's turn ended, threaded in ONLY when resuming a run parked at
   *  a `let_assistant_answer` wait (resumeWorkflowRun's assistantOutcome
   *  option) — the walker's equivalent of blockAnswer for that node kind
   *  (Phase C, slice C-6). 'escalated' = assistant.handed_off fired for this
   *  conversation (a human is needed); 'resolved' = the conversation closed
   *  while parked there (read as "Quinn resolved it" — the classic
   *  resolved-then-follow-up pattern). Absent on every ordinary trigger walk. */
  assistantOutcome?: AssistantOutcome | null
}

/** See ConditionContext.assistantOutcome's doc. */
export type AssistantOutcome = 'escalated' | 'resolved'

/** The customer's structured reply to a parked interactive block, resolved
 *  from its stored BlockReplyMetadata (event-trigger.ts) and threaded into a
 *  resume's ConditionContext. One variant per interactive node kind. */
export type BlockAnswer =
  | { kind: 'buttons'; buttonKey: string }
  | { kind: 'collect'; value: string | number | boolean }
  | { kind: 'collectReply'; value: string }
  | { kind: 'csat'; rating: number; comment?: string }

export type ConditionOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'contains_any'
  | 'contains_all'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'includes_any'
  | 'excludes_all'
  | 'is_set'
  | 'is_empty'

export interface ConditionLeaf {
  field: string
  op: ConditionOperator
  value?: unknown
}

export interface ConditionGroup {
  all?: WorkflowCondition[]
  any?: WorkflowCondition[]
}

export type WorkflowCondition = ConditionLeaf | ConditionGroup

/**
 * Recursively test whether ANY leaf field in a condition tree (leaf or
 * all/any group, arbitrarily nested) satisfies `predicate` — shared by
 * anything that needs to know IF a condition tree references a certain KIND
 * of field without caring which specific one (e.g. dispatcher.ts's gates on
 * the optional pieces of the snapshot). Kept here rather than duplicated per caller so
 * a future group shape (this module's own recursion) can't drift from
 * evaluateCondition's own walk.
 */
export function someConditionField(
  condition: WorkflowCondition,
  predicate: (field: string) => boolean
): boolean {
  if ('field' in condition) return predicate(condition.field)
  return (
    (condition.all ?? []).some((c) => someConditionField(c, predicate)) ||
    (condition.any ?? []).some((c) => someConditionField(c, predicate))
  )
}

/**
 * The condition fields the evaluator knows — the single catalogue the authoring
 * validation (workflow.schemas) derives its allowed set from, so a typo'd field
 * (conversation.stattus) is rejected on save instead of silently never matching.
 * Keep in sync with resolveField's switch.
 */
export const CONDITION_FIELDS = [
  'conversation.status',
  'conversation.channel',
  'conversation.priority',
  'conversation.waiting_minutes',
  'conversation.tags',
  'conversation.team',
  'message.body',
  'message.sender',
  'person.segments',
  'person.email',
  'person.country',
  'person.locale',
  'person.plan',
  'ticket.type',
  'office_hours',
  'csat.rating',
] as const

/**
 * Dynamic attribute predicates: `conversation.attr.<key>` resolves the value
 * stored under `<key>` in the conversation's custom_attributes (envelopes
 * unwrapped, bare legacy values passed through). The authoring validation
 * accepts this prefix alongside the static catalogue.
 */
export const ATTRIBUTE_FIELD_PREFIX = 'conversation.attr.'

/**
 * Dynamic person/company attribute predicates: `person.attr.<key>` /
 * `company.attr.<key>` resolve the value stored under `<key>` in, respectively,
 * the visitor's user.metadata and their company's custom_attributes. Unlike
 * ATTRIBUTE_FIELD_PREFIX's conversation attributes, neither store uses the
 * `{ v, src, at }` envelope (verified against user.attributes.ts's
 * parseUserAttributes and the segment evaluator's raw company_attr JSON
 * reads) — values here are read bare, no readAttributeValue unwrap.
 */
export const PERSON_ATTRIBUTE_FIELD_PREFIX = 'person.attr.'
export const COMPANY_ATTRIBUTE_FIELD_PREFIX = 'company.attr.'

/** Pull the value a `field` names out of the resolved context (undefined = the
 *  field isn't known, which every operator treats as a non-match). */
function resolveField(field: string, ctx: ConditionContext): unknown {
  if (field.startsWith(ATTRIBUTE_FIELD_PREFIX)) {
    const key = field.slice(ATTRIBUTE_FIELD_PREFIX.length)
    return readAttributeValue(ctx.conversation.attributes?.[key])?.v
  }
  if (field.startsWith(PERSON_ATTRIBUTE_FIELD_PREFIX)) {
    // Bare values, not envelopes — see PERSON_ATTRIBUTE_FIELD_PREFIX's doc.
    const key = field.slice(PERSON_ATTRIBUTE_FIELD_PREFIX.length)
    return ctx.person?.attributes?.[key]
  }
  if (field.startsWith(COMPANY_ATTRIBUTE_FIELD_PREFIX)) {
    const key = field.slice(COMPANY_ATTRIBUTE_FIELD_PREFIX.length)
    return ctx.company?.attributes?.[key]
  }
  switch (field) {
    case 'conversation.status':
      return ctx.conversation.status
    case 'conversation.channel':
      return ctx.conversation.channel
    case 'conversation.priority':
      return ctx.conversation.priority
    case 'conversation.waiting_minutes':
      return ctx.conversation.waitingMinutes
    case 'conversation.tags':
      return ctx.conversation.tagIds
    // Unassigned resolves to null, same as e.g. csat.rating: per applyOp's
    // null contract every operator is a non-match, and `is_empty` is the
    // deliberate way to test for "no team".
    case 'conversation.team':
      return ctx.conversation.assignedTeamId
    case 'message.body':
      return ctx.message?.body ?? null
    case 'message.sender':
      // 'visitor' | 'agent' — lets a message-triggered workflow tell a customer
      // message apart from a teammate reply (both raise message.created).
      return ctx.message?.senderType ?? null
    case 'person.segments':
      return ctx.person?.segmentIds ?? []
    // null (an anonymous visitor, or an identified one with no captured
    // email) and undefined (no person at all) are both unresolved per
    // isUnresolved — either way `person.email` is a non-match except is_empty.
    case 'person.email':
      return ctx.person?.email
    // The visitor's first-class user columns and metadata plan — see
    // ConditionContext.person's docs. Null when the visitor is anonymous or
    // the value was never captured; one unresolved subject either way.
    case 'person.country':
      return ctx.person?.country ?? null
    case 'person.locale':
      return ctx.person?.locale ?? null
    case 'person.plan':
      return ctx.person?.plan ?? null
    // The workspace-defined ticket type (ticket_types.id), not the coarse
    // category axis. No paired ticket, and a ticket predating the type
    // registry, both resolve null — one unresolved subject either way, so
    // `is_empty` is the way to test "no ticket type".
    case 'ticket.type':
      return ctx.ticket?.typeId ?? null
    case 'office_hours':
      return ctx.officeHours ?? null
    case 'csat.rating':
      return ctx.csatRating ?? null
    default:
      return undefined
  }
}

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

/** null and undefined both mean "this field has nothing to compare" — an
 *  absent message, a typo'd/archived attribute key, an unset csat rating.
 *  Narrower than isBlank: an empty string or empty array is a real, resolved
 *  value (the field IS there, it's just empty), not an unresolved subject. */
const isUnresolved = (v: unknown): boolean => v === null || v === undefined

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v])

/** A numeric string ("5", " 12.5") parsed to a finite number, or null for
 *  anything else (including "", which Number() would otherwise read as 0). */
function parseFiniteNumber(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Strict equality, except a number compared against a numeric string
 *  compares numerically (a `number`-typed attribute vs a condition value
 *  that arrived as a string — e.g. from the API or a loosely-typed import —
 *  should still match: 5 and "5" are the same value). Any other type
 *  mismatch (a boolean vs the string "true", for instance) stays strict:
 *  that's a genuinely different stored type, not a serialization artifact. */
function looseEq(actual: unknown, value: unknown): boolean {
  if (typeof actual === 'number' && typeof value === 'string') {
    const v = parseFiniteNumber(value)
    if (v !== null) return actual === v
  } else if (typeof value === 'number' && typeof actual === 'string') {
    const a = parseFiniteNumber(actual)
    if (a !== null) return a === value
  }
  return actual === value
}

/**
 * Apply one operator to a resolved value; defensive on type mismatch (false).
 *
 * Contract for an unresolved subject (null/undefined — see isUnresolved):
 * every operator treats it as a non-match EXCEPT `is_empty`, which matches.
 * That includes the "negative" operators (neq/not_contains/excludes_all) —
 * they require the subject to be present, same as their positive
 * counterparts, so a typo'd `conversation.attr.<key>` (which resolves
 * undefined) can never make a negative condition fire. A resolved-but-empty
 * subject (`''`, `[]`) is NOT unresolved and is compared normally.
 */
function applyOp(actual: unknown, op: ConditionOperator, value: unknown): boolean {
  const unresolved = isUnresolved(actual)
  switch (op) {
    case 'eq':
      // Guarded the same way neq already is: an unresolved subject is a
      // non-match even when the condition's own value is null (authorable in
      // JSON mode — conditionSchema's value is unknown/optional), otherwise
      // `null === null` would match and contradict the documented contract.
      return !unresolved && looseEq(actual, value)
    case 'neq':
      return !unresolved && !looseEq(actual, value)
    case 'contains':
    case 'not_contains': {
      const hit =
        typeof actual === 'string' &&
        typeof value === 'string' &&
        actual.toLowerCase().includes(value.toLowerCase())
      return op === 'contains' ? hit : !unresolved && !hit
    }
    case 'contains_any':
    case 'contains_all': {
      // Keyword-list matching on a text subject (the message.body staple):
      // every listed keyword is a case-insensitive substring test, any vs all
      // deciding whether one hit or every hit is required. The value is
      // normally a string array; a bare string (JSON-mode authoring) reads as
      // a single keyword via asArray. Non-string and blank entries are
      // dropped, and an empty effective keyword list never matches — a
      // misconfigured rule must not let every message through. Unresolved
      // subject: non-match, per the contract above.
      if (unresolved || typeof actual !== 'string') return false
      const keywords = asArray(value).filter(
        (v): v is string => typeof v === 'string' && v.trim() !== ''
      )
      if (keywords.length === 0) return false
      const haystack = actual.toLowerCase()
      const hits = keywords.filter((k) => haystack.includes(k.toLowerCase()))
      return op === 'contains_any' ? hits.length > 0 : hits.length === keywords.length
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (unresolved) return false // e.g. nobody waiting
      const a = Number(actual)
      const b = Number(value)
      if (Number.isNaN(a) || Number.isNaN(b)) return false
      return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b
    }
    case 'includes_any':
    case 'excludes_all': {
      const have = asArray(actual)
      const anyIn = asArray(value).some((v) => have.includes(v))
      return op === 'includes_any' ? anyIn : !unresolved && !anyIn
    }
    case 'is_set':
      return !isBlank(actual)
    case 'is_empty':
      return isBlank(actual)
  }
}

/**
 * Evaluate a condition (leaf or group) against a resolved context. Groups: every
 * `all` child must hold, and at least one `any` child must hold (an absent or
 * empty `any` is no constraint). A group with neither is vacuously true.
 */
export function evaluateCondition(cond: WorkflowCondition, ctx: ConditionContext): boolean {
  if ('field' in cond) {
    return applyOp(resolveField(cond.field, ctx), cond.op, cond.value)
  }
  if (cond.all && !cond.all.every((c) => evaluateCondition(c, ctx))) return false
  if (cond.any && cond.any.length > 0 && !cond.any.some((c) => evaluateCondition(c, ctx))) {
    return false
  }
  return true
}
