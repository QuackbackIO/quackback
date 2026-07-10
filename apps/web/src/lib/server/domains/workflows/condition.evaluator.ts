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
  person?: { segmentIds: string[] } | null
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

/** Pull the value a `field` names out of the resolved context (undefined = the
 *  field isn't known, which every operator treats as a non-match). */
function resolveField(field: string, ctx: ConditionContext): unknown {
  if (field.startsWith(ATTRIBUTE_FIELD_PREFIX)) {
    const key = field.slice(ATTRIBUTE_FIELD_PREFIX.length)
    return readAttributeValue(ctx.conversation.attributes?.[key])?.v
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
