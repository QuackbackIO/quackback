/**
 * Zod validation for a workflow graph + trigger settings (support platform §4.6).
 * The engine reads a stored graph defensively (a malformed shape just produces
 * nothing), but authoring should fail loud, so the fn layer validates writes
 * here. The schemas mirror the domain types (WorkflowAction / WorkflowCondition /
 * WorkflowNode / WorkflowGraph); a compile-time check at the bottom pins them to
 * the types so the two can't silently drift.
 *
 * CALIBRATION: the builder's "Edit as JSON" mode is a deliberately lossless
 * escape hatch that can store graphs the visual editor can't render (multiple
 * triggers, merged paths, cycles, unreachable nodes) — the runtime walker
 * (graph.ts) tolerates every one of those (a visited-set ends a re-entered
 * path; a missing successor just ends a path early). None of that is rejected
 * here. Validation only hard-rejects shapes the walker can never make sense of
 * at runtime: a duplicate node id, an edge pointing at a node id that doesn't
 * exist, a wait longer than MAX_WAIT_SECONDS, and a branch edge whose `branch`
 * key isn't one the node declares. Applies to writes only (create/update) —
 * an already-stored graph is never re-validated on read.
 */
import { z } from 'zod'
import {
  ATTRIBUTE_FIELD_PREFIX,
  PERSON_ATTRIBUTE_FIELD_PREFIX,
  COMPANY_ATTRIBUTE_FIELD_PREFIX,
  CONDITION_FIELDS,
  type WorkflowCondition,
} from './condition.evaluator'
import { DISPATCHABLE_TRIGGER_TYPES } from '@/lib/shared/workflow-trigger-types'
import { MAX_CONVERSATION_MESSAGE_LENGTH } from '@/lib/shared/conversation/types'
import { TICKET_STATUS_CATEGORIES } from '@/lib/shared/db-types'

/** Every dynamic attribute prefix a condition field may carry, alongside the
 *  static CONDITION_FIELDS catalogue — conversation/person/company
 *  attributes each key their own store (see condition.evaluator.ts), but
 *  share the same "prefix + non-empty key" authoring shape. */
const DYNAMIC_ATTRIBUTE_FIELD_PREFIXES = [
  ATTRIBUTE_FIELD_PREFIX,
  PERSON_ATTRIBUTE_FIELD_PREFIX,
  COMPANY_ATTRIBUTE_FIELD_PREFIX,
] as const

const conditionOperator = z.enum([
  'eq',
  'neq',
  'contains',
  'not_contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'includes_any',
  'excludes_all',
  'is_set',
  'is_empty',
])

const conditionLeaf = z.object({
  // Validated against the evaluator's field catalogue so a typo is caught on
  // save. Attribute predicates are dynamic (conversation.attr.<key>,
  // person.attr.<key>, company.attr.<key>) so they pass by prefix instead of
  // the static enum.
  field: z.union([
    z.enum(CONDITION_FIELDS),
    z
      .string()
      .refine(
        (f) =>
          DYNAMIC_ATTRIBUTE_FIELD_PREFIXES.some(
            (prefix) => f.startsWith(prefix) && f.length > prefix.length
          ),
        { message: 'Unknown condition field' }
      ),
  ]),
  op: conditionOperator,
  value: z.unknown().optional(),
})

// Recursive: a group nests conditions under all / any. The group is strict so a
// typo'd leaf (bad field) can't slip through as an empty group when its unknown
// keys would otherwise be stripped.
const conditionSchema: z.ZodType<WorkflowCondition> = z.lazy(() =>
  z.union([
    conditionLeaf,
    z
      .object({
        all: z.array(conditionSchema).optional(),
        any: z.array(conditionSchema).optional(),
      })
      .strict(),
  ])
)

/** A wait (or snooze duration) longer than this is almost certainly a
 *  misconfiguration (a unit mixup, e.g. minutes typed into a "days" field)
 *  rather than an intentional pause — the floor stays >= 0 (unchanged) for a
 *  same-instant wait. */
