/**
 * Quinn's tool catalogue: one spec per tool, describing what it does, who can
 * use it, and how it runs, alongside the model-facing definition and its
 * server implementation. `assistant.tools.ts` assembles the catalogue into
 * TanStack AI server tools; nothing here talks to the model runtime directly.
 *
 * A tool's execution branch is decided per turn by `resolveEffectiveToolMode`
 * (assistant.tools.ts) from the turn's role policy, not from any saved
 * per-tool configuration: a real customer-support turn executes write tools
 * autonomously, a Copilot Q&A turn proposes them as approval cards, and the
 * admin sandbox previews them. `permissions` is still enforced (via `can`)
 * before a write executes.
 */
import {
  toolDefinition,
  type ToolDefinition,
  type InferToolInput,
  type InferToolOutput,
} from '@tanstack/ai'
import { z } from 'zod'
import {
  conversations,
  eq,
  ASSISTANT_HANDOFF_REASONS,
  type AssistantHandoffReason,
} from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import {
  isTypeId,
  type PrincipalId,
  type ConversationId,
  type TicketId,
  type AssistantInvolvementId,
  type SegmentId,
} from '@quackback/ids'
import { type ContentAudience } from './audience'
import {
  retrieveKnowledge,
  type RetrievedItem,
  type AssistantKnowledgeSnapshot,
} from './retrieval-sources'
import { ASSISTANT_CITATION_TYPES, type AssistantCitationType } from './citation-types'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { TICKET_TYPES, CONVERSATION_PRIORITIES } from '@/lib/shared/db-types'
import type { Actor } from '@/lib/server/policy/types'
import { DEFAULT_ASSISTANT_CONFIG, type AssistantRole } from '@/lib/shared/assistant/config'
import { setConversationAttribute } from '@/lib/server/domains/conversation-attributes/set-attribute.service'
import { classifyConversationAttributes } from '@/lib/server/domains/conversation-attributes/ai-classification.service'
import { readAttributeValue } from '@/lib/shared/conversation/attribute-values'
import { setConversationStatus } from '@/lib/server/domains/conversation/conversation.service'
import { createTicket } from '@/lib/server/domains/tickets/ticket.service'
import { createPostFromConversation } from '@/lib/server/domains/conversation/conversation.convert'
import { quinnActor } from './assistant.actor'
import { RETRIEVED_CONTENT_NOTE } from './injection-guard'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'assistant-toolspec' })

/** A structured citation — the only citation contract; never free-form markdown. */
export interface AssistantCitation {
  type: AssistantCitationType
  id: string
  title: string
  url: string
  /**
   * Set (never `false`) when the source adapter that produced this citation
   * determined it is not customer-visible: the server half of the copilot
   * leak gate. Ledger-only: never persist this onto a DB-stored citation (see
   * the orchestrator, which strips it before writing a conversation message).
   */
  internal?: boolean
  /**
   * ISO timestamp of the source's natural last update (article/post/snippet
   * updated_at, summary created_at), for the copilot hovercard's freshness
   * line. Ledger-only like `internal`: `executeSearchKnowledge` records it on
   * the ledgered citation whenever the source knows it, every surface's
   * answer carries it (clients render the freshness line only when present),
   * and the orchestrator strips it — alongside `internal`, at the one
   * persistence point — so the stored citation shape never changes.
   */
  updatedAt?: string
}

/**
 * One write-tool call the pipeline turned into a pending action this run
 * (P2-C.4). Recorded on `ctx.ledger.proposedActions` by the approval branch of
 * `runWithPipeline`, mirroring how `ctx.ledger.sources` collects citations: the
 * runtime surfaces the ledger on `AssistantTurnResult` unfiltered (unlike
 * citations, a proposal is never model-curated: every approval-mode call this
 * run created a real row, so every one of them is reported).
 */
export interface AssistantProposedAction {
  /** The `assistant_pending_actions` row id, for the approval queue / copilot card to look up. */
  id: string
  toolName: string
  /** `spec.summarize(args)` at proposal time, same text the inbox note card shows. */
  summary: string
  /** `spec.label` at proposal time — the admin-facing tool name (e.g. "End conversation"),
   *  for the proposed-action card's title. */
  label: string
}

export interface AssistantToolOutcome {
  name: string
  outcome: 'read' | 'simulated' | 'proposed' | 'executed' | 'failed'
}

/** A handoff Quinn explicitly requested through the handoff tool this attempt. */
export interface AssistantHandoffRequest {
  reason: AssistantHandoffReason
  customerNeed: string
  attempted: string[]
  recommendedNextStep: string
}

export const ASSISTANT_INABILITY_REASONS = [
  'no_relevant_sources',
  'tool_unavailable',
  'insufficient_context',
] as const

export type AssistantInabilityReason = (typeof ASSISTANT_INABILITY_REASONS)[number]

/**
 * How a write-risk tool's outcome resolves this turn (see the field's own doc
 * on `AssistantToolContext.writeToolPolicy` for the full contract of each
 * member). Named once here so the context field and `makeAssistantToolContext`
 * cannot drift on the union.
 */
export type AssistantWriteToolPolicy = 'simulate' | 'execute' | 'propose' | 'disabled'

/**
 * The per-attempt MUTABLE state a turn's tools accumulate: the citations they
 * surfaced, the calls and outcomes they recorded, and the orchestration
 * decisions (handoff / inability / proposed actions) they emitted. Split out
 * of the otherwise-immutable `AssistantToolContext` so the runtime's
 * per-attempt reset is a single `ctx.ledger = makeAssistantToolLedger()`
 * assignment and a newly added ledger field can never be forgotten in that
 * reset. Minted only by `makeAssistantToolLedger`.
 */
