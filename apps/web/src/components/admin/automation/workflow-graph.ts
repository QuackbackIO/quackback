/**
 * Client-side model for the workflow builder canvas (support platform §4.6).
 *
 * The stored graph JSON ({ nodes, edges }, validated server-side by
 * workflowGraphSchema) is the single source of truth; the canvas is a lossless
 * view over it. This module converts between that JSON and the path tree the
 * canvas renders (graphToTree / treeToGraph), validates JSON edits client-side
 * with the same rules the server enforces, and carries the field / operator /
 * action catalogues with display labels. Server catalogues are imported
 * type-only, so every catalogue here is compile-pinned to the server's: adding
 * a field or action server-side fails the typecheck until the editor knows it.
 */
import {
  MAX_FREQUENCY_CAP_COUNT,
  MAX_FREQUENCY_CAP_DAYS,
  MAX_WAIT_SECONDS,
  MAX_ASSISTANT_STEP_INSTRUCTIONS,
  PARKING_BLOCK_KINDS,
  classRestrictedNodeIssue,
  duplicateStepIdMessage,
  missingStepMessage,
  undeclaredBranchPathMessage,
} from '@/lib/server/domains/workflows/workflow.schemas'
import type {
  FrequencyCap,
  ValidatedWorkflowGraph,
} from '@/lib/server/domains/workflows/workflow.schemas'
// Re-exported so every other cap symbol (and now these two bounds) flows
// through this module: the one client-side boundary onto workflow.schemas.ts
// for the feature, instead of individual editors reaching past it.
export { MAX_FREQUENCY_CAP_COUNT, MAX_FREQUENCY_CAP_DAYS, MAX_ASSISTANT_STEP_INSTRUCTIONS }
import type {
  ATTRIBUTE_FIELD_PREFIX as ServerAttributeFieldPrefix,
  CONDITION_FIELDS,
} from '@/lib/server/domains/workflows/condition.evaluator'

export type { FrequencyCap } from '@/lib/server/domains/workflows/workflow.schemas'
import { DISPATCHABLE_TRIGGER_TYPES } from '@/lib/shared/workflow-trigger-types'

export type { ConditionOperator } from '@/lib/server/domains/workflows/condition.evaluator'
import type { ConditionOperator } from '@/lib/server/domains/workflows/condition.evaluator'
import { CSAT_FACES } from '@/lib/shared/db-types'
import type { TiptapContent } from '@/lib/shared/db-types'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'

// ---------------------------------------------------------------------------
// Graph JSON types (plain-string ids: the exact shape the save mutation takes)
// ---------------------------------------------------------------------------

export type WorkflowGraphJson = ValidatedWorkflowGraph
export type GraphNode = WorkflowGraphJson['nodes'][number]
export type GraphEdge = WorkflowGraphJson['edges'][number]
export type GraphAction = Extract<GraphNode, { type: 'action' }>['action']
export type ActionType = GraphAction['type']
export type GraphCondition = Extract<GraphNode, { type: 'condition' }>['condition']

// ---------------------------------------------------------------------------
// Conversational block kinds (Phase C, slice C-5 — the visual builder side of
// the 8 node kinds C-1 added to the runtime: workflow.schemas.ts / graph.ts).
// Body types are derived from GraphNode (the zod-inferred shape) rather than
// re-declared, the same "derive, don't duplicate" pattern GraphAction /
// GraphCondition already use above — a server-side field addition/rename
// fails typecheck here too.
// ---------------------------------------------------------------------------
export type BlockBody = Extract<GraphNode, { type: 'message' }>['body']
export type GraphButtonOption = Extract<GraphNode, { type: 'reply_buttons' }>['options'][number]
export type GraphAttributeOption = NonNullable<
  Extract<GraphNode, { type: 'collect_data' }>['options']
>[number]
export type CollectFieldType = Extract<GraphNode, { type: 'collect_data' }>['fieldType']

export type BlockStepKind =
  | 'message'
  | 'show_reply_time'
  | 'let_assistant_answer'
  | 'disable_composer'
  | 'reply_buttons'
  | 'collect_data'
  | 'collect_reply'
  | 'request_csat'

export const BLOCK_STEP_LABELS: Record<BlockStepKind, string> = {
  message: 'Message',
  show_reply_time: 'Show expected reply time',
  let_assistant_answer: 'Let Quinn answer',
  disable_composer: 'Disable replies',
  reply_buttons: 'Reply buttons',
  collect_data: 'Collect data',
  collect_reply: 'Collect customer reply',
  request_csat: 'Ask for a rating',
}

/** The palette's SEND group: posts a message (or nothing, for the pure
 *  control-flow kinds) and continues immediately. */
export const SEND_BLOCK_KINDS: readonly BlockStepKind[] = [
  'message',
  'show_reply_time',
  'let_assistant_answer',
  'disable_composer',
]
/** The palette's COLLECT group: posts a message and parks the run for the
 *  customer's structured reply. */
export const COLLECT_BLOCK_KINDS: readonly BlockStepKind[] = [
  'reply_buttons',
  'collect_data',
  'collect_reply',
  'request_csat',
]

/** A minimal, schema-valid empty rich-text body — one empty paragraph. */
export const EMPTY_BLOCK_BODY: BlockBody = { type: 'doc', content: [{ type: 'paragraph' }] }

// blockBodySchema's z.ZodType annotation (workflow.schemas.ts) declares
// `content?: unknown[]` rather than a self-referencing array — a deliberate
// simplification there, not something this module should fight — so every
// recursive walk below casts one level at a time via this helper instead of
// threading `as BlockBody[]` through each call site.
function bodyChildren(node: BlockBody): BlockBody[] {
  return (node.content ?? []) as BlockBody[]
}

/** True when a block body carries no visible text — gates the builder's
 *  issues chip (an unwritten prompt can't go live). `BlockBody` and
 *  `TiptapContent` are the same doc/paragraph/text JSON shape (the
 *  block-body schema is deliberately less strict about `content`'s element
 *  type — see bodyChildren's comment — hence the cast), so this defers to
 *  the one shared empty-doc rule (`lib/shared/utils/is-empty-tiptap-doc.ts`,
 *  also used by the widget-side welcome card) rather than re-implementing
 *  the same paragraph/heading/blockquote/text walk here. */
export function isBlockBodyEmpty(body: BlockBody | undefined): boolean {
  return isEmptyTiptapDoc(body as unknown as TiptapContent | undefined)
}

function blockBodyText(body: BlockBody): string {
  const parts: string[] = []
  const walk = (node: BlockBody) => {
    if (node.text) parts.push(node.text)
    bodyChildren(node).forEach(walk)
  }
  walk(body)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** A short plain-text preview of a block's rich body, for canvas cards and
 *  outline rows — the closest thing the builder has to "what the customer
 *  will see" without rendering the full rich text. */
export function blockBodyPreview(body: BlockBody | undefined, maxLen = 80): string {
  const text = body ? blockBodyText(body) : ''
  if (!text) return 'Empty message'
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text
}

/** Append a `{key|}` dynamic-variable token (WORKFLOW_VARIABLE_CATALOGUE,
 *  lib/shared/workflows/interpolate.ts's token syntax) to a block body's last
 *  paragraph, or a fresh one if the body is empty. The fallback text after
 *  `|` starts blank — the admin types it in place as ordinary rich text, the
 *  "fallback affordance" the design brief calls for, since the token is just
 *  literal characters once inserted (no special widget needed). Used by the
 *  message editor's insert-variable menu; a pure function so the caller (the
 *  React component) stays a thin wrapper. */
export function insertVariableToken(body: BlockBody, key: string): BlockBody {
  const token = `{${key}|}`
  const content = [...bodyChildren(body)]
  const last = content[content.length - 1]
  if (last && last.type === 'paragraph') {
    content[content.length - 1] = {
      ...last,
      content: [...bodyChildren(last), { type: 'text', text: token }],
    }
  } else {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: token }] })
  }
  return { ...body, content }
}

/** Ratings the request_csat block can branch on (mirrors the server walker's
 *  `String(rating)` exact-match branch keys, graph.ts's request_csat resume
 *  case — a 5-emoji CSAT per the design brief, keyed 1-5 low to high). */
export const RATING_KEYS = ['1', '2', '3', '4', '5'] as const
export type RatingKey = (typeof RATING_KEYS)[number]
/** Derived from the canonical CSAT_FACES (index = rating-1) rather than its
 *  own hardcoded set, so the canvas summary (flow-layout.ts) shows the exact
 *  row the customer actually taps in the widget — not a lookalike-but-
 *  different emoji set authored separately here. */
export const RATING_EMOJI: Record<RatingKey, string> = Object.fromEntries(
  RATING_KEYS.map((key, i) => [key, CSAT_FACES[i]])
) as Record<RatingKey, string>
const RATING_TEXT: Record<RatingKey, string> = {
  '1': 'Very unhappy',
  '2': 'Unhappy',
  '3': 'Neutral',
  '4': 'Happy',
  '5': 'Very happy',
}
/** The rating editor's add-path menu labels ("😞 Very unhappy" etc.) — built
 *  from RATING_EMOJI rather than its own hardcoded glyph set (the bug this
 *  fixes: the editor previously pinned an old 😡/😍 pair the canvas and the
 *  customer-facing widget had already moved off of, via CSAT_FACES). */
export const RATING_LABELS: Record<RatingKey, string> = Object.fromEntries(
  RATING_KEYS.map((key) => [key, `${RATING_EMOJI[key]} ${RATING_TEXT[key]}`])
) as Record<RatingKey, string>

/** Fixed path keys for let_assistant_answer's two edges — the default
 *  (unlabeled) continuation and the labeled "escalated to a human" edge
 *  (graph.ts: reserved for a later invocation seam, not yet consulted by the
 *  runtime walker — see this module's round-trip tests for why the builder
 *  still authors it: the edge is schema-valid and forward-compatible today). */
export const LET_ASSISTANT_DEFAULT_KEY = 'continue'
export const LET_ASSISTANT_ESCALATED_KEY = 'escalated'

/** Attribute field types collect_data supports (a subset of the full
 *  registry — mirrors workflow.schemas.ts's collect_data.fieldType enum;
 *  multi_select/checkbox have no collect_data equivalent in the v1 runtime). */
export const COLLECT_FIELD_TYPES: readonly CollectFieldType[] = ['text', 'number', 'select', 'date']

/**
 * Mirrors condition.evaluator's ATTRIBUTE_FIELD_PREFIX. The type-only import
 * above pins the literal so a server-side rename fails typecheck here too —
 * the server module can't be imported as a *value* from client code (only
 * its types), so the string itself has to be re-declared, not re-exported.
 */
export const ATTRIBUTE_FIELD_PREFIX: typeof ServerAttributeFieldPrefix = 'conversation.attr.'

/** The 11 built-in condition fields (mirrors the server's CONDITION_FIELDS). */
export type StaticConditionField = (typeof CONDITION_FIELDS)[number]
/** A dynamic `conversation.attr.<key>` predicate against a live attribute definition. */
export type AttributeConditionField = `${typeof ATTRIBUTE_FIELD_PREFIX}${string}`
export type ConditionField = StaticConditionField | AttributeConditionField

type Priority = Extract<GraphAction, { type: 'set_priority' }>['priority']

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