export const MAX_WAIT_SECONDS = 90 * 24 * 60 * 60 // 90 days

// Two shapes share the 'snooze' action type (a plain z.union, not a
// discriminatedUnion, since discriminatedUnion requires a unique literal per
// branch and both branches are 'snooze'): the legacy absolute form
// (untilIso, an ISO string, or null for "until they reply") and the relative
// form (seconds, resolved to now + seconds at execution time — see
// action.executor.ts). `.strict()` on each branch means a payload carrying
// both keys matches neither (same "exactly one" trick as item-ref.schema.ts),
// so a stored graph can never be ambiguous about which form it's in.
const snoozeActionSchema = z.union([
  z.object({ type: z.literal('snooze'), untilIso: z.string().datetime().nullable() }).strict(),
  z
    .object({ type: z.literal('snooze'), seconds: z.number().int().min(0).max(MAX_WAIT_SECONDS) })
    .strict(),
])

const actionSchema = z.union([
  z.object({ type: z.literal('assign_agent'), principalId: z.string().min(1) }),
  z.object({ type: z.literal('assign_team'), teamId: z.string().min(1) }),
  z.object({ type: z.literal('add_tag'), tagId: z.string().min(1) }),
  z.object({ type: z.literal('remove_tag'), tagId: z.string().min(1) }),
  z.object({
    type: z.literal('set_priority'),
    priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
  }),
  snoozeActionSchema,
  z.object({ type: z.literal('close') }),
  // (SF4) `close`'s counterpart — see action.executor.ts's WorkflowAction doc
  // for why this is workflows-only, not shared with macro.schemas.ts's
  // separate MacroAction catalogue.
  z.object({ type: z.literal('reopen') }),
  z.object({ type: z.literal('apply_sla'), policyId: z.string().min(1) }),
  z.object({ type: z.literal('set_attribute'), key: z.string().min(1), value: z.unknown() }),
  // Plain-text v1 (no rich body / mentions yet — see action.executor.ts's
  // WorkflowAction doc): bounded to the same length the underlying note write
  // path (conversation.service.ts's addAgentNote -> validateContent) already
  // enforces, so a graph can never store a body the executor would reject at
  // run time.
  z.object({
    type: z.literal('add_note'),
    body: z.string().min(1).max(MAX_CONVERSATION_MESSAGE_LENGTH),
  }),
  // Ticket actions (support platform's ticket-actions extension) — see
  // action.executor.ts's WorkflowAction doc for the resolve-the-linked-ticket
  // + throw-if-none policy both share.
  z.object({ type: z.literal('set_ticket_status'), statusId: z.string().min(1) }),
  // No settings: a no-op when the conversation already has a linked customer
  // ticket, else creates one and links it.
  z.object({ type: z.literal('convert_to_ticket') }),
])

// Conversational block kinds (Phase C, slice C-1). `blockBodySchema` is a
// deliberately permissive TipTap-shaped recursive schema — CALIBRATION: like
// the rest of this module, it exists to catch a shape the walker/interpolator
// can't make sense of (not a `text`/`content` field means the node isn't
// walkable), not to enumerate an allowed node/mark-type catalogue the way
// lib/shared/schemas/posts.ts's tiptapContentSchema does for post bodies —
// the message-block editor is a separate authoring surface with its own
// palette, and duplicating that catalogue here would only drift from it.
const blockBodySchema: z.ZodType<{
  type: string
  content?: unknown[]
  text?: string
  marks?: { type: string; attrs?: Record<string, string | number | boolean | null> }[]
  attrs?: Record<string, string | number | boolean | null>
}> = z.lazy(() =>
  z.object({
    type: z.string().min(1),
    content: z.array(blockBodySchema).optional(),
    text: z.string().optional(),
    marks: z
      .array(
        z.object({
          type: z.string().min(1),
          attrs: z
            .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
            .optional(),
        })
      )
      .optional(),
    attrs: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional(),
  })
)