export interface AssistantToolLedger {
  /** Sources surfaced by search_knowledge this run, keyed by id, for citation assembly. */
  sources: Map<string, AssistantCitation>
  /**
   * Tool names actually invoked this attempt, in call order. Completion
   * validation and durable tracing use this observed ledger instead of
   * trying to infer actions from customer-facing prose.
   */
  toolCalls: string[]
  /** Privacy-safe outcomes for Test agent and operational traces. */
  toolOutcomes: AssistantToolOutcome[]
  /** Set only by the handoff_to_human control tool. */
  handoffRequest: AssistantHandoffRequest | null
  /** Set only by the report_inability control tool. */
  inabilityReport: { reason: AssistantInabilityReason } | null
  /**
   * Pending actions this run's write-tool calls turned into approval-queue
   * rows (P2-C.4), in call order. Populated by the approval branch of
   * `runWithPipeline` (assistant.tools.ts); cleared per attempt alongside
   * `sources`/`searchCalls` so a retry doesn't double-report an earlier
   * attempt's proposals. See `AssistantProposedAction`.
   */
  proposedActions: AssistantProposedAction[]
  /** search_knowledge calls made this attempt, for the server-side search budget. */
  searchCalls: number
}

/**
 * A fresh per-attempt ledger: empty source map, empty call/outcome/proposal
 * ledgers, no orchestration decision yet, zeroed search budget. The single
 * construction point, so the turn runtime's per-attempt reset and the initial
 * context both start from the identical clean state.
 */
export function makeAssistantToolLedger(): AssistantToolLedger {
  return {
    sources: new Map<string, AssistantCitation>(),
    toolCalls: [],
    toolOutcomes: [],
    handoffRequest: null,
    inabilityReport: null,
    proposedActions: [],
    searchCalls: 0,
  }
}

/**
 * Request-local context threaded to server tools (and middleware). Carries the
 * tenant db handle, Quinn's service principal, the viewer audience for
 * retrieval scoping, the linked conversation (null in the sandbox), and a
 * mutable `ledger` of sources surfaced and decisions emitted this run. It is
 * passed to `chat({ context })` and NEVER serialized into the model prompt.
 */
export interface AssistantToolContext {
  db: Executor
  assistantPrincipalId: PrincipalId
  /** Configured V2 identity for service-authored records created by tools. */
  assistantName: string
  /** Trust profile that originated this tool call and any pending action. */
  role: AssistantRole
  /**
   * The turn's retrieval ceiling, minted exclusively by `resolveContentAudience`
   * (see `./audience`). Never construct this from a raw string literal.
   */
  audience: ContentAudience
  conversationId: ConversationId | null
  /**
   * The linked ticket (unified inbox §2.9), or null. Mutually exclusive with
   * `conversationId` in practice — a copilot turn grounds on exactly one item
   * — but nothing here enforces that; the caller (`runAssistantTurn`) only
   * ever sets one. None of today's write tools are ticket-aware yet (they all
   * key off `conversationId` and report "no linked conversation" when it's
   * null, same as the sandbox), so this exists for `proposePendingAction`'s
   * polymorphic parent and for a future ticket-scoped write tool, not for any
   * tool's execute body today.
   */
  ticketId: TicketId | null
  /**
   * The current conversation's customer (its `visitorPrincipalId`), for
   * customer-scoped retrieval (past-conversation summaries — see
   * `conversation-summary-retrieval.ts`). Undefined when there is no real
   * customer to scope to (e.g. the admin sandbox, which has no conversation at
   * all): a customer-scoped source MUST return no results in that case, never
   * fall back to unscoped.
   */
  customerPrincipalId?: PrincipalId
  /**
   * Per-request NARROWING filter over the grounding sources search_knowledge
   * consults (the copilot Answer-sources picker); undefined means every
   * source the workspace's flags already registered. Can only drop a
   * registered source, never re-enable one a flag left off; see
   * `retrieveKnowledge` in `./retrieval-sources`.
   */
  sourceTypes?: RetrievedItem['sourceType'][]
  /**
   * The turn's compiled knowledge snapshot (config v3): the enabled retrieval
   * source types (drives which sources `search_knowledge` consults and its
   * dynamic enumeration) and whether `get_status` is registered. Minted by
   * `resolveAssistantKnowledgeSnapshot` (retrieval-sources.ts) from the
   * resolved agent's per-agent `knowledge` map; never re-read from settings
   * mid-turn.
   */
  knowledge: AssistantKnowledgeSnapshot
  /**
   * The per-attempt mutable ledger: sources surfaced, calls/outcomes recorded,
   * and orchestration decisions (handoff/inability/proposals) emitted this
   * attempt. Reset as a whole between attempts by the runtime
   * (`ctx.ledger = makeAssistantToolLedger()`). See `AssistantToolLedger`.
   */
  ledger: AssistantToolLedger
  /** True in the admin sandbox: write tools report what they would do instead of running. */
  simulate: boolean
  /**
   * How a write-risk tool's outcome resolves this turn (never consulted for a
   * read-risk or control tool). Selected from the turn's role policy
   * (`ASSISTANT_ROLE_POLICIES`, assistant.system-prompt.ts), or forced to
   * 'simulate' when `simulate` is true.
   * 'simulate' (the sandbox, and the default when unset while `simulate` is
   * true) always previews instead of running: there is no conversation to
   * attach a claim, approval, or denial to.
   * 'execute' (customer_support real turns) runs the write autonomously,
   * after its permission check — Featurebase-style autonomous execution, no
   * teammate approval in the loop.
   * 'propose' (P2-C.4, the copilot Q&A surface) resolves every write to a
   * pending-action proposal. From a Copilot chat the proposal card itself is
   * the confirmation UX, so nothing fires without a human decision. Quinn must
   * never act in the conversation from a teammate's Q&A about it, only ever
   * suggest an action for a human to approve.
   * 'disabled' (QUINN-PROACTIVE-SUGGESTIONS-SPEC.md, the proactive-suggestions
   * turn) drops the write-risk tool from the turn's tool set entirely — no
   * simulate preview, no proposal, not even a pending-approval row — because a
   * suggestion drafts a reply and must have zero side effects. Only ever set
   * by the runtime's own suggest-intent profile (`COPILOT_INTENT_PROFILES`,
   * assistant.runtime.ts), never passed in by a route: the invariant is the
   * intent's. See `resolveEffectiveToolMode` in assistant.tools.ts.
   */
  writeToolPolicy?: AssistantWriteToolPolicy
  /** The involvement this turn belongs to, for audit rows and pending actions. Null before the first involvement opens. */
  involvementId: AssistantInvolvementId | null
  /** The customer message this turn answers, keying the write-tool idempotency key. Null in the sandbox. */
  latestCustomerMessageId: string | null
  /**
   * The bounded actor the pipeline authorizes and executes as. Quinn's actor
   * by default; a future teammate-facing surface substitutes an
   * on-behalf-of-teammate actor without touching the pipeline or executors.
   */
  actor: Actor
}