// ---------------------------------------------------------------------------
// Catalogues (labels for the editor; Record keys keep them exhaustive)
// ---------------------------------------------------------------------------

export type ConditionValueKind = 'text' | 'number' | 'list' | 'boolean' | 'choice'

export interface ConditionFieldMeta {
  label: string
  kind: ConditionValueKind
  /** For kind 'choice': the allowed values. */
  options?: readonly { value: string; label: string }[]
  /** Placeholder for text / list inputs. */
  placeholder?: string
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}
export const PRIORITIES = Object.keys(PRIORITY_LABELS) as Priority[]

const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))

export const CONDITION_FIELD_META: Record<ConditionField, ConditionFieldMeta> = {
  'conversation.status': {
    label: 'Conversation status',
    kind: 'choice',
    // Mirrors CONVERSATION_STATUSES in @quackback/db/types.
    options: [
      { value: 'open', label: 'Open' },
      { value: 'snoozed', label: 'Snoozed' },
      { value: 'closed', label: 'Closed' },
    ],
  },
  'conversation.channel': {
    label: 'Channel',
    kind: 'choice',
    // Mirrors CHANNELS in @quackback/db/types.
    options: [
      { value: 'messenger', label: 'Messenger' },
      { value: 'email', label: 'Email' },
      { value: 'web_form', label: 'Web form' },
    ],
  },
  'conversation.priority': { label: 'Priority', kind: 'choice', options: PRIORITY_OPTIONS },
  'conversation.waiting_minutes': { label: 'Customer waiting (minutes)', kind: 'number' },
  // TODO: swap the raw-id inputs for tag / segment pickers.
  'conversation.tags': {
    label: 'Conversation tags',
    kind: 'list',
    placeholder: 'Tag IDs, comma-separated',
  },
  // No static options: the team list is live (WorkflowEntitiesProvider), so
  // resolveConditionField fills `options` in from the `teams` map it's
  // passed — the same lookup EntityLabels.teams already backs for actions.
  'conversation.team': { label: 'Team', kind: 'choice' },
  'message.body': { label: 'Message body', kind: 'text', placeholder: 'Text to match' },
  'message.sender': {
    label: 'Message sender',
    kind: 'choice',
    options: [
      { value: 'visitor', label: 'Customer' },
      { value: 'agent', label: 'Teammate' },
    ],
  },
  'person.segments': {
    label: 'Person segments',
    kind: 'list',
    placeholder: 'Segment IDs, comma-separated',
  },
  office_hours: { label: 'Within office hours', kind: 'boolean' },
  'csat.rating': { label: 'CSAT rating', kind: 'number' },
}

export const CONDITION_FIELD_LIST = Object.keys(CONDITION_FIELD_META) as StaticConditionField[]

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  not_contains: "doesn't contain",
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  includes_any: 'includes any of',
  excludes_all: 'includes none of',
  is_set: 'is set',
  is_empty: 'is empty',
}

/** Operators that take no value (the value input is hidden and omitted). */
export const VALUELESS_OPERATORS: ReadonlySet<ConditionOperator> = new Set(['is_set', 'is_empty'])

/** The operators that make sense per value kind, in menu order. */
export const OPERATORS_BY_KIND: Record<ConditionValueKind, readonly ConditionOperator[]> = {
  text: ['contains', 'not_contains', 'eq', 'neq', 'is_set', 'is_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_set', 'is_empty'],
  list: ['includes_any', 'excludes_all', 'is_set', 'is_empty'],
  boolean: ['eq', 'neq'],
  choice: ['eq', 'neq', 'is_set', 'is_empty'],
}

export const ALL_OPERATORS = Object.keys(OPERATOR_LABELS) as ConditionOperator[]

// ---------------------------------------------------------------------------
// Attribute conditions: `conversation.attr.<key>` fields, backed by the live
// conversation attribute registry (loaded by WorkflowEntitiesProvider). Unlike
// the static catalogue above, the field set is data-driven, so instead of a
// Record keyed by field there's a lookup (by attribute key) plus a resolver
// that produces the same shape of metadata the static CONDITION_FIELD_META
// entries carry, for a single call site (resolveConditionField) both the
// visual editor and the canvas/outline summaries can share.
// ---------------------------------------------------------------------------

/** Mirrors conversation_attribute_definitions.field_type. */
export type AttributeFieldType = 'text' | 'number' | 'select' | 'multi_select' | 'checkbox' | 'date'

export interface AttributeFieldDef {
  key: string
  label: string
  fieldType: AttributeFieldType
  /** select / multi_select only — option id is the stored value. */
  options?: readonly { id: string; label: string }[]
}

/** The operators offered per attribute field type (v1: date stays valueless-only). */
export const ATTRIBUTE_OPERATORS_BY_TYPE: Record<AttributeFieldType, readonly ConditionOperator[]> =
  {
    text: ['contains', 'not_contains', 'eq', 'neq', 'is_set', 'is_empty'],
    number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_set', 'is_empty'],
    select: ['eq', 'neq', 'is_set', 'is_empty'],
    multi_select: ['includes_any', 'excludes_all', 'is_set', 'is_empty'],
    checkbox: ['eq'],
    date: ['is_set', 'is_empty'],
  }

const ATTRIBUTE_VALUE_KIND: Record<AttributeFieldType, ConditionValueKind> = {
  text: 'text',
  number: 'number',
  select: 'choice',
  multi_select: 'list',
  checkbox: 'boolean',
  // Never actually rendered: date only ever offers valueless operators.
  date: 'text',
}

/** True for `conversation.attr.<key>` (with a non-empty key). */
export function isAttributeField(field: string): field is AttributeConditionField {
  return field.startsWith(ATTRIBUTE_FIELD_PREFIX) && field.length > ATTRIBUTE_FIELD_PREFIX.length
}

export function attributeKeyFromField(field: AttributeConditionField): string {
  return field.slice(ATTRIBUTE_FIELD_PREFIX.length)
}

export function attributeFieldForKey(key: string): AttributeConditionField {
  return `${ATTRIBUTE_FIELD_PREFIX}${key}` as AttributeConditionField
}

/**
 * Build the `key -> AttributeFieldDef` lookup resolveConditionField and the
 * value editors need, from anything shaped like the live attribute registry
 * (duck-typed so this module stays decoupled from the query layer's type —
 * WorkflowEntitiesProvider's ConversationAttributeItem[] satisfies this).
 */
export function toAttributeFieldDefs(
  items: readonly {
    key: string
    label: string
    fieldType: AttributeFieldType
    options?: readonly { id: string; label: string }[] | null
  }[]
): ReadonlyMap<string, AttributeFieldDef> {
  return new Map(
    items.map((d) => [
      d.key,
      { key: d.key, label: d.label, fieldType: d.fieldType, options: d.options ?? undefined },
    ])
  )
}

export interface ResolvedConditionField {
  label: string
  kind: ConditionValueKind
  operators: readonly ConditionOperator[]
  options?: readonly { value: string; label: string }[]
  placeholder?: string
  /** A `conversation.attr.*` field with no matching live definition (archived
   *  or a key from before/after this workspace's current registry). Still
   *  editable — just degraded to a raw value input, never blocking. */
  unresolved?: boolean
}

/** Field metadata for both the static catalogue and attribute fields, the
 *  single place the visual editor and the canvas/outline summaries resolve
 *  a field's label / operators / value options from. `teams` fills in
 *  conversation.team's options (id -> name, from the live team list) since
 *  it — unlike the rest of the static catalogue — has no fixed option set. */
export function resolveConditionField(
  field: ConditionField,
  attributes: ReadonlyMap<string, AttributeFieldDef> = new Map(),
  teams: ReadonlyMap<string, string> = new Map()
): ResolvedConditionField {
  if (isAttributeField(field)) {
    const key = attributeKeyFromField(field)
    const def = attributes.get(key)
    if (!def) {
      return {
        label: `Unknown attribute ${key}`,
        kind: 'text',
        operators: ALL_OPERATORS,
        unresolved: true,
      }
    }
    return {
      label: def.label,
      kind: ATTRIBUTE_VALUE_KIND[def.fieldType],
      operators: ATTRIBUTE_OPERATORS_BY_TYPE[def.fieldType],
      options: def.options?.map((o) => ({ value: o.id, label: o.label })),
    }
  }
  const meta = CONDITION_FIELD_META[field]
  const options =
    field === 'conversation.team'
      ? Array.from(teams, ([value, label]) => ({ value, label }))
      : meta.options
  return {
    label: meta.label,
    kind: meta.kind,
    operators: OPERATORS_BY_KIND[meta.kind],
    options,
    placeholder: meta.placeholder,
  }
}

export const ACTION_LABELS: Record<ActionType, string> = {
  assign_agent: 'Assign to teammate',
  assign_team: 'Assign to team',
  add_tag: 'Add tag',
  remove_tag: 'Remove tag',
  set_priority: 'Set priority',
  snooze: 'Snooze',
  close: 'Close conversation',
  // Mirrors `close` (no config — just the action kind) so a low-rating/
  // follow-up path can hand a closed conversation back to an active queue
  // (support platform's reopen action — see workflow.schemas.ts's action
  // union and this file's other `close` cases for the pattern this follows).
  reopen: 'Reopen conversation',
  apply_sla: 'Apply SLA policy',
  set_attribute: 'Set attribute',
}
export const ACTION_TYPES = Object.keys(ACTION_LABELS) as ActionType[]

// ---------------------------------------------------------------------------
// Trigger / class / status catalogues (workflow-level, not step-level): the
// fullscreen builder's top bar + trigger inspector share these.
// ---------------------------------------------------------------------------

// The canonical list lives in lib/shared (importable from both client and
// server, same convention as routing.ts) since it's now also the server's
// authoring-validation source of truth (workflow.schemas.ts's triggerTypeSchema)
// — see that module for how it's kept in sync with the event bus.
export const TRIGGER_TYPES = DISPATCHABLE_TRIGGER_TYPES
export type TriggerType = (typeof TRIGGER_TYPES)[number]

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  'conversation.created': 'New conversation',
  'message.created': 'Message received',
  'conversation.status_changed': 'Status changed',
  'conversation.assigned': 'Assigned to team or agent',
  'assistant.handed_off': 'AI agent handed off to a human',
  'conversation.priority_changed': 'Priority changed',
  'conversation.csat_submitted': 'CSAT rating submitted',
  'message.note_created': 'Internal note added',
}

/** Trigger label for a stored triggerType, tolerant of an unknown/legacy value. */
export function triggerLabel(triggerType: string): string {
  return (TRIGGER_LABELS as Record<string, string | undefined>)[triggerType] ?? triggerType
}

export const WORKFLOW_CLASSES = [
  {
    value: 'customer_facing',
    label: 'Customer-facing',
    description: 'Exclusive: only one customer-facing workflow runs per conversation.',
  },
  {
    value: 'background',
    label: 'Background',
    description: 'Parallel: runs silently alongside other workflows.',
  },
] as const
export type WorkflowClassValue = (typeof WORKFLOW_CLASSES)[number]['value']

export const WORKFLOW_STATUSES = ['draft', 'live', 'paused'] as const
export type WorkflowStatusValue = (typeof WORKFLOW_STATUSES)[number]