/** A per-step assistant instruction (Phase C, slice C-6) longer than this is
 *  almost certainly a copy-pasted persona/policy doc, not a one-time
 *  instruction for a single hand-off — bounded generously, same rationale as
 *  MAX_WAIT_SECONDS/MAX_FREQUENCY_CAP_COUNT above. */
export const MAX_ASSISTANT_STEP_INSTRUCTIONS = 2000

const buttonOptionSchema = z.object({ key: z.string().min(1), label: z.string().min(1).max(80) })
const attributeOptionSchema = z.object({ id: z.string().min(1), label: z.string().min(1) })

/** Per-node timeout override bounds for `call_connector` — mirrors the
 *  `data_connectors.timeout_ms` column's own CHECK (<= 30000); the floor of 1
 *  just rules out a nonsensical/zero timeout, same rationale as every other
 *  bounded-int field in this module (a typo reads as "broken", not
 *  "unlimited"). See connector.execute.ts's executeConnector for how the
 *  override is applied (wins over the connector's own configured timeout). */
export const MIN_CALL_CONNECTOR_TIMEOUT_MS = 1
export const MAX_CALL_CONNECTOR_TIMEOUT_MS = 30000

/** The single labeled path a `call_connector` node may declare — mirrors
 *  LET_ASSISTANT_ESCALATED_BRANCH's role in graph.ts: the R-8 branch-key
 *  check below only ever declares this ONE key for a call_connector node, so
 *  a labeled edge leaving one with any other key is rejected the same way an
 *  undeclared branch-node key is. The success path is the unlabeled default
 *  edge (not a declared key at all — same as let_assistant_answer's
 *  "continue" path), never validated against this set. */
export const CALL_CONNECTOR_FAILED_KEY = 'failed'

const nodeSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('trigger') }),
  z.object({ id: z.string().min(1), type: z.literal('action'), action: actionSchema }),
  z.object({ id: z.string().min(1), type: z.literal('condition'), condition: conditionSchema }),
  z.object({
    id: z.string().min(1),
    type: z.literal('branch'),
    branches: z.array(z.object({ key: z.string().min(1), condition: conditionSchema })),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('wait'),
    seconds: z.number().int().min(0).max(MAX_WAIT_SECONDS),
  }),
  // ── Conversational block kinds (Phase C, slice C-1) ──────────────────────
  z.object({ id: z.string().min(1), type: z.literal('message'), body: blockBodySchema }),
  z.object({ id: z.string().min(1), type: z.literal('show_reply_time') }),
  z.object({
    id: z.string().min(1),
    type: z.literal('let_assistant_answer'),
    // Both optional (Phase C, slice C-6): a one-time per-step instruction
    // folded into just this turn's prompt (see assistant.runtime.ts's
    // buildStepInstructionsPrompt), and a reserved auto-close override with
    // no backing runtime knob yet — see graph.ts's WorkflowNode doc for why
    // the walker leaves autoCloseOverride deliberately unread.
    instructions: z.string().max(MAX_ASSISTANT_STEP_INSTRUCTIONS).optional(),
    autoCloseOverride: z.boolean().optional(),
  }),
  z.object({ id: z.string().min(1), type: z.literal('disable_composer') }),
  z.object({
    id: z.string().min(1),
    type: z.literal('reply_buttons'),
    body: blockBodySchema,
    // At least one option: a buttons block with none is unusable at runtime
    // (nothing to tap, the run can never resume by button match). The soft
    // 2-8 usability cap from the UX brief is builder-warning territory, not
    // a hard save rejection.
    options: z.array(buttonOptionSchema).min(1),
    allowTyping: z.boolean(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('collect_data'),
    body: blockBodySchema,
    attributeKey: z.string().min(1),
    fieldType: z.enum(['text', 'number', 'select', 'date']),
    options: z.array(attributeOptionSchema).optional(),
    required: z.boolean(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('collect_reply'),
    body: blockBodySchema,
    attributeKey: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('request_csat'),
    body: blockBodySchema,
    allowTypingInterrupt: z.boolean(),
    commentPrompt: z.string().max(200).optional(),
  }),
  // Calls an existing data connector mid-workflow — see graph.ts's module doc
  // for why this is its own fourth park kind rather than a catalogue action.
  // `params` values are plain `{key|fallback}` template strings (interpolated
  // at execution, action.executor.ts's executeCallConnectorNode); the shape
  // here doesn't know or care about the referenced connector's declared
  // inputs (that's a live-data concern, checked at execution, not authoring).
  z.object({
    id: z.string().min(1),
    type: z.literal('call_connector'),
    connectorId: z.string().min(1),
    params: z.record(z.string(), z.string()),
    timeoutMs: z
      .number()
      .int()
      .min(MIN_CALL_CONNECTOR_TIMEOUT_MS)
      .max(MAX_CALL_CONNECTOR_TIMEOUT_MS)
      .optional(),
  }),
])