/**
 * Build a tool context with the shared defaults (fresh source ledger, zeroed
 * search budget, Quinn's bounded actor, sandbox-derived simulate). The single
 * construction point: the turn runtime and the approved-action executor both
 * use it, so a new context field lands everywhere at once.
 */
export function makeAssistantToolContext(init: {
  db: Executor
  assistantPrincipalId: PrincipalId
  assistantName?: string
  role?: AssistantRole
  audience: ContentAudience
  conversationId: ConversationId | null
  ticketId?: TicketId | null
  customerPrincipalId?: PrincipalId | null
  sourceTypes?: RetrievedItem['sourceType'][]
  knowledge?: AssistantKnowledgeSnapshot
  involvementId?: AssistantInvolvementId | null
  latestCustomerMessageId?: string | null
  simulate?: boolean
  writeToolPolicy?: AssistantWriteToolPolicy
  actor?: Actor
}): AssistantToolContext {
  return {
    db: init.db,
    assistantPrincipalId: init.assistantPrincipalId,
    assistantName: init.assistantName ?? DEFAULT_ASSISTANT_CONFIG.identity.name,
    role: init.role ?? 'customer_support',
    audience: init.audience,
    conversationId: init.conversationId,
    ticketId: init.ticketId ?? null,
    customerPrincipalId: init.customerPrincipalId ?? undefined,
    sourceTypes: init.sourceTypes,
    // Non-runtime callers (the approved-action executor) never retrieve, so the
    // KB-only default is a safe floor; the turn runtime always passes a real
    // snapshot compiled from the agent's config.
    knowledge: init.knowledge ?? {
      sources: new Set<AssistantCitationType>(['article']),
      status: false,
    },
    ledger: makeAssistantToolLedger(),
    simulate: init.simulate ?? init.conversationId === null,
    writeToolPolicy: init.writeToolPolicy,
    involvementId: init.involvementId ?? null,
    latestCustomerMessageId: init.latestCustomerMessageId ?? null,
    actor: init.actor ?? quinnActor(init.assistantPrincipalId),
  }
}

/**
 * Hard per-attempt budget on search_knowledge. Prompt discipline alone does not
 * hold — a model that dislikes its results keeps reformulating until the
 * iteration cap kills the whole turn with no answer. Past the budget the tool
 * returns no articles and an explicit
 * instruction to answer from what was already retrieved, which deterministically
 * ends the exploration while keeping everything already in context usable.
 */
export const SEARCH_BUDGET_PER_TURN = 3

/**
 * Read tools observe; write tools change state and can require approval;
 * control tools emit a core orchestration decision and are always available.
 */
export type ToolRiskClass = 'read' | 'write' | 'control'

/**
 * The pipeline's gate results. Every tool's declared output must also admit
 * these: the model runtime validates execute results against outputSchema
 * AFTER the pipeline wrapper runs, so a pending-approval / denied / duplicate
 * / failed / simulated result must parse or the model sees a generic
 * validation error instead of the note it should relay to the customer.
 * Compose every definition's outputSchema through `withGateEnvelope`.
 */
export const assistantGateEnvelopeSchema = z.union([
  z.object({
    status: z.enum(['pending_approval', 'denied', 'skipped_duplicate', 'failed']),
    note: z.string(),
  }),
  z.object({ simulated: z.literal(true), summary: z.string() }),
])

/**
 * Compose a tool's outputSchema so it also admits the pipeline's gate
 * envelopes (pending-approval/denied/duplicate/failed/simulated).
 *
 * This deliberately does NOT use TanStack's `needsApproval` tool option.
 * Approval here is a PERSISTED queue — a pending-action row with a TTL, a
 * summary card a teammate reviews, and later execution as a bounded
 * teammate-actor (see `proposePendingAction` / `executeApprovedPendingAction`)
 * — not the in-stream client-side approval prompt `needsApproval` triggers. The
 * gate result is a normal tool output the model must be able to relay to the
 * customer, so it rides the outputSchema; do not migrate this to `needsApproval`.
 */
export function withGateEnvelope<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, assistantGateEnvelopeSchema])
}

/**
 * A tool's own SUCCESS output — everything its declared outputSchema admits
 * that is NOT a pipeline gate envelope. This is exactly what a spec's
 * `execute` returns (the pipeline wraps the gate envelopes on afterward), so
 * `defineToolSpec` derives `execute`'s return type from the model-facing
 * definition itself and it can never drift from the schema the model sees.
 */
type AssistantGateEnvelope = z.infer<typeof assistantGateEnvelopeSchema>
type ToolSuccessOutput<TDef> = Exclude<InferToolOutput<TDef>, AssistantGateEnvelope>

/**
 * One entry in Quinn's tool catalogue. Bundles the model-facing `definition`
 * with the admin-facing metadata (label/description/risk/permissions) needed
 * to list, gate, and audit the tool, plus the actual `execute` body kept
 * separate from `definition` so the execution pipeline can wrap it without
 * touching the model-facing schema.
 */
export interface AssistantToolSpec<In = unknown, Out = unknown> {
  /** Stable snake_case id, derived from `definition.name` by defineToolSpec. */
  name: string
  /** Admin UI display name. */
  label: string
  /** Admin UI copy explaining what the tool does — not the model-facing description. */
  description: string
  /**
   * One short, model-facing line of usage guidance for THIS tool: when to
   * call it, how often, what not to use it for. Composed into the system
   * prompt's "Your tools" section (buildAssistantSystemPrompt), keyed off the
   * actual assembled tool set for the turn — so adding a tool here is the
   * only change needed for the model to learn how to use it; the prompt
   * builder never lists tools by name itself.
   */
  promptGuidance: string
  risk: ToolRiskClass
  /** Checked via can(actor, p) before a write-risk tool executes autonomously. */
  permissions: readonly PermissionKey[]
  /**
   * Which kind(s) of item this tool can act on (unified inbox §2.9/§3.3): a
   * turn grounded on a ticket must never offer, propose, or execute a tool
   * that only knows how to act on a conversation. `assembleAssistantToolset`
   * (assistant.tools.ts) drops any spec whose `parents` doesn't include the
   * turn's actual parent kind BEFORE it ever reaches mode resolution or the
   * model — so a conversation-only tool simply never appears in a
   * ticket-scoped turn's catalogue, rather than appearing and reporting a
   * "no linked conversation" no-op. Every write tool defined in this file
   * predates ticket-scoped turns and only ever keys off `ctx.conversationId`,
   * so `['conversation']` is the correct default for all of them; a future
   * ticket-aware write tool declares `['ticket']` or both explicitly.
   */
  parents: readonly ('conversation' | 'ticket')[]
  /** Optional turn-local availability gate, applied before mode resolution. */
  availableWhen?: (ctx: AssistantToolContext) => boolean
  /** The TanStack tool definition: model-facing name, description, and zod schemas. */
  definition: ToolDefinition<any, any, string>
  execute(args: In, ctx: AssistantToolContext): Promise<Out>
  /** Human-readable one-liner for approval cards and the audit log. */
  summarize(args: In): string
  idempotencyKey?(args: In, ctx: AssistantToolContext): string
}

const searchKnowledgeOutputSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      snippet: z.string(),
    })
  ),
  note: z.string().optional(),
})

export const searchKnowledgeTool = toolDefinition({
  name: 'search_knowledge',
  description:
    'Search the workspace knowledge for content relevant to the question. The enabled sources for this turn are listed in the operating guidance. Returns only content the current viewer is allowed to see. Call this before answering and cite the returned result ids.',
  inputSchema: z.object({
    query: z.string().min(1).max(500).describe('A focused search query derived from the question.'),
    sources: z
      .array(z.enum(ASSISTANT_CITATION_TYPES))
      .min(1)
      .max(ASSISTANT_CITATION_TYPES.length)
      .optional()
      .describe(
        "Optional: restrict this search to a subset of the turn's enabled sources. Omit to search all of them. Values outside the enabled set are ignored."
      ),
  }),
  outputSchema: withGateEnvelope(searchKnowledgeOutputSchema),
})

type SearchKnowledgeArgs = InferToolInput<typeof searchKnowledgeTool>
type SearchKnowledgeOutput = z.infer<typeof searchKnowledgeOutputSchema>

/**
 * Combine the two independent NARROWING inputs to search — the copilot
 * Answer-sources picker (`ctx.sourceTypes`) and the model's per-call `sources`
 * target — into one list, or `undefined` (search everything registered) when
 * neither is set. When both are present the result is their intersection: each
 * can only remove sources, so a source survives only if both allow it.
 * `retrieveKnowledge` then intersects the survivors with the registered set,
 * so a value neither enabled nor registered is a harmless no-op.
 */
function intersectSourceTypes(
  picker: RetrievedItem['sourceType'][] | undefined,
  requested: AssistantCitationType[] | undefined
): AssistantCitationType[] | undefined {
  if (!picker && !requested) return undefined
  if (!picker) return requested
  if (!requested) return picker
  const requestedSet = new Set(requested)
  return picker.filter((type) => requestedSet.has(type))
}

async function executeSearchKnowledge(
  args: SearchKnowledgeArgs,
  ctx: AssistantToolContext
): Promise<SearchKnowledgeOutput> {
  // Server-side search budget: end the exploration deterministically rather
  // than letting reformulation loops exhaust the iteration cap.
  ctx.ledger.searchCalls += 1
  if (ctx.ledger.searchCalls > SEARCH_BUDGET_PER_TURN) {
    return {
      results: [],
      note: 'Search limit reached for this turn. Answer the customer now using only the results already retrieved; if none were relevant, say you do not know and offer to connect a human.',
    }
  }
  // Audience-scoped from day one: the citation set can never exceed what the
  // viewer could already see. retrieveKnowledge composes every registered
  // grounding source (per the turn's enabled-source snapshot) behind one call,
  // each source mapping the audience boundary (or, for summaries, the customer
  // boundary) itself. customerPrincipalId/conversationId are only consumed by
  // the summaries source; every other source ignores them. The effective
  // narrowing intersects the copilot Answer-sources picker (ctx.sourceTypes)
  // with any model-supplied `sources` target — either can only drop sources,
  // never re-enable one the snapshot left unregistered.
  const narrowing = intersectSourceTypes(ctx.sourceTypes, args.sources)
  const items = await retrieveKnowledge(args.query, ctx.audience, {
    customerPrincipalId: ctx.customerPrincipalId,
    conversationId: ctx.conversationId,
    sourceTypes: narrowing,
    enabledSources: ctx.knowledge.sources,
  })
  for (const item of items) {
    // `updatedAt` rides the ledgered citation itself (see its doc on
    // AssistantCitation): the orchestrator's persistence strip is the one
    // owner of "ephemeral vs persisted citation fields", same as `internal`.
    ctx.ledger.sources.set(
      item.id,
      item.updatedAt ? { ...item.citation, updatedAt: item.updatedAt } : item.citation
    )
  }
  return {
    results: items.map((item) => ({
      id: item.id,
      title: item.title,
      snippet: item.excerpt,
    })),
    // Retrieved excerpts are attacker-reachable text (visitor-authored posts,
    // customer-derived summaries), so a non-empty result carries the shared
    // content-not-instructions note — see RETRIEVED_CONTENT_NOTE
    // (injection-guard.ts) for why it is a trailing note rather than a fence.
    ...(items.length > 0 ? { note: RETRIEVED_CONTENT_NOTE } : {}),
  }
}

const getStatusOutputSchema = z.object({
  /** Worst-of over the viewer's visible components, or 'unavailable' when the
   *  status page cannot be shown to this viewer. */
  overall: z.string(),
  /** Where to point the person for detail: the public status page for the
   *  customer Agent, the admin status view for Copilot. Null when unavailable. */
  statusPageUrl: z.string().nullable(),
  components: z.array(z.object({ name: z.string(), status: z.string() })),
  activeIncidents: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      kind: z.string(),
      status: z.string(),
      impact: z.string(),
    })
  ),
  upcomingMaintenance: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      scheduledStartAt: z.string().nullable(),
      scheduledEndAt: z.string().nullable(),
    })
  ),
  note: z.string().optional(),
})