/** The channel checkboxes offered under a trigger (mirrors "conversation.channel"). */
export const TRIGGER_CHANNELS = CONDITION_FIELD_META['conversation.channel'].options!

// ---------------------------------------------------------------------------
// Frequency cap: the trigger's per-person run limit (mirrors workflow.schemas.ts's
// frequencyCapSchema — see dispatcher.guards.ts's frequencyCapAllows for what
// actually enforces it). "No limit" is the absence of the key, not a stored
// 'unlimited' value; the two read identically to the guard, but the editor
// drops the key entirely rather than writing back a no-op value.
// ---------------------------------------------------------------------------

export type FrequencyCapType = FrequencyCap['type']

export const FREQUENCY_CAP_LABELS: Record<FrequencyCapType, string> = {
  unlimited: 'No limit',
  once: 'Once per person',
  once_per_days: 'Once per person, every N days',
  n_total: 'At most N times per person',
}
export const FREQUENCY_CAP_TYPES = Object.keys(FREQUENCY_CAP_LABELS) as FrequencyCapType[]

/** A fresh cap of the given type with an editable default count/window. */
export function defaultFrequencyCap(type: FrequencyCapType): FrequencyCap {
  switch (type) {
    case 'unlimited':
    case 'once':
      return { type }
    case 'once_per_days':
      return { type, days: 30 }
    case 'n_total':
      return { type, count: 3 }
  }
}

/** A stored `frequencyCap` too malformed to parse (any non-UI writer: a raw
 *  API/import payload, a value predating a bounds tightening) reads as "No
 *  limit" rather than blocking every future save. See toTriggerSettingsDraft
 *  in use-workflow-builder.ts, which sanitizes it on load so the very next
 *  edit to trigger settings writes back a clean shape. */
export function sanitizeFrequencyCap(raw: unknown): FrequencyCap | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw) || typeof raw.type !== 'string') return undefined
  const type = raw.type as FrequencyCapType
  switch (type) {
    case 'unlimited':
    case 'once':
      return { type }
    case 'once_per_days':
      return typeof raw.days === 'number' &&
        Number.isInteger(raw.days) &&
        raw.days >= 1 &&
        raw.days <= MAX_FREQUENCY_CAP_DAYS
        ? { type, days: raw.days }
        : undefined
    case 'n_total':
      return typeof raw.count === 'number' &&
        Number.isInteger(raw.count) &&
        raw.count >= 1 &&
        raw.count <= MAX_FREQUENCY_CAP_COUNT
        ? { type, count: raw.count }
        : undefined
    default:
      return undefined
  }
}

export function frequencyCapSummary(cap: FrequencyCap | undefined): string {
  if (!cap || cap.type === 'unlimited') return 'No limit'
  switch (cap.type) {
    case 'once':
      return 'Once per person'
    case 'once_per_days':
      return `Once per person, every ${cap.days} day${cap.days === 1 ? '' : 's'}`
    case 'n_total':
      return `At most ${cap.count} time${cap.count === 1 ? '' : 's'} per person`
  }
}

/** A fresh action of the given type with editable defaults. */
export function defaultAction(type: ActionType): GraphAction {
  switch (type) {
    case 'assign_agent':
      return { type, principalId: '' }
    case 'assign_team':
      return { type, teamId: '' }
    case 'add_tag':
      return { type, tagId: '' }
    case 'remove_tag':
      return { type, tagId: '' }
    case 'set_priority':
      return { type, priority: 'medium' }
    case 'snooze':
      return { type, untilIso: null }
    case 'close':
      return { type }
    case 'reopen':
      return { type }
    case 'apply_sla':
      return { type, policyId: '' }
    case 'set_attribute':
      return { type, key: '', value: '' }
  }
}

/** Accepts both the static catalogue and the `conversation.attr.<key>`
 *  prefix — an unknown/archived key still passes (see resolveConditionField's
 *  "unresolved" fallback); only the shape of the field string is checked
 *  here, same as the server's authoring schema. */
export function isConditionField(v: unknown): v is ConditionField {
  return typeof v === 'string' && (v in CONDITION_FIELD_META || isAttributeField(v))
}
function isOperator(v: unknown): v is ConditionOperator {
  return typeof v === 'string' && v in OPERATOR_LABELS
}
function isActionType(v: unknown): v is ActionType {
  return typeof v === 'string' && v in ACTION_LABELS
}
function isPriority(v: unknown): v is Priority {
  return typeof v === 'string' && v in PRIORITY_LABELS
}

// ---------------------------------------------------------------------------
// The canvas tree: what the auto-layout renders. A path is a top-to-bottom
// list of steps; a branch step splits into labeled paths and is always the
// LAST step of its path (insertStep maintains the invariant).
// ---------------------------------------------------------------------------

export interface BranchPath {
  key: string
  condition: GraphCondition
  steps: TreeStep[]
}

/** A labeled outgoing path shared by every conversational-block kind that
 *  "spawns paths via edges" the way a branch node does (task's framing):
 *  reply_buttons (one path per button key), request_csat (one path per wired
 *  rating digit), and let_assistant_answer (its fixed default/escalated
 *  pair). Unlike BranchPath, a KeyedPath carries no condition — routing is by
 *  exact key match against the customer's structured reply (button key,
 *  rating digit) or is fixed (let_assistant_answer), never evaluated. See
 *  graph.ts's resume-path comment for how the server walker matches each. */
export interface KeyedPath {
  key: string
  label: string
  steps: TreeStep[]
}

export type TreeStep =
  | { id: string; kind: 'action'; action: GraphAction }
  | { id: string; kind: 'condition'; condition: GraphCondition }
  | { id: string; kind: 'wait'; seconds: number }
  | { id: string; kind: 'branch'; paths: BranchPath[] }
  // ── Conversational block kinds (Phase C, slice C-5) ───────────────────────
  | { id: string; kind: 'message'; body: BlockBody }
  | { id: string; kind: 'show_reply_time' }
  | { id: string; kind: 'disable_composer' }
  | {
      id: string
      kind: 'collect_data'
      body: BlockBody
      attributeKey: string
      fieldType: CollectFieldType
      options?: GraphAttributeOption[]
      required: boolean
    }
  | { id: string; kind: 'collect_reply'; body: BlockBody; attributeKey: string }
  /** paths: exactly LET_ASSISTANT_DEFAULT_KEY + LET_ASSISTANT_ESCALATED_KEY,
   *  always both present (not user add/remove/reorderable — see the
   *  let-assistant editor). instructions/autoCloseOverride (Phase C, slice
   *  C-6) mirror the server node's own optional fields verbatim. */
  | {
      id: string
      kind: 'let_assistant_answer'
      instructions?: string
      autoCloseOverride?: boolean
      paths: KeyedPath[]
    }
  | { id: string; kind: 'reply_buttons'; body: BlockBody; allowTyping: boolean; paths: KeyedPath[] }
  | {
      id: string
      kind: 'request_csat'
      body: BlockBody
      allowTypingInterrupt: boolean
      commentPrompt?: string
      /** Zero or more wired rating digits ('1'..'5'); a rating with no path
       *  just records and ends the run there (see graph.ts's request_csat
       *  resume case — no matching branch edge is a valid, terminal outcome). */
      paths: KeyedPath[]
    }

export interface WorkflowTree {
  triggerId: string
  steps: TreeStep[]
}

/**
 * The labeled paths a step "spawns via edges" (branch keys), normalized to
 * one shape regardless of kind — branch's own BranchPath (label reads as its
 * key, since a rule pill's name IS the key there), reply_buttons/
 * request_csat/let_assistant_answer's native KeyedPath. Null for every other
 * kind (nothing to fan out). Shared by the tree-editing helpers below and the
 * canvas auto-layout (flow-layout.ts), which both need to walk/measure every
 * fan-out kind the same way instead of hand-copying a `kind === 'branch'`
 * special case per call site.
 */
export function stepPaths(step: TreeStep): KeyedPath[] | null {
  switch (step.kind) {
    case 'branch':
      return step.paths.map((p) => ({ key: p.key, label: p.key, steps: p.steps }))
    case 'reply_buttons':
    case 'request_csat':
    case 'let_assistant_answer':
      return step.paths
    default:
      return null
  }
}

/** Write a fan-out step's named path back with new `steps`, preserving every
 *  other field (a branch path's condition, a button's label, ...). Paired
 *  with stepPaths for the tree-editing helpers' read/modify/write cycle. */
function withPathSteps(step: TreeStep, key: string, steps: TreeStep[]): TreeStep {
  switch (step.kind) {
    case 'branch':
      return { ...step, paths: step.paths.map((p) => (p.key === key ? { ...p, steps } : p)) }
    case 'reply_buttons':
    case 'request_csat':
    case 'let_assistant_answer':
      return { ...step, paths: step.paths.map((p) => (p.key === key ? { ...p, steps } : p)) }
    default:
      return step
  }
}

export function newTree(): WorkflowTree {
  return { triggerId: 'trigger', steps: [] }
}

function collectIds(steps: TreeStep[], into: Set<string>): void {
  for (const step of steps) {
    into.add(step.id)
    const paths = stepPaths(step)
    if (paths) for (const p of paths) collectIds(p.steps, into)
  }
}

/** A readable id ("wait-2") that is unique across the whole tree. */
export function freshStepId(tree: WorkflowTree, kind: TreeStep['kind']): string {
  const used = new Set<string>([tree.triggerId])
  collectIds(tree.steps, used)
  let n = 1
  while (used.has(`${kind}-${n}`)) n++
  return `${kind}-${n}`
}

/** A fresh step of the given kind with a tree-unique id. `actionType` picks
 *  the initial action for an 'action' step (the step palette inserts a
 *  specific type directly, e.g. "Apply SLA policy" rather than a generic
 *  action the editor then has to be switched away from). */
export function createStep(
  tree: WorkflowTree,
  kind: TreeStep['kind'],
  actionType?: ActionType
): TreeStep {
  const id = freshStepId(tree, kind)
  switch (kind) {
    case 'action':
      return { id, kind, action: defaultAction(actionType ?? 'assign_agent') }
    case 'condition':
      return { id, kind, condition: {} }
    case 'branch':
      return {
        id,
        kind,
        paths: [
          { key: 'Path 1', condition: {}, steps: [] },
          { key: 'Path 2', condition: {}, steps: [] },
        ],
      }
    case 'wait':
      return { id, kind, seconds: 3600 }
    // ── Conversational block kinds (Phase C, slice C-5) ───────────────────
    case 'message':
      return { id, kind, body: EMPTY_BLOCK_BODY }
    case 'show_reply_time':
      return { id, kind }
    case 'disable_composer':
      return { id, kind }
    case 'collect_data':
      return {
        id,
        kind,
        body: EMPTY_BLOCK_BODY,
        attributeKey: '',
        fieldType: 'text',
        required: false,
      }
    case 'collect_reply':
      return { id, kind, body: EMPTY_BLOCK_BODY, attributeKey: '' }
    case 'let_assistant_answer':
      return {
        id,
        kind,
        paths: [
          { key: LET_ASSISTANT_DEFAULT_KEY, label: 'Continues', steps: [] },
          { key: LET_ASSISTANT_ESCALATED_KEY, label: 'If escalated to a human', steps: [] },
        ],
      }
    case 'reply_buttons':
      return {
        id,
        kind,
        body: EMPTY_BLOCK_BODY,
        allowTyping: false,
        paths: [
          { key: 'option_1', label: 'Option 1', steps: [] },
          { key: 'option_2', label: 'Option 2', steps: [] },
        ],
      }
    case 'request_csat':
      // Starts with no wired rating paths (not one per digit): request_csat
      // has no declared-keys field on the node (unlike reply_buttons'
      // `options` or branch's `branches`), so a wired-but-empty path has no
      // edge to survive a JSON-mode round-trip on — see this module's
      // round-trip test for request_csat. Defaulting to zero avoids handing
      // the admin 5 paths that would silently vanish before they've added a
      // step to any of them; the CSAT editor's "Add path for rating N" wires
      // them in one at a time instead.
      return {
        id,
        kind,
        body: EMPTY_BLOCK_BODY,
        allowTypingInterrupt: true,
        paths: [],
      }
  }
}