/** The 8 conversational-block node kinds (Phase C, slice C-1) — every
 *  nodeSchema variant above that isn't a generic control-flow step (trigger/
 *  action/condition/branch/wait). Exported so the client's hand-authored
 *  BLOCK_STEP_LABELS catalogue (workflow-graph.ts) can be asserted to cover
 *  exactly this set — a drift guardrail test, since nothing else ties a new
 *  node kind added here to the client ever learning about it. */
export const BLOCK_NODE_TYPES = [
  'message',
  'show_reply_time',
  'let_assistant_answer',
  'disable_composer',
  'reply_buttons',
  'collect_data',
  'collect_reply',
  'request_csat',
] as const

const edgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  branch: z.string().optional(),
})

// Message builders for the structural checks below, shared with the client's
// validateGraph (workflow-graph.ts), which re-checks a graph before it's ever
// sent here. Exporting these keeps the wording from drifting between the two
// call sites instead of each hand-copying the other's string; the client
// prefixes an `edges[i]:`/`nodes[i]:` index these zod issues don't need
// (theirs carries a `path` instead).
export function duplicateStepIdMessage(id: string): string {
  return `Duplicate step id "${id}"`
}
export function missingStepMessage(id: string): string {
  return `Connection references a missing step "${id}"`
}
export function undeclaredBranchPathMessage(from: string, branch: string): string {
  return `Branch "${from}" has a connection for an undeclared path "${branch}"`
}

export const workflowGraphSchema = z
  .object({
    nodes: z.array(nodeSchema).max(200),
    edges: z.array(edgeSchema).max(400),
  })
  .superRefine((graph, ctx) => {
    // Cross-node checks the per-node/per-edge schemas above can't express on
    // their own — the walker (graph.ts) can't run at all against these, so
    // they're the only structural rejections beyond individual node/edge shape.
    // Deliberately NOT checked here (see the module doc): trigger count, merges,
    // cycles, unreachable nodes, unlabeled/dangling branch edges — the walker
    // tolerates all of those.
    const nodeIds = new Set<string>()
    for (let i = 0; i < graph.nodes.length; i++) {
      const node = graph.nodes[i]!
      if (nodeIds.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: duplicateStepIdMessage(node.id),
          path: ['nodes', i, 'id'],
        })
      }
      nodeIds.add(node.id)
    }

    const branchKeysByNodeId = new Map<string, Set<string>>()
    for (const node of graph.nodes) {
      if (node.type === 'branch') {
        branchKeysByNodeId.set(node.id, new Set(node.branches.map((b) => b.key)))
      } else if (node.type === 'call_connector') {
        // A call_connector node declares exactly ONE labeled path (the
        // failed edge) — the success path is the unlabeled default edge, not
        // a declared key. Mirrors let_assistant_answer's escalated-key
        // declaration in the client's validateGraph (workflow-graph.ts),
        // which this schema doesn't otherwise replicate for that kind (see
        // CALIBRATION note above) — call_connector gets it here because an
        // undeclared branch key on this node is unambiguously a mistake, not
        // a shape the walker tolerates.
        branchKeysByNodeId.set(node.id, new Set([CALL_CONNECTOR_FAILED_KEY]))
      }
    }

    for (let i = 0; i < graph.edges.length; i++) {
      const edge = graph.edges[i]!
      if (!nodeIds.has(edge.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: missingStepMessage(edge.from),
          path: ['edges', i, 'from'],
        })
      }
      if (!nodeIds.has(edge.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: missingStepMessage(edge.to),
          path: ['edges', i, 'to'],
        })
      }
      // A branch key the node doesn't declare can never be taken (the walker
      // matches branches by key), so it's dead weight at best and a stale
      // rename at worst. An edge with no branch key, or one leaving a
      // non-branch node, is left alone — the walker just never follows it.
      const declaredKeys = branchKeysByNodeId.get(edge.from)
      if (declaredKeys && edge.branch !== undefined && !declaredKeys.has(edge.branch)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: undeclaredBranchPathMessage(edge.from, edge.branch),
          path: ['edges', i, 'branch'],
        })
      }
    }
  })