export const getStatusTool = toolDefinition({
  name: 'get_status',
  description:
    'Look up the current live service status: component operational states, active incidents, and scheduled maintenance. Use this for real-time "is X down / is there an outage / is maintenance planned" questions — the result is live state, never a stale indexed snapshot. Reference the statusPageUrl it returns rather than citing it as a knowledge source.',
  inputSchema: z.object({}),
  outputSchema: withGateEnvelope(getStatusOutputSchema),
})

type GetStatusOutput = z.infer<typeof getStatusOutputSchema>

/**
 * Real-time status lookup (never index-backed): the customer Agent (public
 * ceiling) sees the exact public status-page projection an anonymous visitor
 * would — segment-gated components/incidents are dropped, and if the page's
 * audience excludes anonymous visitors nothing is returned at all; Copilot
 * (team ceiling) sees every component and incident via a team service actor.
 * Best-effort: any failure (status product off, transient error) returns a
 * graceful note rather than throwing into the agentic loop.
 */
async function executeGetStatus(
  _args: InferToolInput<typeof getStatusTool>,
  ctx: AssistantToolContext
): Promise<GetStatusOutput> {
  const unavailable = (note: string): GetStatusOutput => ({
    overall: 'unavailable',
    statusPageUrl: null,
    components: [],
    activeIncidents: [],
    upcomingMaintenance: [],
    note,
  })
  try {
    const isPublic = ctx.audience === 'public'
    const [
      { getStatusPageSnapshot, isStatusAudienceGranted },
      { getStatusSettings },
      { ANONYMOUS_ACTOR },
    ] = await Promise.all([
      import('@/lib/server/domains/status'),
      import('@/lib/server/domains/settings/settings.status'),
      import('@/lib/server/policy/types'),
    ])
    const settings = await getStatusSettings()
    // Public ceiling reuses the anonymous portal actor exactly, so the tool can
    // never surface a segment-gated component the visitor could not already
    // see. Team ceiling builds a service actor whose team role short-circuits
    // segment filtering (mirrors /api/v1/status/summary's convention), giving
    // Copilot the full projection including gated components and scheduled
    // maintenance.
    const actor: Actor = isPublic
      ? ANONYMOUS_ACTOR
      : {
          principalId: ctx.assistantPrincipalId,
          role: 'member',
          principalType: 'service',
          segmentIds: new Set<SegmentId>(),
        }
    if (isPublic && !isStatusAudienceGranted(actor, settings)) {
      return unavailable('The status page is not publicly available.')
    }
    const snapshot = await getStatusPageSnapshot(actor, settings)
    const components = [
      ...snapshot.ungroupedComponents,
      ...snapshot.groups.flatMap((group) => group.components),
    ]
    return {
      overall: snapshot.topLevel.status,
      statusPageUrl: isPublic ? '/status' : '/admin/status',
      components: components.map((component) => ({
        name: component.name,
        status: component.status,
      })),
      activeIncidents: snapshot.activeIncidents.map((incident) => ({
        id: incident.id,
        title: incident.title,
        kind: incident.kind,
        status: incident.status,
        impact: incident.impact,
      })),
      upcomingMaintenance: snapshot.upcomingMaintenance.map((window) => ({
        id: window.id,
        title: window.title,
        status: window.status,
        scheduledStartAt: window.scheduledStartAt?.toISOString() ?? null,
        scheduledEndAt: window.scheduledEndAt?.toISOString() ?? null,
      })),
    }
  } catch (err) {
    log.warn({ err }, 'get_status lookup failed; returning unavailable')
    return unavailable('Live status information could not be retrieved right now.')
  }
}

const handoffToHumanOutputSchema = z.object({
  accepted: z.boolean(),
  reason: z.enum(ASSISTANT_HANDOFF_REASONS).optional(),
  note: z.string().optional(),
})

export const handoffToHumanTool = toolDefinition({
  name: 'handoff_to_human',
  description:
    'Hand the current customer conversation to a human teammate. Call this when the customer explicitly asks for a person, when safety requires human judgment, or when you have determined a teammate must take over. After it succeeds, write the customer-facing handoff message yourself in the final response.',
  inputSchema: z.object({
    reason: z
      .enum(ASSISTANT_HANDOFF_REASONS)
      .describe('The concrete reason a human teammate must take over.'),
    customerNeed: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe('What the customer needs help with, in plain language.'),
    attempted: z
      .array(z.string().trim().min(1).max(160))
      .max(5)
      .describe(
        'Useful checks or actions already attempted. May be empty for an explicit request.'
      ),
    recommendedNextStep: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe('The most useful next step for the teammate receiving the handoff.'),
  }),
  outputSchema: withGateEnvelope(handoffToHumanOutputSchema),
})

type HandoffToHumanArgs = InferToolInput<typeof handoffToHumanTool>
type HandoffToHumanOutput = z.infer<typeof handoffToHumanOutputSchema>

async function executeHandoffToHuman(
  args: HandoffToHumanArgs,
  ctx: AssistantToolContext
): Promise<HandoffToHumanOutput> {
  if (!ctx.conversationId && !ctx.simulate) return { accepted: false, note: NO_CONVERSATION_NOTE }
  ctx.ledger.handoffRequest = {
    reason: args.reason,
    customerNeed: args.customerNeed,
    attempted: args.attempted,
    recommendedNextStep: args.recommendedNextStep,
  }
  return { accepted: true, reason: args.reason }
}

const reportInabilityOutputSchema = z.object({
  accepted: z.boolean(),
  reason: z.enum(ASSISTANT_INABILITY_REASONS),
})

export const reportInabilityTool = toolDefinition({
  name: 'report_inability',
  description:
    'Record that you cannot complete the customer request with the tools and context available in this turn. Call this after searches return no relevant sources, a required tool is unavailable, or essential context is missing. After it succeeds, write the honest customer-facing explanation yourself in the final response.',
  inputSchema: z.object({
    reason: z
      .enum(ASSISTANT_INABILITY_REASONS)
      .describe('Why the request cannot be completed in this turn.'),
  }),
  outputSchema: withGateEnvelope(reportInabilityOutputSchema),
})

type ReportInabilityArgs = InferToolInput<typeof reportInabilityTool>

async function executeReportInability(
  args: ReportInabilityArgs,
  ctx: AssistantToolContext
): Promise<{ accepted: true; reason: AssistantInabilityReason }> {
  ctx.ledger.inabilityReport = { reason: args.reason }
  return { accepted: true, reason: args.reason }
}