/**
 * Insert a step at `index`. Inserting a branch (or any other fan-out kind —
 * reply_buttons/request_csat/let_assistant_answer) splits the path: the
 * steps after the insertion point move into the new step's first declared
 * path, so no step ever follows a fan-out step within one lane.
 */
export function insertStep(steps: TreeStep[], index: number, step: TreeStep): TreeStep[] {
  const head = steps.slice(0, index)
  const tail = steps.slice(index)
  if (tail.length === 0) return [...head, step, ...tail]
  if (step.kind === 'branch') {
    const [first, ...rest] = step.paths
    const firstPath: BranchPath = first
      ? { ...first, steps: [...first.steps, ...tail] }
      : { key: 'Path 1', condition: {}, steps: tail }
    return [...head, { ...step, paths: [firstPath, ...rest] }]
  }
  const paths = stepPaths(step)
  if (!paths || !paths[0]) return [...head, step, ...tail]
  const merged = withPathSteps(step, paths[0].key, [...paths[0].steps, ...tail])
  return [...head, merged]
}

/** Steps in a subtree, for "this deletes N steps" confirmations. */
export function countSteps(steps: TreeStep[]): number {
  let n = 0
  for (const step of steps) {
    n++
    const paths = stepPaths(step)
    if (paths) for (const p of paths) n += countSteps(p.steps)
  }
  return n
}

// ---------------------------------------------------------------------------
// Graph validation. Mirrors workflowGraphSchema (the server re-validates on
// save either way); errors aim to be actionable, not zod-shaped.
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

// Mirrors z.string().datetime(): UTC, seconds required, optional fraction.
const isUtcTimestamp = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) &&
  !Number.isNaN(Date.parse(v))

function validateCondition(v: unknown, where: string): string | null {
  if (!isRecord(v)) return `${where}: a condition must be an object`
  if ('field' in v) {
    if (!isConditionField(v.field)) return `${where}: unknown condition field "${String(v.field)}"`
    if (!isOperator(v.op)) return `${where}: unknown operator "${String(v.op)}"`
    return null
  }
  for (const key of Object.keys(v)) {
    if (key !== 'all' && key !== 'any')
      return `${where}: unexpected key "${key}" in a condition group`
  }
  for (const key of ['all', 'any'] as const) {
    const list = v[key]
    if (list === undefined) continue
    if (!Array.isArray(list)) return `${where}: "${key}" must be an array of conditions`
    for (let i = 0; i < list.length; i++) {
      const err = validateCondition(list[i], `${where}.${key}[${i}]`)
      if (err) return err
    }
  }
  return null
}

/** Shallow check that a body value is at least shaped like a TipTap doc (has
 *  a `type`) — mirrors the server's blockBodySchema CALIBRATION: catching a
 *  shape the interpolator/walker can't make sense of, not a full recursive
 *  mirror (the server re-validates the whole tree on save either way). */
function validateBlockBody(v: unknown, where: string): string | null {
  return isRecord(v) && nonEmptyString(v.type) ? null : `${where}: the message needs content`
}

function validateAction(v: unknown, where: string): string | null {
  if (!isRecord(v)) return `${where}: the action must be an object`
  if (!isActionType(v.type)) return `${where}: unknown action "${String(v.type)}"`
  switch (v.type) {
    case 'assign_agent':
      return nonEmptyString(v.principalId) ? null : `${where}: choose a teammate to assign`
    case 'assign_team':
      return nonEmptyString(v.teamId) ? null : `${where}: choose a team to assign`
    case 'add_tag':
    case 'remove_tag':
      return nonEmptyString(v.tagId) ? null : `${where}: choose a tag`
    case 'set_priority':
      return isPriority(v.priority) ? null : `${where}: pick a priority`
    case 'snooze':
      // Relative (seconds) or legacy absolute (untilIso, a UTC timestamp, or
      // null for "until they reply") — see workflow.schemas.ts's
      // snoozeActionSchema union. Only a sanity check here (a whole,
      // non-negative number of seconds); the server bounds it by
      // MAX_WAIT_SECONDS on save, same as the wait step's "seconds" below.
      if ('seconds' in v) {
        return typeof v.seconds === 'number' && Number.isInteger(v.seconds) && v.seconds >= 0
          ? null
          : `${where}: snooze duration must be a whole number of seconds (0 or more)`
      }
      return v.untilIso === null || isUtcTimestamp(v.untilIso)
        ? null
        : `${where}: snooze needs a UTC timestamp (e.g. 2026-08-01T09:00:00Z) or null`
    case 'close':
    case 'reopen':
      return null
    case 'apply_sla':
      return nonEmptyString(v.policyId) ? null : `${where}: enter an SLA policy id`
    case 'set_attribute':
      return nonEmptyString(v.key) ? null : `${where}: enter an attribute key`
  }
}

/** Structural validation of an unknown value as a workflow graph. Mirrors
 *  workflowGraphSchema's superRefine cross-node checks too (duplicate node
 *  ids, an edge referencing a missing node, an edge's branch key the node
 *  doesn't declare, a wait past MAX_WAIT_SECONDS): the server re-validates on
 *  save either way, but without these here a JSON-mode graph hitting one of
 *  them would only fail as a bare server 400 instead of a readable message. */
export function validateGraph(input: unknown): Result<WorkflowGraphJson> {
  if (!isRecord(input)) return fail('The graph must be an object with "nodes" and "edges"')
  const { nodes, edges } = input
  if (!Array.isArray(nodes)) return fail('"nodes" must be an array')
  if (!Array.isArray(edges)) return fail('"edges" must be an array')
  if (nodes.length > 200) return fail('A workflow can have at most 200 steps')
  if (edges.length > 400) return fail('A workflow can have at most 400 connections')

  const nodeIds = new Set<string>()
  const branchKeysByNodeId = new Map<string, Set<string>>()

  for (let i = 0; i < nodes.length; i++) {
    const node: unknown = nodes[i]
    if (!isRecord(node)) return fail(`nodes[${i}] must be an object`)
    if (!nonEmptyString(node.id)) return fail(`nodes[${i}] needs a non-empty string id`)
    if (nodeIds.has(node.id)) return fail(duplicateStepIdMessage(node.id))
    nodeIds.add(node.id)
    const where = `Step "${node.id}"`
    switch (node.type) {
      case 'trigger':
        break
      case 'action': {
        const err = validateAction(node.action, where)
        if (err) return fail(err)
        break
      }
      case 'condition': {
        const err = validateCondition(node.condition, where)
        if (err) return fail(err)
        break
      }
      case 'branch': {
        if (!Array.isArray(node.branches)) return fail(`${where}: "branches" must be an array`)
        const keys = new Set<string>()
        for (let b = 0; b < node.branches.length; b++) {
          const br: unknown = node.branches[b]
          if (!isRecord(br) || !nonEmptyString(br.key)) {
            return fail(`${where}: every branch path needs a non-empty key`)
          }
          const err = validateCondition(br.condition, `${where} path "${br.key}"`)
          if (err) return fail(err)
          keys.add(br.key)
        }
        branchKeysByNodeId.set(node.id, keys)
        break
      }
      case 'wait': {
        if (
          typeof node.seconds !== 'number' ||
          !Number.isInteger(node.seconds) ||
          node.seconds < 0
        ) {
          return fail(`${where}: "seconds" must be a whole number of seconds (0 or more)`)
        }
        if (node.seconds > MAX_WAIT_SECONDS) {
          return fail(`${where}: a wait can be at most ${durationPhrase(MAX_WAIT_SECONDS)}`)
        }
        break
      }
      // ── Conversational block kinds (Phase C, slice C-5) ──────────────────
      case 'message': {
        const err = validateBlockBody(node.body, where)
        if (err) return fail(err)
        break
      }
      case 'show_reply_time':
      case 'disable_composer':
        break
      case 'let_assistant_answer':
        // The escalated edge (if present) is validated below like a branch's
        // labeled edges: only 'escalated' is a declared path off this node.
        branchKeysByNodeId.set(node.id, new Set([LET_ASSISTANT_ESCALATED_KEY]))
        if (node.instructions !== undefined) {
          if (typeof node.instructions !== 'string') {
            return fail(`${where}: "instructions" must be a string when present`)
          }
          if (node.instructions.length > MAX_ASSISTANT_STEP_INSTRUCTIONS) {
            return fail(
              `${where}: instructions must be at most ${MAX_ASSISTANT_STEP_INSTRUCTIONS} characters`
            )
          }
        }
        if (node.autoCloseOverride !== undefined && typeof node.autoCloseOverride !== 'boolean') {
          return fail(`${where}: "autoCloseOverride" must be true or false when present`)
        }
        break
      case 'reply_buttons': {
        const err = validateBlockBody(node.body, where)
        if (err) return fail(err)
        if (!Array.isArray(node.options) || node.options.length === 0) {
          return fail(`${where}: add at least one button`)
        }
        const keys = new Set<string>()
        for (const opt of node.options) {
          if (!isRecord(opt) || !nonEmptyString(opt.key) || !nonEmptyString(opt.label)) {
            return fail(`${where}: every button needs a key and a label`)
          }
          keys.add(opt.key)
        }
        // Reuses the same edge-branch-key check the general edge loop below
        // already runs for a 'branch' node's declared keys — a button's key
        // IS a branch key from the walker's point of view (graph.ts:
        // reply_buttons resumes via the same branch-edge matching).
        branchKeysByNodeId.set(node.id, keys)
        if (typeof node.allowTyping !== 'boolean') {
          return fail(`${where}: "allowTyping" must be true or false`)
        }
        break
      }
      case 'collect_data': {
        const err = validateBlockBody(node.body, where)
        if (err) return fail(err)
        if (!nonEmptyString(node.attributeKey)) return fail(`${where}: choose an attribute`)
        if (!COLLECT_FIELD_TYPES.includes(node.fieldType as CollectFieldType)) {
          return fail(`${where}: unknown field type "${String(node.fieldType)}"`)
        }
        if (typeof node.required !== 'boolean') {
          return fail(`${where}: "required" must be true or false`)
        }
        break
      }
      case 'collect_reply': {
        const err = validateBlockBody(node.body, where)
        if (err) return fail(err)
        if (!nonEmptyString(node.attributeKey)) return fail(`${where}: choose an attribute`)
        break
      }
      case 'request_csat': {
        const err = validateBlockBody(node.body, where)
        if (err) return fail(err)
        if (typeof node.allowTypingInterrupt !== 'boolean') {
          return fail(`${where}: "allowTypingInterrupt" must be true or false`)
        }
        break
      }
      default:
        return fail(`nodes[${i}]: unknown step type "${String(node.type)}"`)
    }
  }

  for (let i = 0; i < edges.length; i++) {
    const edge: unknown = edges[i]
    if (!isRecord(edge) || !nonEmptyString(edge.from) || !nonEmptyString(edge.to)) {
      return fail(`edges[${i}] needs "from" and "to" step ids`)
    }
    if (edge.branch !== undefined && typeof edge.branch !== 'string') {
      return fail(`edges[${i}]: "branch" must be a string when present`)
    }
    if (!nodeIds.has(edge.from)) {
      return fail(`edges[${i}]: ${missingStepMessage(edge.from)}`)
    }
    if (!nodeIds.has(edge.to)) {
      return fail(`edges[${i}]: ${missingStepMessage(edge.to)}`)
    }
    // A branch key the node doesn't declare can never be taken (the runtime
    // walker matches branches by key), so it's dead weight at best and a
    // stale rename at worst — same rule as the server's superRefine. An edge
    // with no branch key, or one leaving a non-branch node, is left alone.
    const declaredKeys = branchKeysByNodeId.get(edge.from)
    if (declaredKeys && edge.branch !== undefined && !declaredKeys.has(edge.branch)) {
      return fail(`edges[${i}]: ${undeclaredBranchPathMessage(edge.from, edge.branch)}`)
    }
  }

  // Structure fully checked above; the cast narrows the JSON to the graph shape.
  return { ok: true, value: input as unknown as WorkflowGraphJson }
}