/**
 * Node kinds whose runtime PARKS the run awaiting an external resume signal
 * (Phase C, slices C-1/C-6): reply_buttons / collect_data / collect_reply /
 * request_csat wait for a customer's matching structured reply
 * (event-trigger.ts's tryResumeInputWait); let_assistant_answer waits for
 * Quinn's own hand-off/close signal (tryResumeAssistantWait).
 * disable_composer never parks on its own, but it only ever makes sense
 * adjacent to one of the above (it's builder sugar forcing allowTyping:false
 * on its neighbor), so it's restricted the same way — an admin who wants it
 * has to be building a customer-facing journey in the first place.
 *
 * CALIBRATION: restricted to `customer_facing` because the only two runtime
 * mechanisms that can ever find and resume a parked run —
 * findWaitingCustomerFacingRun (event-trigger.ts, both resume paths) and the
 * customer_facing exclusive lock (the partial unique index on
 * workflow_runs) — only ever look at customer_facing runs. A `background`
 * workflow reaching one of these nodes parks exactly the same way (the
 * walker doesn't know or care about class), but nothing will ever find that
 * row to resume it: it is unreachable and parks forever, a silent 'waiting'
 * leak with no recovery path (even the sweeper's orphan pass only reschedules
 * timer waits — see workflow-sweep.ts). `message` and `show_reply_time` post
 * and continue immediately — no park, so no such hazard — and stay legal in
 * any class.
 */
export const PARKING_BLOCK_KINDS: ReadonlySet<string> = new Set([
  'reply_buttons',
  'collect_data',
  'collect_reply',
  'request_csat',
  'let_assistant_answer',
  'disable_composer',
])

/**
 * The class-rule check (Phase C, slice C-6): null when `graph` has no
 * PARKING_BLOCK_KINDS node, or `workflowClass` is 'customer_facing' (always
 * legal there); otherwise a readable message naming the first offending step.
 * Called at save (functions/workflows.ts's create/update handlers) with the
 * EFFECTIVE class (the incoming patch's class, or the workflow's current
 * stored class when a graph-only update doesn't touch it) — applies to writes
 * only, same "an already-stored graph is never re-validated on read" rule
 * this whole module follows (see the module doc).
 */
export function classRestrictedNodeIssue(
  graph: { nodes: readonly { id: string; type: string }[] },
  workflowClass: 'customer_facing' | 'background'
): string | null {
  if (workflowClass === 'customer_facing') return null
  const offending = graph.nodes.find((n) => PARKING_BLOCK_KINDS.has(n.type))
  if (!offending) return null
  return (
    `Step "${offending.id}" (${offending.type}) parks the run awaiting a reply — only a ` +
    `customer_facing workflow can ever resume it (the resume lookup and the exclusive lock ` +
    `only cover customer-facing runs; a background run parked here is unreachable).`
  )
}