const setAttributeOutputSchema = z.object({
  applied: z.boolean(),
  note: z.string().optional(),
})

export const setAttributeTool = toolDefinition({
  name: 'set_attribute',
  description:
    'Record a structured fact about this conversation as a named attribute, such as a category, plan tier, or affected feature the customer mentioned. Use this to capture facts for reporting, not to reply to the customer. Never use it to change the conversation status; use end_conversation for that. If a teammate or another source already set this attribute, the write is silently skipped so it never overrides a human choice.',
  inputSchema: z.object({
    key: z
      .string()
      .min(1)
      .max(100)
      .describe('The attribute definition key, exactly as configured in this workspace.'),
    value: z
      .union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])
      .describe(
        'The value to store. Use an array of option ids for a multi_select attribute, null to clear the attribute, otherwise the single value.'
      ),
  }),
  outputSchema: withGateEnvelope(setAttributeOutputSchema),
})

const endConversationOutputSchema = z.object({
  closed: z.boolean(),
  note: z.string().optional(),
})

export const endConversationTool = toolDefinition({
  name: 'end_conversation',
  description:
    'Close the current conversation. Only call this once the customer has confirmed the issue is resolved or has clearly said they are done and need nothing else. Do not close a conversation the customer has not confirmed is finished, even if the answer given seems to solve it.',
  inputSchema: z.object({
    reason: z
      .string()
      .max(200)
      .optional()
      .describe('A short note on why the conversation is being closed.'),
  }),
  outputSchema: withGateEnvelope(endConversationOutputSchema),
})

const createTicketOutputSchema = z.object({
  created: z.boolean(),
  ticketId: z.string().optional(),
  reference: z.string().optional(),
  title: z.string().optional(),
  note: z.string().optional(),
})

export const createTicketTool = toolDefinition({
  name: 'create_ticket',
  description:
    'Open a support ticket to track work that needs a teammate beyond this conversation, such as a bug report or an account problem to investigate. Use customer when the customer is waiting on the outcome, back_office for internal-only work with no customer thread, and tracker for a linked follow-up item. Do not use this for feature requests or product feedback; use capture_feedback for those.',
  inputSchema: z.object({
    type: z.enum(TICKET_TYPES).describe('The kind of ticket to open.'),
    title: z.string().min(1).max(300).describe('A short, specific summary of the issue.'),
    description: z
      .string()
      .max(10000)
      .optional()
      .describe('Additional detail from the conversation to seed the ticket.'),
    priority: z.enum(CONVERSATION_PRIORITIES).optional().describe('How urgent the ticket is.'),
  }),
  outputSchema: withGateEnvelope(createTicketOutputSchema),
})

const captureFeedbackOutputSchema = z.object({
  created: z.boolean(),
  postId: z.string().optional(),
  note: z.string().optional(),
})

export const captureFeedbackTool = toolDefinition({
  name: 'capture_feedback',
  description:
    "Turn a feature request or product suggestion from this conversation into a public feedback post attributed to the customer, so it joins the roadmap the team tracks. Use this for ideas and suggestions, not for problems that need a fix; use create_ticket for those. This posts publicly under the customer's identity, so only use it to capture a request the customer actually made.",
  inputSchema: z.object({
    boardId: z.string().min(1).describe('The board TypeID to post the feedback to.'),
    title: z.string().min(1).max(200).describe('A short, specific title for the feedback post.'),
    content: z.string().max(2000).optional().describe('Additional detail from the conversation.'),
  }),
  outputSchema: withGateEnvelope(captureFeedbackOutputSchema),
})

/**
 * The sentinel note every conversation-only write tool returns when
 * `ctx.conversationId` is null (no linked conversation to act on — the
 * sandbox, or, absent the `parents` gate above, a ticket-scoped turn).
 * Exported so `isNoParentResult` (below) and `assistant.tools.ts`'s
 * approval-execution path can recognize this specific no-op by more than a
 * duplicated string literal.
 */
export const NO_CONVERSATION_NOTE = 'No linked conversation.'

/**
 * Whether a tool's result reports the no-parent no-op (see
 * `NO_CONVERSATION_NOTE`): a defense-in-depth check, independent of the
 * `parents` catalogue gate above, for `executeApprovedPendingAction`
 * (assistant.tools.ts) — a pending action approved for a tool that (for any
 * reason, past or future) finds no parent to act on must settle as `failed`,
 * never `executed`. Checked structurally against the shared sentinel rather
 * than the caller re-matching the note text itself.
 */
export function isNoParentResult(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    'note' in result &&
    (result as { note?: unknown }).note === NO_CONVERSATION_NOTE
  )
}

/**
 * One-row conversation snapshot for the write executors. One shared shape
 * (status + visitor principal) keeps the per-tool selects from multiplying as
 * the catalogue grows; a PK read of two columns costs the same as one.
 */