/** Parse + validate JSON text (the "Edit as JSON" mode and stored graphs). */
export function parseWorkflowGraphText(text: string): Result<WorkflowGraphJson> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return fail(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  return validateGraph(parsed)
}

// ---------------------------------------------------------------------------
// Graph <-> tree. graphToTree fails (with a reason) on shapes the auto-layout
// cannot show: no/multiple triggers, merges, cycles, unreachable steps. Those
// stay editable as JSON; nothing is silently dropped.
// ---------------------------------------------------------------------------

export function graphToTree(graph: WorkflowGraphJson): Result<WorkflowTree> {
  if (graph.nodes.length === 0) return { ok: true, value: newTree() }

  const byId = new Map<string, GraphNode>()
  for (const node of graph.nodes) {
    if (byId.has(node.id)) return fail(`two steps share the id "${node.id}"`)
    byId.set(node.id, node)
  }

  const triggers = graph.nodes.filter((n) => n.type === 'trigger')
  if (triggers.length === 0) return fail('the graph has no trigger step')
  if (triggers.length > 1) return fail('the graph has more than one trigger step')
  const trigger = triggers[0]!

  const incoming = new Map<string, number>()
  const outgoing = new Map<string, GraphEdge[]>()
  for (const edge of graph.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) {
      return fail(`a connection references a missing step ("${edge.from}" to "${edge.to}")`)
    }
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    const outs = outgoing.get(edge.from) ?? []
    outs.push(edge)
    outgoing.set(edge.from, outs)
  }

  if ((incoming.get(trigger.id) ?? 0) > 0) return fail('the trigger has an incoming connection')
  for (const node of graph.nodes) {
    if (node.type !== 'trigger' && (incoming.get(node.id) ?? 0) !== 1) {
      return fail(`step "${node.id}" needs exactly one incoming connection`)
    }
  }

  const visited = new Set<string>([trigger.id])

  const singleSuccessor = (node: GraphNode): Result<string | undefined> => {
    const outs = outgoing.get(node.id) ?? []
    if (outs.some((e) => e.branch !== undefined)) {
      return fail(`step "${node.id}" has a labeled connection but is not a branch`)
    }
    if (outs.length > 1) return fail(`step "${node.id}" has more than one outgoing connection`)
    return { ok: true, value: outs[0]?.to }
  }

  const walkFrom = (startId: string | undefined): Result<TreeStep[]> => {
    const steps: TreeStep[] = []
    let currentId = startId
    while (currentId !== undefined) {
      if (visited.has(currentId)) return fail('the graph contains a cycle')
      visited.add(currentId)
      const node = byId.get(currentId)!
      if (node.type === 'trigger') return fail('a trigger appears in the middle of a path')
      if (node.type === 'branch') {
        const keys = new Set(node.branches.map((b) => b.key))
        if (keys.size !== node.branches.length) {
          return fail(`branch "${node.id}" has duplicate path keys`)
        }
        const edgeByKey = new Map<string, GraphEdge>()
        for (const edge of outgoing.get(node.id) ?? []) {
          if (edge.branch === undefined) {
            return fail(`branch "${node.id}" has an unlabeled outgoing connection`)
          }
          if (!keys.has(edge.branch)) {
            return fail(`branch "${node.id}" has a connection for an unknown path "${edge.branch}"`)
          }
          if (edgeByKey.has(edge.branch)) {
            return fail(`branch "${node.id}" has two connections for path "${edge.branch}"`)
          }
          edgeByKey.set(edge.branch, edge)
        }
        const paths: BranchPath[] = []
        for (const b of node.branches) {
          const sub = walkFrom(edgeByKey.get(b.key)?.to)
          if (!sub.ok) return sub
          paths.push({ key: b.key, condition: b.condition, steps: sub.value })
        }
        steps.push({ id: node.id, kind: 'branch', paths })
        return { ok: true, value: steps }
      }

      // ── reply_buttons: one path per declared button key (Phase C, C-5) ───
      if (node.type === 'reply_buttons') {
        const keys = new Set(node.options.map((o) => o.key))
        if (keys.size !== node.options.length) {
          return fail(`reply buttons "${node.id}" has duplicate button keys`)
        }
        const edgeByKey = new Map<string, GraphEdge>()
        for (const edge of outgoing.get(node.id) ?? []) {
          if (edge.branch === undefined) {
            return fail(`reply buttons "${node.id}" has an unlabeled outgoing connection`)
          }
          if (!keys.has(edge.branch)) {
            return fail(
              `reply buttons "${node.id}" has a connection for an unknown button "${edge.branch}"`
            )
          }
          if (edgeByKey.has(edge.branch)) {
            return fail(
              `reply buttons "${node.id}" has two connections for button "${edge.branch}"`
            )
          }
          edgeByKey.set(edge.branch, edge)
        }
        const paths: KeyedPath[] = []
        for (const opt of node.options) {
          const sub = walkFrom(edgeByKey.get(opt.key)?.to)
          if (!sub.ok) return sub
          paths.push({ key: opt.key, label: opt.label, steps: sub.value })
        }
        steps.push({
          id: node.id,
          kind: 'reply_buttons',
          body: node.body,
          allowTyping: node.allowTyping,
          paths,
        })
        return { ok: true, value: steps }
      }

      // ── request_csat: one path per WIRED rating digit, if any (C-5) ──────
      if (node.type === 'request_csat') {
        const edgeByKey = new Map<string, GraphEdge>()
        for (const edge of outgoing.get(node.id) ?? []) {
          if (
            edge.branch === undefined ||
            !(RATING_KEYS as readonly string[]).includes(edge.branch)
          ) {
            return fail(
              `ask-for-rating "${node.id}" has a connection with an unexpected label ("${edge.branch ?? 'none'}")`
            )
          }
          if (edgeByKey.has(edge.branch)) {
            return fail(`ask-for-rating "${node.id}" has two connections for rating ${edge.branch}`)
          }
          edgeByKey.set(edge.branch, edge)
        }
        const paths: KeyedPath[] = []
        for (const key of RATING_KEYS) {
          const edge = edgeByKey.get(key)
          if (!edge) continue // that rating isn't wired: no path to show
          const sub = walkFrom(edge.to)
          if (!sub.ok) return sub
          paths.push({ key, label: RATING_LABELS[key], steps: sub.value })
        }
        steps.push({
          id: node.id,
          kind: 'request_csat',
          body: node.body,
          allowTypingInterrupt: node.allowTypingInterrupt,
          commentPrompt: node.commentPrompt,
          paths,
        })
        return { ok: true, value: steps }
      }

      // ── let_assistant_answer: default (unlabeled) + optional 'escalated' ─
      if (node.type === 'let_assistant_answer') {
        const outs = outgoing.get(node.id) ?? []
        const continueEdges = outs.filter((e) => e.branch === undefined)
        const escalatedEdges = outs.filter((e) => e.branch === LET_ASSISTANT_ESCALATED_KEY)
        const other = outs.filter(
          (e) => e.branch !== undefined && e.branch !== LET_ASSISTANT_ESCALATED_KEY
        )
        if (other.length > 0) {
          return fail(
            `"Let Quinn answer" step "${node.id}" has a connection for an unknown path "${other[0]!.branch}"`
          )
        }
        if (continueEdges.length > 1) {
          return fail(`"Let Quinn answer" step "${node.id}" has more than one default connection`)
        }
        if (escalatedEdges.length > 1) {
          return fail(`"Let Quinn answer" step "${node.id}" has more than one escalated connection`)
        }
        const continueSub = walkFrom(continueEdges[0]?.to)
        if (!continueSub.ok) return continueSub
        const escalatedSub = walkFrom(escalatedEdges[0]?.to)
        if (!escalatedSub.ok) return escalatedSub
        steps.push({
          id: node.id,
          kind: 'let_assistant_answer',
          instructions: node.instructions,
          autoCloseOverride: node.autoCloseOverride,
          paths: [
            { key: LET_ASSISTANT_DEFAULT_KEY, label: 'Continues', steps: continueSub.value },
            {
              key: LET_ASSISTANT_ESCALATED_KEY,
              label: 'If escalated to a human',
              steps: escalatedSub.value,
            },
          ],
        })
        return { ok: true, value: steps }
      }

      const next = singleSuccessor(node)
      if (!next.ok) return next
      switch (node.type) {
        case 'action':
          steps.push({ id: node.id, kind: 'action', action: node.action })
          break
        case 'condition':
          steps.push({ id: node.id, kind: 'condition', condition: node.condition })
          break
        case 'wait':
          steps.push({ id: node.id, kind: 'wait', seconds: node.seconds })
          break
        case 'message':
          steps.push({ id: node.id, kind: 'message', body: node.body })
          break
        case 'show_reply_time':
          steps.push({ id: node.id, kind: 'show_reply_time' })
          break
        case 'disable_composer':
          steps.push({ id: node.id, kind: 'disable_composer' })
          break
        case 'collect_data':
          steps.push({
            id: node.id,
            kind: 'collect_data',
            body: node.body,
            attributeKey: node.attributeKey,
            fieldType: node.fieldType,
            options: node.options,
            required: node.required,
          })
          break
        case 'collect_reply':
          steps.push({
            id: node.id,
            kind: 'collect_reply',
            body: node.body,
            attributeKey: node.attributeKey,
          })
          break
      }
      currentId = next.value
    }
    return { ok: true, value: steps }
  }

  const start = singleSuccessor(trigger)
  if (!start.ok) return start
  const walked = walkFrom(start.value)
  if (!walked.ok) return walked
  if (visited.size !== graph.nodes.length) {
    const orphans = graph.nodes.length - visited.size
    return fail(`${orphans} step${orphans === 1 ? ' is' : 's are'} not connected to the trigger`)
  }
  return { ok: true, value: { triggerId: trigger.id, steps: walked.value } }
}