/** A per-(workflow, person) run cap, read by dispatcher.guards.ts's
 *  frequencyCapAllows off `trigger_settings.frequencyCap`. 'once' and
 *  'once_per_days' with no days elapsed both allow only a first run;
 *  'once_per_days' keys that first run to a rolling window (a fresh run is
 *  allowed once `days` have passed since the last one) while 'n_total' caps
 *  the lifetime count instead of gating on recency. Kept in sync with the
 *  guard's local type by hand (dispatcher.guards.ts imports this one).
 *  Bounds mirror MAX_WAIT_SECONDS' rationale: generous but finite, so a typo
 *  (an extra zero) doesn't read as "unlimited" instead of a real cap. */
export const MAX_FREQUENCY_CAP_DAYS = 365
export const MAX_FREQUENCY_CAP_COUNT = 1000
const frequencyCapSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('unlimited') }),
  z.object({ type: z.literal('once') }),
  z.object({
    type: z.literal('once_per_days'),
    days: z.number().int().min(1).max(MAX_FREQUENCY_CAP_DAYS),
  }),
  z.object({
    type: z.literal('n_total'),
    count: z.number().int().min(1).max(MAX_FREQUENCY_CAP_COUNT),
  }),
])
export type FrequencyCap = z.infer<typeof frequencyCapSchema>

/** `triggerSettings.audience` (support platform §4.6 audience targeting): an
 *  optional condition tree in the EXISTING conditionSchema shape — reused,
 *  not a parallel predicate format, so it evaluates through the same
 *  evaluateCondition every other condition in a run does. Enforced at
 *  dispatch by dispatcher.guards.ts's audienceAllows, beside channelAllows:
 *  a non-matching audience means the workflow is never matched (no
 *  first-match slot consumption for customer_facing). Defensive by the same
 *  "settings bag" philosophy as frequencyCap/channels above: a stored value
 *  that doesn't parse as a condition is caught there (not here) and allows
 *  through rather than blocking dispatch — see audienceAllows' doc. */
export const audienceConditionSchema = conditionSchema

/** `triggerSettings.sendWindow` (support platform §4.6): restricts a
 *  trigger to firing only inside/outside the workspace's office-hours
 *  schedule. 'any' (the default when the key is absent) never restricts.
 *  Enforced at dispatch by dispatcher.guards.ts's sendWindowAllows, beside
 *  channelAllows/audienceAllows, off the same office-hours snapshot the
 *  dispatch-resolved ConditionContext already carries (ctx.officeHours) —
 *  no extra DB read. */
export const sendWindowSchema = z.enum(['any', 'inside_office_hours', 'outside_office_hours'])
export type SendWindow = z.infer<typeof sendWindowSchema>

/** Per-workflow silence threshold for the two timer-driven unresponsive
 *  triggers (conversation.customer_unresponsive / teammate_unresponsive —
 *  support platform §4.6): workflow-sweep.ts reads this straight off each
 *  LIVE workflow's stored `triggerSettings` (not from an authored condition)
 *  to decide which conversations qualify FOR THAT WORKFLOW. Bounded 1 minute
 *  to 14 days — generous but finite, same rationale as MAX_WAIT_SECONDS (an
 *  unbounded value reads as "never", which isn't a real config). Default 60,
 *  applied by the trigger-editor and by workflow-sweep.ts's reader alike when
 *  the key is absent (a workflow authored before this field existed, or saved
 *  via the API without it). */
export const MAX_INACTIVITY_MINUTES = 14 * 24 * 60
export const DEFAULT_INACTIVITY_MINUTES = 60

/** Per-workflow lead time for sla.approaching_breach (support platform §4.6):
 *  how long before a clock's due date the warning fires. Bounded 1 minute to
 *  24 hours. Default 15. See sla.service.ts's sweepApproachingSlaBreaches for
 *  how multiple live workflows with different lead times are reconciled (the
 *  widest configured lead governs the single fire-once claim). */
export const MAX_BREACH_LEAD_MINUTES = 24 * 60
export const DEFAULT_BREACH_LEAD_MINUTES = 15