async function getConversationSnapshot(
  ctx: AssistantToolContext,
  conversationId: ConversationId
): Promise<{ status: string; visitorPrincipalId: PrincipalId } | null> {
  const [row] = await ctx.db
    .select({
      status: conversations.status,
      visitorPrincipalId: conversations.visitorPrincipalId,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  return row ?? null
}

type SetAttributeArgs = InferToolInput<typeof setAttributeTool>
type SetAttributeOutput = z.infer<typeof setAttributeOutputSchema>

/**
 * Whether the stored value matches what this call asked to write. Arrays
 * (multi_select) compare order-insensitively — the writer dedupes but does
 * not otherwise reorder, and the model has no reason to reproduce the exact
 * stored order for the comparison to mean "this call's write landed".
 */
function valueLanded(stored: unknown, requested: SetAttributeArgs['value']): boolean {
  if (Array.isArray(requested)) {
    if (!Array.isArray(stored)) return false
    if (stored.length !== requested.length) return false
    const sortedStored = [...stored].sort()
    const sortedRequested = [...requested].sort()
    return sortedStored.every((v, i) => v === sortedRequested[i])
  }
  return stored === requested
}

async function executeSetAttribute(
  args: SetAttributeArgs,
  ctx: AssistantToolContext
): Promise<SetAttributeOutput> {
  const conversationId = ctx.conversationId
  if (!conversationId) {
    return { applied: false, note: NO_CONVERSATION_NOTE }
  }
  const attributes = await setConversationAttribute({ conversationId }, args.key, args.value, 'ai')
  // The service is a silent no-op when the slot is already filled by another
  // source (the AI-precedence rule) — compare the stored value against ours
  // to tell the caller whether the write actually landed.
  const applied =
    args.value === null
      ? attributes[args.key] === undefined
      : valueLanded(readAttributeValue(attributes[args.key])?.v, args.value)
  return applied
    ? { applied: true }
    : { applied: false, note: 'Attribute already set by another source.' }
}

type EndConversationArgs = InferToolInput<typeof endConversationTool>
type EndConversationOutput = z.infer<typeof endConversationOutputSchema>

async function executeEndConversation(
  _args: EndConversationArgs,
  ctx: AssistantToolContext
): Promise<EndConversationOutput> {
  const conversationId = ctx.conversationId
  if (!conversationId) {
    return { closed: false, note: NO_CONVERSATION_NOTE }
  }
  const row = await getConversationSnapshot(ctx, conversationId)
  // setConversationStatus does not throw on a closed -> closed transition, it
  // just re-applies the same status with no transcript notice or webhook —
  // checking first avoids that pointless write and reports it plainly.
  if (row?.status === 'closed') {
    return { closed: true, note: 'Conversation was already closed.' }
  }
  await setConversationStatus(conversationId, 'closed', ctx.actor)
  // AI attribute classification (AI-ATTRIBUTES-PARITY-SPEC.md Phase 1): one
  // of the "job done" moments. Flag-gated and non-blocking inside the
  // service itself; the extra catch here is defense in depth so a
  // classification failure can never turn a successful close into a failed
  // tool call.
  try {
    await classifyConversationAttributes(conversationId, { trigger: 'assistant_closed' })
  } catch (err) {
    log.warn({ err, conversationId }, 'post-close attribute classification failed')
  }
  return { closed: true }
}

type CreateTicketArgs = InferToolInput<typeof createTicketTool>
type CreateTicketOutput = z.infer<typeof createTicketOutputSchema>

async function executeCreateTicket(
  args: CreateTicketArgs,
  ctx: AssistantToolContext
): Promise<CreateTicketOutput> {
  const conversationId = ctx.conversationId
  if (!conversationId) {
    return { created: false, note: NO_CONVERSATION_NOTE }
  }
  const row = await getConversationSnapshot(ctx, conversationId)
  if (!row) {
    return { created: false, note: NO_CONVERSATION_NOTE }
  }
  const ticket = await createTicket(
    {
      type: args.type,
      title: args.title,
      description: args.description,
      priority: args.priority,
      requesterPrincipalId: row.visitorPrincipalId,
    },
    ctx.actor
  )
  return { created: true, ticketId: ticket.id, reference: ticket.reference, title: ticket.title }
}

type CaptureFeedbackArgs = InferToolInput<typeof captureFeedbackTool>
type CaptureFeedbackOutput = z.infer<typeof captureFeedbackOutputSchema>

async function executeCaptureFeedback(
  args: CaptureFeedbackArgs,
  ctx: AssistantToolContext
): Promise<CaptureFeedbackOutput> {
  const conversationId = ctx.conversationId
  if (!conversationId) {
    return { created: false, note: NO_CONVERSATION_NOTE }
  }
  // The model sends the board id as a free string (inputSchema is z.string()),
  // so validate the TypeID format before handing it to the service rather than
  // casting an unchecked string into a branded BoardId. A malformed id fails
  // gracefully with the tool's own note instead of surfacing a service throw.
  if (!isTypeId(args.boardId, 'board')) {
    return { created: false, note: 'Unknown or invalid board id.' }
  }
  const result = await createPostFromConversation(
    {
      conversationId,
      boardId: args.boardId,
      title: args.title,
      content: args.content,
    },
    {
      agentActor: ctx.actor,
      agentPrincipalId: ctx.assistantPrincipalId,
      agent: { principalId: ctx.assistantPrincipalId, displayName: ctx.assistantName },
    }
  )
  return { created: result.created, postId: result.postId }
}

/**
 * Build a catalogue entry from a tool definition plus its admin metadata.
 * `name` derives from the definition so the model-facing id and the registry
 * id can never drift, and the erasure to the registry's unknown-typed shape
 * lives here, in exactly one place, instead of a cast per entry.
 *
 * Generic over the concrete `definition` (`TDef`), so the compiler ties
 * `execute`/`summarize`/`idempotencyKey` straight to that definition's OWN
 * schemas: `args` is the definition's inferred input (`InferToolInput<TDef>`)
 * and `execute`'s return is the definition's success output
 * (`ToolSuccessOutput<TDef>` — the outputSchema minus the gate envelopes the
 * pipeline adds later). A tool whose execute reads a field the input schema
 * doesn't declare, or returns a shape the output schema doesn't admit, no
 * longer compiles — no per-tool `<In, Out>` to hand-align. The single erasure
 * to the heterogeneous registry type (`AssistantToolSpec` with unknown args)
 * stays here at the return, so the registry can still hold every tool in one
 * `Record` while each entry was checked against its real schemas above.
 */
function defineToolSpec<TDef extends ToolDefinition<any, any, string>>(spec: {
  label: string
  description: string
  promptGuidance: string
  risk: ToolRiskClass
  permissions: readonly PermissionKey[]
  /** Defaults to `['conversation']` — every write tool defined below predates
   *  ticket-scoped turns; see the field's doc on `AssistantToolSpec`. */
  parents?: readonly ('conversation' | 'ticket')[]
  availableWhen?: (ctx: AssistantToolContext) => boolean
  definition: TDef
  execute: (
    args: InferToolInput<TDef>,
    ctx: AssistantToolContext
  ) => Promise<ToolSuccessOutput<TDef>>
  summarize: (args: InferToolInput<TDef>) => string
  idempotencyKey?: (args: InferToolInput<TDef>, ctx: AssistantToolContext) => string
}): AssistantToolSpec {
  return {
    name: spec.definition.name,
    parents: spec.parents ?? ['conversation'],
    ...spec,
  } as AssistantToolSpec
}

const SPECS: readonly AssistantToolSpec[] = [
  defineToolSpec({
    label: 'Search knowledge',
    description: 'Search the published help center for articles the current viewer can see.',
    promptGuidance:
      'Call before answering anything factual or product-related; refine the query once more if the first search misses, then answer with what you have. Cite only the article ids it returns.',
    risk: 'read',
    // Knowledge base reads are already scoped by viewer audience; there is no
    // separate conversation- or ticket-shaped permission to check here.
    permissions: [],
    // Unlike the write tools below, this never keys off ctx.conversationId
    // for its own logic (only the optional past-conversation-summaries
    // source does, and that source already degrades to no results with no
    // conversation — see AssistantToolContext's own doc), so it belongs on
    // both a conversation-scoped and a ticket-scoped turn.
    parents: ['conversation', 'ticket'],
    // Registered iff the resolved agent enabled ≥1 retrieval source this turn
    // (D7): an agent with every knowledge source off has no search tool at all.
    availableWhen: (ctx) => ctx.knowledge.sources.size > 0,
    definition: searchKnowledgeTool,
    execute: executeSearchKnowledge,
    summarize: (args) => `Search knowledge for "${args.query}"`,
  }),
  defineToolSpec({
    label: 'Get status',
    description:
      'Look up live service status — component states, active incidents, and scheduled maintenance — from the status page.',
    promptGuidance:
      'Call for a real-time service-status, outage, or planned-maintenance question. It returns live state, not an indexed snapshot; reference the statusPageUrl it returns instead of a citation.',
    risk: 'read',
    // Status reads are audience-scoped inside the tool (public vs team actor);
    // no separate conversation/ticket permission applies.
    permissions: [],
    // Never keys off the conversation/ticket — belongs on both parents.
    parents: ['conversation', 'ticket'],
    // Registered only when the resolved agent enabled the `status` knowledge
    // source for this turn (config v3).
    availableWhen: (ctx) => ctx.knowledge.status,
    definition: getStatusTool,
    execute: executeGetStatus,
    summarize: () => 'Look up service status',
  }),
  defineToolSpec({
    label: 'Handoff to human',
    description: 'Route the current customer conversation to a human teammate.',
    promptGuidance:
      'Call when a human must take over, especially after an explicit request, for safety, or when the issue cannot be handled autonomously. After the tool result, write the handoff reply yourself.',
    risk: 'control',
    permissions: [],
    definition: handoffToHumanTool,
    execute: executeHandoffToHuman,
    summarize: (args) => `Handoff to a human: ${args.reason}`,
    // The customer-facing widget is the public-audience turn with a real
    // conversation. Never expose an operational handoff in sandbox/copilot.
    availableWhen: (ctx) => ctx.audience === 'public' && ctx.conversationId !== null,
  }),
  defineToolSpec({
    label: 'Report inability',
    description: "Record that the current request cannot be completed with this turn's tools.",
    promptGuidance:
      'Call only after you determine the request cannot be completed with the available tools or context. Then write the honest explanation yourself; this tool never supplies customer-facing wording.',
    risk: 'control',
    permissions: [],
    parents: ['conversation', 'ticket'],
    definition: reportInabilityTool,
    execute: executeReportInability,
    summarize: (args) => `Unable to complete request: ${args.reason}`,
  }),
  defineToolSpec({
    label: 'Set attribute',
    description:
      'Record a structured fact on the conversation (category, plan tier, etc.) learned from what the customer said.',
    promptGuidance:
      'Use to record a fact you learned for reporting only; never to reply to the customer or to change conversation status.',
    risk: 'write',
    permissions: [PERMISSIONS.CONVERSATION_SET_ATTRIBUTES],
    definition: setAttributeTool,
    execute: executeSetAttribute,
    summarize: (args) => `Set attribute "${args.key}"`,
    // No idempotencyKey override: the value is part of what makes a retry
    // distinct (a reformulated value must not dedupe against an earlier one),
    // and the default {conversationId}:{messageId}:{toolName}:{sha256(args)}
    // key already hashes the full args, key and value alike.
  }),
  defineToolSpec({
    label: 'End conversation',
    description: 'Close the conversation once the customer has confirmed their issue is resolved.',
    promptGuidance:
      'Only call once the customer has clearly confirmed the issue is resolved or said they need nothing else; never close on your own judgement that the answer seems to solve it.',
    risk: 'write',
    permissions: [PERMISSIONS.CONVERSATION_SET_STATUS],
    definition: endConversationTool,
    execute: executeEndConversation,
    summarize: () => 'Close the conversation',
  }),
  defineToolSpec({
    label: 'Create ticket',
    description:
      'Open a support ticket to track work that needs a teammate beyond this conversation.',
    promptGuidance:
      'Use for a bug or an account problem that needs a teammate to investigate beyond this conversation, not for a feature request.',
    risk: 'write',
    permissions: [PERMISSIONS.TICKET_CREATE],
    definition: createTicketTool,
    execute: executeCreateTicket,
    summarize: (args) => `Create a ${args.type} ticket: "${args.title}"`,
  }),
  defineToolSpec({
    label: 'Capture feedback',
    description:
      'Create a public feedback post from the conversation, attributed to the customer, for the team roadmap.',
    promptGuidance:
      'Use for a feature request or suggestion the customer raises, not for a problem that needs a fix.',
    risk: 'write',
    permissions: [PERMISSIONS.POST_CREATE, PERMISSIONS.POST_VOTE_ON_BEHALF],
    definition: captureFeedbackTool,
    execute: executeCaptureFeedback,
    summarize: (args) => `Capture feedback: "${args.title}"`,
  }),
]

/**
 * Static registry of Quinn's built-in tools, keyed by name: the read tools
 * plus the write tools that act on the conversation, a ticket, or a feedback
 * post.
 */
export const ASSISTANT_TOOL_SPECS: Record<string, AssistantToolSpec> = Object.fromEntries(
  SPECS.map((s) => [s.name, s])
)

/**
 * Return Quinn's built-in tool catalogue. The registry is code-defined and
 * never reads workspace data.
 */
export function resolveToolSpecs(): AssistantToolSpec[] {
  return Object.values(ASSISTANT_TOOL_SPECS)
}

/** Look up a built-in tool by the name persisted on a pending action. */
export function getToolSpecByName(name: string): AssistantToolSpec | null {
  return ASSISTANT_TOOL_SPECS[name] ?? null
}