/** Serialize the canvas tree back to graph JSON (deterministic DFS order). */
export function treeToGraph(tree: WorkflowTree): WorkflowGraphJson {
  const nodes: GraphNode[] = [{ id: tree.triggerId, type: 'trigger' }]
  const edges: GraphEdge[] = []

  const emit = (steps: TreeStep[], from: string, branchKey?: string): void => {
    let prev = from
    let label = branchKey
    for (const step of steps) {
      edges.push(
        label === undefined
          ? { from: prev, to: step.id }
          : { from: prev, to: step.id, branch: label }
      )
      label = undefined
      switch (step.kind) {
        case 'action':
          nodes.push({ id: step.id, type: 'action', action: step.action })
          break
        case 'condition':
          nodes.push({ id: step.id, type: 'condition', condition: step.condition })
          break
        case 'wait':
          nodes.push({ id: step.id, type: 'wait', seconds: step.seconds })
          break
        case 'branch':
          nodes.push({
            id: step.id,
            type: 'branch',
            branches: step.paths.map((p) => ({ key: p.key, condition: p.condition })),
          })
          for (const p of step.paths) emit(p.steps, step.id, p.key)
          break
        // ── Conversational block kinds (Phase C, slice C-5) ───────────────
        case 'message':
          nodes.push({ id: step.id, type: 'message', body: step.body })
          break
        case 'show_reply_time':
          nodes.push({ id: step.id, type: 'show_reply_time' })
          break
        case 'disable_composer':
          nodes.push({ id: step.id, type: 'disable_composer' })
          break
        case 'collect_data':
          nodes.push({
            id: step.id,
            type: 'collect_data',
            body: step.body,
            attributeKey: step.attributeKey,
            fieldType: step.fieldType,
            options: step.options,
            required: step.required,
          })
          break
        case 'collect_reply':
          nodes.push({
            id: step.id,
            type: 'collect_reply',
            body: step.body,
            attributeKey: step.attributeKey,
          })
          break
        case 'reply_buttons':
          nodes.push({
            id: step.id,
            type: 'reply_buttons',
            body: step.body,
            options: step.paths.map((p) => ({ key: p.key, label: p.label })),
            allowTyping: step.allowTyping,
          })
          for (const p of step.paths) emit(p.steps, step.id, p.key)
          break
        case 'request_csat':
          nodes.push({
            id: step.id,
            type: 'request_csat',
            body: step.body,
            allowTypingInterrupt: step.allowTypingInterrupt,
            commentPrompt: step.commentPrompt,
          })
          for (const p of step.paths) emit(p.steps, step.id, p.key)
          break
        case 'let_assistant_answer': {
          nodes.push({
            id: step.id,
            type: 'let_assistant_answer',
            instructions: step.instructions,
            autoCloseOverride: step.autoCloseOverride,
          })
          const continuePath = step.paths.find((p) => p.key === LET_ASSISTANT_DEFAULT_KEY)
          const escalatedPath = step.paths.find((p) => p.key === LET_ASSISTANT_ESCALATED_KEY)
          if (continuePath) emit(continuePath.steps, step.id)
          if (escalatedPath) emit(escalatedPath.steps, step.id, LET_ASSISTANT_ESCALATED_KEY)
          break
        }
      }
      prev = step.id
    }
  }

  emit(tree.steps, tree.triggerId)
  return { nodes, edges }
}

// ---------------------------------------------------------------------------
// Condition drafts: the one-level "all/any of these rules" shape the visual
// builder edits. Nested groups (or values that don't fit the field's kind)
// stay untouched as an "advanced" condition, still editable via JSON mode.
// ---------------------------------------------------------------------------

export interface ConditionRuleDraft {
  field: ConditionField
  op: ConditionOperator
  value: string
}

export interface SimpleConditionDraft {
  kind: 'simple'
  mode: 'all' | 'any'
  rules: ConditionRuleDraft[]
}

export type ConditionDraft = SimpleConditionDraft | { kind: 'advanced'; condition: GraphCondition }

type ConditionLeaf = Extract<GraphCondition, { field: string }>

function leafToRule(leaf: ConditionLeaf): ConditionRuleDraft | null {
  if (!isConditionField(leaf.field) || !isOperator(leaf.op)) return null
  const { field, op } = leaf
  if (VALUELESS_OPERATORS.has(op)) return { field, op, value: '' }
  const v = leaf.value
  // Attribute fields don't need their live definition to read a leaf back
  // into draft form: the stored JSON value's own runtime type says whether
  // it's a checkbox boolean, a number, a multi_select array, or a plain
  // string (select ids and text share the same string representation).
  if (isAttributeField(field)) {
    if (typeof v === 'boolean') return { field, op, value: v ? 'true' : 'false' }
    if (typeof v === 'number' && Number.isFinite(v)) return { field, op, value: String(v) }
    if (Array.isArray(v) && v.every((x) => typeof x === 'string'))
      return { field, op, value: v.join(', ') }
    return typeof v === 'string' ? { field, op, value: v } : null
  }
  switch (CONDITION_FIELD_META[field].kind) {
    case 'text':
    case 'choice':
      return typeof v === 'string' ? { field, op, value: v } : null
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? { field, op, value: String(v) } : null
    case 'boolean':
      return typeof v === 'boolean' ? { field, op, value: v ? 'true' : 'false' } : null
    case 'list':
      return Array.isArray(v) && v.every((x) => typeof x === 'string')
        ? { field, op, value: v.join(', ') }
        : null
  }
}

export function conditionToDraft(condition: GraphCondition): ConditionDraft {
  const advanced: ConditionDraft = { kind: 'advanced', condition }
  if ('field' in condition) {
    const rule = leafToRule(condition)
    return rule ? { kind: 'simple', mode: 'all', rules: [rule] } : advanced
  }
  const hasAll = condition.all !== undefined && condition.all.length > 0
  const hasAny = condition.any !== undefined && condition.any.length > 0
  if (hasAll && hasAny) return advanced
  if (!hasAll && !hasAny) return { kind: 'simple', mode: 'all', rules: [] }
  const rules: ConditionRuleDraft[] = []
  for (const child of (hasAll ? condition.all : condition.any)!) {
    if (!('field' in child)) return advanced
    const rule = leafToRule(child)
    if (!rule) return advanced
    rules.push(rule)
  }
  return { kind: 'simple', mode: hasAll ? 'all' : 'any', rules }
}

/** Encode an attribute rule's string-form value back to typed JSON. The
 *  operator alone disambiguates the array (includes_any/excludes_all) and
 *  numeric (gt/gte/lt/lte) cases; only eq/neq/contains/not_contains need the
 *  live definition to tell a checkbox boolean apart from select/text text —
 *  an unresolved (archived/unknown) key falls back to the raw string, same
 *  as the set_attribute action editor's raw-JSON fallback for unknown keys. */