/** Trigger settings stay an open bag (channels, and whatever else the
 *  authoring surface adds later) — only `frequencyCap`/`audience`/
 *  `sendWindow`/`inactivityMinutes`/`breachLeadMinutes` get a validated shape
 *  when present, via `.catchall(z.unknown())` rather than `.strict()` or a
 *  plain `z.record`, so an unrecognized key still round-trips instead of
 *  being rejected or silently dropped. */
/** `triggerSettings.ticketStatusCategory` (ticket triggers extension):
 *  `ticket.status_changed` only — restricts the trigger to firing when the
 *  ticket ENTERS this category (a genuine crossing, not same-category churn;
 *  see event-trigger.ts's ticket.status_changed case for how "entered" is
 *  resolved off the event's own previous/new category fields). Absent =
 *  "any status change" (the default, never restricts). Enforced at dispatch
 *  by dispatcher.ts's own per-workflow filter, alongside channel/audience/
 *  sendWindow — ticket triggers aren't conversation-condition-evaluable the
 *  way the rest of the catalogue is, so this rides the same triggerSettings
 *  bag rather than a new condition field. */
export const ticketStatusCategorySchema = z.enum(TICKET_STATUS_CATEGORIES)

export const triggerSettingsSchema = z
  .object({
    frequencyCap: frequencyCapSchema.optional(),
    audience: audienceConditionSchema.optional(),
    sendWindow: sendWindowSchema.optional(),
    inactivityMinutes: z.number().int().min(1).max(MAX_INACTIVITY_MINUTES).optional(),
    breachLeadMinutes: z.number().int().min(1).max(MAX_BREACH_LEAD_MINUTES).optional(),
    ticketStatusCategory: ticketStatusCategorySchema.optional(),
  })
  .catchall(z.unknown())

/**
 * Validate a raw `inactivityMinutes`/`breachLeadMinutes` value against its
 * bounded-int shape straight off `triggerSettingsSchema`, collapsing anything
 * malformed (wrong type, not an integer, out of bounds, or simply absent)
 * down to `undefined` — ONE predicate (derived from the same zod shape the
 * authoring write path validates against, so the two can never drift) shared
 * by every reader of a stored `triggerSettings` bag: workflow-graph.ts's
 * client-side sanitizeInactivityMinutes/sanitizeBreachLeadMinutes and
 * workflow-sweep.ts's server-side readInactivityMinutes/readBreachLeadMinutes
 * previously each hand-copied this exact min/max/integer check. Callers
 * differ only in their FALLBACK when this returns undefined — the client
 * drops the key entirely, the sweep falls back to
 * DEFAULT_INACTIVITY_MINUTES/DEFAULT_BREACH_LEAD_MINUTES — so the fallback
 * stays at each call site, not here.
 */
function parseBoundedTriggerSetting(
  schema: z.ZodOptional<z.ZodNumber>,
  raw: unknown
): number | undefined {
  const parsed = schema.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

export function parseInactivityMinutes(raw: unknown): number | undefined {
  return parseBoundedTriggerSetting(triggerSettingsSchema.shape.inactivityMinutes, raw)
}

export function parseBreachLeadMinutes(raw: unknown): number | undefined {
  return parseBoundedTriggerSetting(triggerSettingsSchema.shape.breachLeadMinutes, raw)
}

/** Which trigger types a workflow can actually be dispatched on — see
 *  lib/shared/workflow-trigger-types.ts for the canonical list and how it's
 *  kept in sync with the event bus. Without this, functions/workflows.ts used
 *  to accept any string up to 80 characters, so a typo'd triggerType saved
 *  cleanly and then simply never fired. */
export const triggerTypeSchema = z.enum(DISPATCHABLE_TRIGGER_TYPES)

/**
 * The validated graph, with plain-string ids. The domain WorkflowGraph uses
 * branded TypeIDs on action fields; a validated string satisfies them at runtime,
 * so callers cast this to WorkflowGraph at the boundary. Keep this schema in sync
 * with the WorkflowAction / WorkflowNode / WorkflowGraph domain types by hand —
 * the branded ids make a structural compile-time equality check impractical.
 */
export type ValidatedWorkflowGraph = z.infer<typeof workflowGraphSchema>
