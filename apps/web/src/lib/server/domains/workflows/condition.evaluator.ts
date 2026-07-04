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
 */

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
  }
  message?: { body: string; senderType?: 'visitor' | 'agent' } | null
  person?: { segmentIds: string[] } | null
  /** Whether the workspace is within office hours at evaluation time. */
  officeHours?: boolean | null
  /** The conversation's last CSAT rating (1-5), or null. */
  csatRating?: number | null
}

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

/** Pull the value a `field` names out of the resolved context (undefined = the
 *  field isn't known, which every operator treats as a non-match). */
function resolveField(field: string, ctx: ConditionContext): unknown {
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

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v])

/** Apply one operator to a resolved value; defensive on type mismatch (false). */
function applyOp(actual: unknown, op: ConditionOperator, value: unknown): boolean {
  switch (op) {
    case 'eq':
      return actual === value
    case 'neq':
      return actual !== value
    case 'contains':
    case 'not_contains': {
      const hit =
        typeof actual === 'string' &&
        typeof value === 'string' &&
        actual.toLowerCase().includes(value.toLowerCase())
      return op === 'contains' ? hit : !hit
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (actual === null || actual === undefined) return false // e.g. nobody waiting
      const a = Number(actual)
      const b = Number(value)
      if (Number.isNaN(a) || Number.isNaN(b)) return false
      return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b
    }
    case 'includes_any':
    case 'excludes_all': {
      const have = asArray(actual)
      const anyIn = asArray(value).some((v) => have.includes(v))
      return op === 'includes_any' ? anyIn : !anyIn
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