function encodeAttributeConditionValue(
  rule: ConditionRuleDraft,
  attributes: ReadonlyMap<string, AttributeFieldDef>
): unknown {
  if (rule.op === 'includes_any' || rule.op === 'excludes_all') {
    return rule.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (rule.op === 'gt' || rule.op === 'gte' || rule.op === 'lt' || rule.op === 'lte') {
    const n = Number(rule.value)
    return Number.isFinite(n) ? n : 0
  }
  const def = isAttributeField(rule.field)
    ? attributes.get(attributeKeyFromField(rule.field))
    : undefined
  if (def?.fieldType === 'checkbox') return rule.value === 'true'
  if (def?.fieldType === 'number') {
    const n = Number(rule.value)
    return Number.isFinite(n) ? n : 0
  }
  return rule.value
}

function ruleToLeaf(
  rule: ConditionRuleDraft,
  attributes: ReadonlyMap<string, AttributeFieldDef> = new Map()
): GraphCondition {
  if (VALUELESS_OPERATORS.has(rule.op)) return { field: rule.field, op: rule.op }
  if (isAttributeField(rule.field)) {
    return {
      field: rule.field,
      op: rule.op,
      value: encodeAttributeConditionValue(rule, attributes),
    }
  }
  let value: unknown
  switch (CONDITION_FIELD_META[rule.field].kind) {
    case 'number': {
      const n = Number(rule.value)
      value = Number.isFinite(n) ? n : 0
      break
    }
    case 'boolean':
      value = rule.value === 'true'
      break
    case 'list':
      value = rule.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      break
    default:
      value = rule.value
  }
  return { field: rule.field, op: rule.op, value }
}

export function draftToCondition(
  draft: SimpleConditionDraft,
  attributes: ReadonlyMap<string, AttributeFieldDef> = new Map()
): GraphCondition {
  if (draft.rules.length === 0) return {}
  const leaves = draft.rules.map((rule) => ruleToLeaf(rule, attributes))
  if (leaves.length === 1) return leaves[0]!
  return draft.mode === 'all' ? { all: leaves } : { any: leaves }
}

export function defaultRule(): ConditionRuleDraft {
  return { field: 'conversation.status', op: 'eq', value: 'open' }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Entity id -> display name lookups for card summaries. */
export interface EntityLabels {
  members?: ReadonlyMap<string, string>
  teams?: ReadonlyMap<string, string>
  tags?: ReadonlyMap<string, string>
  slaPolicies?: ReadonlyMap<string, string>
  /** Attribute key -> live definition, for conversation.attr.* condition
   *  summaries (canvas rule pills, outline rows, branch path rows). */
  attributes?: ReadonlyMap<string, AttributeFieldDef>
}

const shortId = (id: string): string => (id.length > 14 ? `${id.slice(0, 14)}…` : id)

// Needs-setup placeholders summarize as "not chosen yet", not as a raw id.
const named = (id: string, lookup: ReadonlyMap<string, string> | undefined, missing: string) =>
  id && !isNeedsSetupRef(id) ? (lookup?.get(id) ?? shortId(id)) : missing

export function actionSummary(action: GraphAction, labels: EntityLabels = {}): string {
  switch (action.type) {
    case 'assign_agent':
      return `Assign to ${named(action.principalId, labels.members, 'a teammate…')}`
    case 'assign_team':
      return `Assign to ${named(action.teamId, labels.teams, 'a team…')}`
    case 'add_tag':
      return `Add tag ${named(action.tagId, labels.tags, '…')}`
    case 'remove_tag':
      return `Remove tag ${named(action.tagId, labels.tags, '…')}`
    case 'set_priority':
      return `Set priority to ${PRIORITY_LABELS[action.priority]}`
    case 'snooze':
      if ('seconds' in action) return `Snooze for ${durationPhrase(action.seconds)}`
      return action.untilIso
        ? `Snooze until ${new Date(action.untilIso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
        : 'Snooze until they reply'
    case 'close':
      return 'Close the conversation'
    case 'reopen':
      return 'Reopen the conversation'
    case 'apply_sla':
      return `Apply SLA ${named(action.policyId, labels.slaPolicies, '…')}`
    case 'set_attribute':
      return action.key ? `Set ${action.key}` : 'Set an attribute…'
  }
}

function ruleSummary(
  rule: ConditionRuleDraft,
  attributes: ReadonlyMap<string, AttributeFieldDef> = new Map(),
  teams: ReadonlyMap<string, string> = new Map()
): string {
  const meta = resolveConditionField(rule.field, attributes, teams)
  const op = OPERATOR_LABELS[rule.op]
  if (VALUELESS_OPERATORS.has(rule.op)) return `${meta.label} ${op}`
  let value = rule.value
  if (meta.kind === 'choice') {
    value = meta.options?.find((o) => o.value === rule.value)?.label ?? rule.value
  } else if (meta.kind === 'boolean') {
    value = rule.value === 'true' ? 'yes' : 'no'
  } else if (meta.kind === 'list' && meta.options) {
    // Attribute multi_select: render option labels, not the raw stored ids
    // (static list fields like tags have no `options` metadata, so they keep
    // showing raw ids — unchanged, pre-existing behavior).
    const ids = rule.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    value = ids.map((id) => meta.options!.find((o) => o.value === id)?.label ?? id).join(', ')
  }
  return `${meta.label} ${op} ${value || '…'}`
}

export function conditionSummary(
  condition: GraphCondition,
  attributes: ReadonlyMap<string, AttributeFieldDef> = new Map(),
  teams: ReadonlyMap<string, string> = new Map()
): string {
  const draft = conditionToDraft(condition)
  if (draft.kind === 'advanced') return 'Custom condition'
  if (draft.rules.length === 0) return 'Matches everything'
  const first = ruleSummary(draft.rules[0]!, attributes, teams)
  if (draft.rules.length === 1) return first
  return `${first} +${draft.rules.length - 1} more`
}

export const WAIT_UNITS = [
  { value: 'seconds', seconds: 1, singular: 'second', plural: 'seconds' },
  { value: 'minutes', seconds: 60, singular: 'minute', plural: 'minutes' },
  { value: 'hours', seconds: 3600, singular: 'hour', plural: 'hours' },
  { value: 'days', seconds: 86400, singular: 'day', plural: 'days' },
] as const

export type WaitUnit = (typeof WAIT_UNITS)[number]['value']

/** The largest unit that divides the wait evenly (falls back to seconds). */
export function secondsToWaitParts(total: number): { amount: number; unit: WaitUnit } {
  for (let i = WAIT_UNITS.length - 1; i >= 0; i--) {
    const unit = WAIT_UNITS[i]!
    if (total > 0 && total % unit.seconds === 0) {
      return { amount: total / unit.seconds, unit: unit.value }
    }
  }
  return { amount: total, unit: 'minutes' }
}

/** "N units" phrase for a duration in seconds, without a leading verb, so
 *  callers compose their own ("Wait ", "Snooze for ", "For "). Shared by
 *  waitSummary below and the snooze action's relative-duration summary. */
export function durationPhrase(totalSeconds: number): string {
  const { amount, unit } = secondsToWaitParts(totalSeconds)
  const meta = WAIT_UNITS.find((u) => u.value === unit)!
  return `${amount} ${amount === 1 ? meta.singular : meta.plural}`
}

export function waitSummary(totalSeconds: number): string {
  return `Wait ${durationPhrase(totalSeconds)}`
}

/** set_attribute values keep JSON types: "5" stays a number, "vip" a string. */
export function parseAttributeValue(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function attributeValueText(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value) ?? ''
}

// ---------------------------------------------------------------------------
// The editor draft: visual (tree) or JSON text, switchable both ways.
// ---------------------------------------------------------------------------

export type GraphDraft =
  | { mode: 'visual'; tree: WorkflowTree }
  | { mode: 'json'; text: string; notice?: string }

/**
 * Open a stored graph for editing: visual when the graph is tree-shaped,
 * otherwise JSON mode with the reason (nothing is dropped or rewritten).
 */
export function initialGraphDraft(graph: unknown): GraphDraft {
  if (graph == null) return { mode: 'visual', tree: newTree() }
  const asText = () => JSON.stringify(graph, null, 2) ?? ''
  const valid = validateGraph(graph)
  if (!valid.ok) {
    return {
      mode: 'json',
      text: asText(),
      notice: `The stored graph needs attention: ${valid.error}`,
    }
  }
  const tree = graphToTree(valid.value)
  if (!tree.ok) {
    return {
      mode: 'json',
      text: asText(),
      notice: `Shown as JSON because ${tree.error}. The visual builder needs a single tree of paths.`,
    }
  }
  return { mode: 'visual', tree: tree.value }
}

/** The graph JSON to save, from whichever mode the editor is in. */
export function draftToGraphJson(draft: GraphDraft): Result<WorkflowGraphJson> {
  if (draft.mode === 'json') return parseWorkflowGraphText(draft.text)
  // Re-validate so half-filled steps (e.g. an assign with no teammate) fail
  // here with a readable message instead of a server 400.
  const graph = treeToGraph(draft.tree)
  const check = validateGraph(graph)
  return check.ok ? { ok: true, value: graph } : check
}

// ---------------------------------------------------------------------------
// Step addressing: locate/replace a step by id without threading positional
// callbacks through the render recursion. The fullscreen builder's inspector
// panel is not co-located with the node it edits (the canvas only renders
// cards and reports a selected id), so it needs to turn "step X changed" into
// an updated tree knowing only X's id.
// ---------------------------------------------------------------------------

/** One branch hop (which branch step, which of its paths) from the tree root. */
export interface StepLocation {
  path: { branchId: string; pathKey: string }[]
}

export const ROOT_LOCATION: StepLocation = { path: [] }

/** The steps array a location addresses (the root list, or a branch path's). */
export function stepsAtLocation(tree: WorkflowTree, location: StepLocation): TreeStep[] {
  let steps = tree.steps
  for (const hop of location.path) {
    const branch = steps.find((s) => s.id === hop.branchId)
    const paths = branch ? stepPaths(branch) : null
    if (!paths) return []
    const path = paths.find((p) => p.key === hop.pathKey)
    steps = path ? path.steps : []
  }
  return steps
}

function replaceStepsAtLocation(
  tree: WorkflowTree,
  location: StepLocation,
  steps: TreeStep[]
): WorkflowTree {
  if (location.path.length === 0) return { ...tree, steps }
  const replaceIn = (current: TreeStep[], hops: StepLocation['path']): TreeStep[] => {
    const [hop, ...rest] = hops
    return current.map((s) => {
      if (!hop || s.id !== hop.branchId) return s
      const paths = stepPaths(s)
      if (!paths) return s
      const path = paths.find((p) => p.key === hop.pathKey)
      const nextSteps = rest.length === 0 ? steps : replaceIn(path?.steps ?? [], rest)
      return withPathSteps(s, hop.pathKey, nextSteps)
    })
  }
  return { ...tree, steps: replaceIn(tree.steps, location.path) }
}

/** Find a step anywhere in the tree by id, with the location needed to update it. */
export function findStepById(
  tree: WorkflowTree,
  id: string
): { step: TreeStep; location: StepLocation } | null {
  const search = (
    steps: TreeStep[],
    location: StepLocation
  ): { step: TreeStep; location: StepLocation } | null => {
    for (const step of steps) {
      if (step.id === id) return { step, location }
      const paths = stepPaths(step)
      if (paths) {
        for (const p of paths) {
          const found = search(p.steps, {
            path: [...location.path, { branchId: step.id, pathKey: p.key }],
          })
          if (found) return found
        }
      }
    }
    return null
  }
  return search(tree.steps, ROOT_LOCATION)
}

/** Insert `step` at `index` within the steps array `location` addresses. */
export function insertStepAt(
  tree: WorkflowTree,
  location: StepLocation,
  index: number,
  step: TreeStep
): WorkflowTree {
  return replaceStepsAtLocation(
    tree,
    location,
    insertStep(stepsAtLocation(tree, location), index, step)
  )
}

/** Replace the step with `id` (wherever it is) via `updater`. A no-op if missing. */
export function updateStepById(
  tree: WorkflowTree,
  id: string,
  updater: (step: TreeStep) => TreeStep
): WorkflowTree {
  const found = findStepById(tree, id)
  if (!found) return tree
  const steps = stepsAtLocation(tree, found.location)
  return replaceStepsAtLocation(
    tree,
    found.location,
    steps.map((s) => (s.id === id ? updater(s) : s))
  )
}

/** Remove the step with `id` (wherever it is), along with any nested steps. */
export function removeStepById(tree: WorkflowTree, id: string): WorkflowTree {
  const found = findStepById(tree, id)
  if (!found) return tree
  const steps = stepsAtLocation(tree, found.location)
  return replaceStepsAtLocation(
    tree,
    found.location,
    steps.filter((s) => s.id !== id)
  )
}

// ---------------------------------------------------------------------------
// Per-step issues: the subset of validateAction's rules that apply to an
// already-typed GraphAction. Every step in a WorkflowTree is well-formed (it
// came from a validated graph or from createStep's defaults), so the only
// thing left to flag is a step still missing a required choice — e.g. an
// "Assign to team" step with no team picked yet. Kept in sync with
// validateAction by hand: that one validates unknown JSON and prefixes a
// "where", this one validates a typed action for a plain message, so they
// can't share one function body.
// ---------------------------------------------------------------------------

/** Sentinel ref prefix used by workflow templates for config only the workspace
 *  can supply (a team id, an SLA policy id). Sentinels keep template graphs
 *  schema-valid so they create cleanly, while reading as unset here so the list
 *  badge and the builder's issues chip demand setup before going live. */
export const NEEDS_SETUP_PREFIX = 'needs-setup-'

/** True when the ref is a template placeholder rather than a real id. */
export function isNeedsSetupRef(v: string | undefined): boolean {
  return typeof v === 'string' && v.startsWith(NEEDS_SETUP_PREFIX)
}

const isSetRef = (v: string | undefined): boolean => Boolean(v) && !isNeedsSetupRef(v)

// ---------------------------------------------------------------------------
// Conversational block summaries + issues (Phase C, slice C-5): the outline
// row / canvas card text for each of the 8 new kinds, and the collectStepIssues
// rules the "Set live" gate enforces for them.
// ---------------------------------------------------------------------------

function attributeLabel(key: string, attributes: ReadonlyMap<string, AttributeFieldDef>): string {
  if (!key) return 'Choose an attribute…'
  return attributes.get(key)?.label ?? key
}

export function collectDataSummary(
  step: Extract<TreeStep, { kind: 'collect_data' }>,
  attributes: ReadonlyMap<string, AttributeFieldDef> = new Map()
): string {
  return `Collect ${attributeLabel(step.attributeKey, attributes)}`
}

export function collectReplySummary(
  step: Extract<TreeStep, { kind: 'collect_reply' }>,
  attributes: ReadonlyMap<string, AttributeFieldDef> = new Map()
): string {
  return `Save reply to ${attributeLabel(step.attributeKey, attributes)}`
}

export function replyButtonsSummary(step: Extract<TreeStep, { kind: 'reply_buttons' }>): string {
  const labels = step.paths.map((p) => p.label).filter(Boolean)
  return labels.length === 0 ? 'No buttons yet' : labels.join(' · ')
}

export function csatSummary(step: Extract<TreeStep, { kind: 'request_csat' }>): string {
  const n = step.paths.length
  return n === 0
    ? 'Ask for a rating'
    : `Ask for a rating · branches on ${n} rating${n === 1 ? '' : 's'}`
}

/** Kinds SEND_BLOCK_KINDS/COLLECT_BLOCK_KINDS both cover — every
 *  conversational block, for the standalone-disable_composer adjacency
 *  check below (only the two interactive/interrupt-relevant kinds count as
 *  "adjacent", per the contract's interrupt matrix). */
const INTERRUPT_RELEVANT_KINDS = new Set<TreeStep['kind']>(['reply_buttons', 'request_csat'])

/** Per-block-kind "Set live" issue, mirroring actionIssue's shape for the
 *  pre-existing action steps. Covers the brief's amendment-3-adjacent gate
 *  rules: an empty message body, zero buttons, a missing attribute pick. */
function blockStepIssue(step: TreeStep): string | null {
  switch (step.kind) {
    case 'message':
      return isBlockBodyEmpty(step.body) ? 'Write the message' : null
    case 'reply_buttons':
      if (step.paths.length === 0) return 'Add at least one button'
      if (step.paths.some((p) => !p.label.trim())) return 'Every button needs a label'
      return isBlockBodyEmpty(step.body) ? 'Write the prompt' : null
    case 'collect_data':
      // isSetRef (not a bare truthiness check) so a template's needs-setup-
      // attribute sentinel also reads as unresolved, same as every other
      // workspace ref (team/policy/tag) actionIssue already gates on.
      if (!isSetRef(step.attributeKey)) return 'Choose an attribute'
      return isBlockBodyEmpty(step.body) ? 'Write the prompt' : null
    case 'collect_reply':
      if (!isSetRef(step.attributeKey)) return 'Choose an attribute'
      return isBlockBodyEmpty(step.body) ? 'Write the prompt' : null
    case 'request_csat':
      return isBlockBodyEmpty(step.body) ? 'Write the prompt' : null
    default:
      return null
  }
}

export function actionIssue(action: GraphAction): string | null {
  switch (action.type) {
    case 'assign_agent':
      return isSetRef(action.principalId) ? null : 'Choose a teammate to assign'
    case 'assign_team':
      return isSetRef(action.teamId) ? null : 'Choose a team to assign'
    case 'add_tag':
      return isSetRef(action.tagId) ? null : 'Choose a tag to add'
    case 'remove_tag':
      return isSetRef(action.tagId) ? null : 'Choose a tag to remove'
    case 'apply_sla':
      return isSetRef(action.policyId) ? null : 'Choose an SLA policy'
    case 'set_attribute':
      return action.key ? null : 'Choose an attribute'
    case 'snooze':
      // A relative snooze with no (or zero) duration never actually pauses —
      // the legacy absolute/until-reply form has no equivalent "unset" state
      // (untilIso is always either a real timestamp or explicitly null).
      return 'seconds' in action && action.seconds <= 0 ? 'Choose how long to snooze for' : null
    case 'set_priority':
    case 'close':
    case 'reopen':
      return null
  }
}

/** The class-rule gate's chip message (Phase C, slice C-6) — short enough for
 *  the inspector's issue banner, unlike classRestrictedNodeIssue's longer
 *  server-side wording naming the mechanism (this step is already selected,
 *  so it doesn't need to be named again). */
const CLASS_RESTRICTED_STEP_MESSAGE =
  'Only allowed in a customer-facing workflow — a background run parked here could never resume'

/** Every step id in the tree with an unresolved issue, mapped to its message.
 *  Amendment 3 (PHASE-C-BLOCK-CONTRACT.md): a standalone disable_composer (no
 *  adjacent reply_buttons/request_csat sibling in the same lane) is a runtime
 *  no-op, not a save-blocking error, but the gate still warns on it — the
 *  same soft-issue treatment every other entry in this map already gets
 *  (present in the count, but never a `blocking` structural failure).
 *
 *  `workflowClass` (Phase C, slice C-6): a parking-kind step (PARKING_BLOCK_
 *  KINDS — reply_buttons/collect_data/collect_reply/request_csat/
 *  let_assistant_answer/disable_composer) is flagged when the workflow isn't
 *  customer_facing, mirroring workflow.schemas.ts's classRestrictedNodeIssue
 *  (the server's save-time refusal) so the builder catches this before Set
 *  Live rather than only on a rejected save. This check wins over every other
 *  per-kind issue below for the same step — "wrong workflow entirely" is the
 *  more fundamental problem to fix first. Defaults to 'customer_facing' (the
 *  permissive case) so every existing call site/fixture that predates this
 *  parameter keeps behaving exactly as before. */
export function collectStepIssues(
  tree: WorkflowTree,
  workflowClass: WorkflowClassValue = 'customer_facing'
): Map<string, string> {
  const issues = new Map<string, string>()
  const walk = (steps: TreeStep[]) => {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!
      if (workflowClass !== 'customer_facing' && PARKING_BLOCK_KINDS.has(step.kind)) {
        issues.set(step.id, CLASS_RESTRICTED_STEP_MESSAGE)
      } else if (step.kind === 'action') {
        const message = actionIssue(step.action)
        if (message) issues.set(step.id, message)
      } else if (step.kind === 'disable_composer') {
        const adjacent = (s: TreeStep | undefined) => !!s && INTERRUPT_RELEVANT_KINDS.has(s.kind)
        if (!adjacent(steps[i - 1]) && !adjacent(steps[i + 1])) {
          issues.set(step.id, 'Place this next to a reply-buttons or rating step, or remove it')
        }
      } else {
        const message = blockStepIssue(step)
        if (message) issues.set(step.id, message)
      }
      const paths = stepPaths(step)
      if (paths) for (const p of paths) walk(p.steps)
    }
  }
  walk(tree.steps)
  return issues
}

export interface DraftIssues {
  count: number
  ids: ReadonlySet<string>
  firstId: string | null
  /** A structural problem (bad JSON, a cycle, an orphan step) blocking save entirely. */
  blocking: string | null
}

/** Validation summary for the top bar's issues chip and the Set-live gate.
 *  `workflowClass` (Phase C, slice C-6, default 'customer_facing' — see
 *  collectStepIssues' doc) also gates JSON mode: a JSON edit is the same
 *  "already-stored-shape" write path create/updateWorkflowFn validates
 *  server-side, so a parking-kind node saved into a non-customer_facing
 *  workflow via JSON mode is surfaced here as a blocking error too, instead
 *  of only failing as a server 400 after Save is clicked. */
export function draftIssues(
  draft: GraphDraft,
  workflowClass: WorkflowClassValue = 'customer_facing'
): DraftIssues {
  if (draft.mode === 'json') {
    const parsed = parseWorkflowGraphText(draft.text)
    if (!parsed.ok) return { count: 1, ids: new Set(), firstId: null, blocking: parsed.error }
    const classIssue = classRestrictedNodeIssue(parsed.value, workflowClass)
    if (classIssue) return { count: 1, ids: new Set(), firstId: null, blocking: classIssue }
    return { count: 0, ids: new Set(), firstId: null, blocking: null }
  }
  const stepIssues = collectStepIssues(draft.tree, workflowClass)
  const ids = new Set(stepIssues.keys())
  const [firstId = null] = ids
  return { count: ids.size, ids, firstId, blocking: null }
}

// ---------------------------------------------------------------------------
// Outline: a flat top-to-bottom list for the builder's left rail, derived from
// the same tree the canvas renders. Branch paths get an unselectable section
// header row ("Path A · Billing"); everything else is one selectable row per
// step, indented one level per branch nesting.
// ---------------------------------------------------------------------------

export type OutlineEntry =
  | { kind: 'trigger'; id: string; label: string; depth: number; hasIssue: false }
  | { kind: TreeStep['kind']; id: string; label: string; depth: number; hasIssue: boolean }
  | { kind: 'path-header'; label: string; depth: number }

export const PATH_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function stepLabel(step: TreeStep, labels: EntityLabels): string {
  switch (step.kind) {
    case 'action':
      return actionSummary(step.action, labels)
    case 'condition':
      return conditionSummary(step.condition, labels.attributes)
    case 'wait':
      return waitSummary(step.seconds)
    case 'branch':
      return `Branch · ${step.paths.length} path${step.paths.length === 1 ? '' : 's'}`
    case 'message':
      return blockBodyPreview(step.body)
    case 'show_reply_time':
      return BLOCK_STEP_LABELS.show_reply_time
    case 'disable_composer':
      return BLOCK_STEP_LABELS.disable_composer
    case 'let_assistant_answer':
      return BLOCK_STEP_LABELS.let_assistant_answer
    case 'reply_buttons':
      return replyButtonsSummary(step)
    case 'collect_data':
      return collectDataSummary(step, labels.attributes)
    case 'collect_reply':
      return collectReplySummary(step, labels.attributes)
    case 'request_csat':
      return csatSummary(step)
  }
}

export function deriveOutline(
  tree: WorkflowTree,
  triggerLabelText: string,
  issues: ReadonlyMap<string, string>,
  labels: EntityLabels = {}
): OutlineEntry[] {
  const entries: OutlineEntry[] = [
    { kind: 'trigger', id: tree.triggerId, label: triggerLabelText, depth: 0, hasIssue: false },
  ]
  const walk = (steps: TreeStep[], depth: number) => {
    for (const step of steps) {
      entries.push({
        kind: step.kind,
        id: step.id,
        label: stepLabel(step, labels),
        depth,
        hasIssue: issues.has(step.id),
      })
      const paths = stepPaths(step)
      if (paths) {
        paths.forEach((p, i) => {
          const letter = PATH_LETTERS[i] ?? String(i + 1)
          entries.push({
            kind: 'path-header',
            label: `Path ${letter} · ${p.label}`,
            depth: depth + 1,
          })
          walk(p.steps, depth + 1)
        })
      }
    }
  }
  walk(tree.steps, 0)
  return entries
}

// ---------------------------------------------------------------------------
// Insertion context: the inspector palette's subtitle when a "+" connector is
// active ("Inserts in path B · Bug reports", "Appends to path A · Billing").
// Additive helper for the React Flow canvas rebuild — the trunk/path framing
// mirrors deriveOutline's path headers so the two stay in the same voice.
// ---------------------------------------------------------------------------

/** Human-readable description of where a pending palette insertion lands. */
export function describeInsertionContext(
  tree: WorkflowTree,
  location: StepLocation,
  index: number
): string {
  const steps = stepsAtLocation(tree, location)
  const appending = index >= steps.length

  if (location.path.length === 0) {
    return appending ? 'Appends to the workflow' : 'Inserts into the workflow'
  }

  const lastHop = location.path[location.path.length - 1]!
  const branch = findStepById(tree, lastHop.branchId)?.step
  const paths = branch ? (stepPaths(branch) ?? []) : []
  const pathIndex = paths.findIndex((p) => p.key === lastHop.pathKey)
  const letter = PATH_LETTERS[pathIndex] ?? String(pathIndex + 1)
  const label = `path ${letter} · ${paths[pathIndex]?.label ?? lastHop.pathKey}`
  return appending ? `Appends to ${label}` : `Inserts in ${label}`
}
