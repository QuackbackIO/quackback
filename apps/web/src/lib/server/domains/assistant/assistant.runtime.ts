/**
 * Quinn runtime seam.
 *
 * The TanStack AI server-core agentic loop lives behind this one interface so
 * the framework's blast radius stays in a single file (the fallback to another
 * SDK is a swap, not a rewrite). The next wave's messenger wiring calls
 * `runAssistantTurn` and persists the result as ordinary conversation messages;
 * the admin sandbox calls it against live config without touching the inbox.
 *
 * The behavior contract (silence rule, structured citations, tool-led actions,
 * scope honesty) is encoded around that loop. The model produces response
 * content; operational decisions such as handoff and inability are tools.
 */
import { parsePartialJSON, maxIterations, type StreamChunk } from '@tanstack/ai'
import { z } from 'zod'
import { config } from '@/lib/server/config'
import { db, conversations, principal, eq } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import { isAiClientConfigured, stripCodeFences } from '@/lib/server/domains/ai/config'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { createAssistantTracingMiddleware } from '@/lib/server/domains/ai/tracing-middleware'
import type { AiAnswerKind } from '@/lib/server/domains/ai/usage-log'
import { getAssistantRuntimeConfig } from '@/lib/server/domains/settings/settings.assistant'
import { logger } from '@/lib/server/logger'
import type { AssistantHandoffReason } from '@/lib/server/db'
import type { PrincipalId, ConversationId, TicketId, AssistantInvolvementId } from '@quackback/ids'
import type { AssistantSurface } from '@/lib/shared/assistant/surfaces'
import {
  DEFAULT_ASSISTANT_CONFIG,
  roleToAgent,
  type AssistantConfig,
  type AssistantIdentity,
  type AssistantRole,
  type AssistantTone,
  type AssistantResponseLength,
} from '@/lib/shared/assistant/config'
import { applyGuidanceBudget } from '@/lib/shared/assistant/guidance'
import type { AssistantActivityStatus } from '@/lib/shared/conversation/types'
import { resolveContentAudience } from './audience'
import { assembleAssistantToolset } from './assistant.tools'
import { makeAssistantToolContext, makeAssistantToolLedger } from './assistant.toolspec'
import { listConversationAttributes } from '@/lib/server/domains/conversation-attributes/conversation-attribute.service'
import type {
  AssistantCitation,
  AssistantInabilityReason,
  AssistantProposedAction,
  AssistantToolContext,
  AssistantToolOutcome,
  AssistantToolSpec,
} from './assistant.toolspec'
import { listActionSpecsForAgent } from './custom-actions.service'
import { resolveAssistantKnowledgeSnapshot, type RetrievedItem } from './retrieval-sources'
import { listEnabledGuidanceCandidates, type AssistantGuidanceRule } from './guidance.service'
import { selectApplicableGuidance, splitGuidanceCandidates } from './guidance-selector'
import {
  ASSISTANT_PROMPT_VERSION,
  buildAssistantSystemMessages,
  resolveAssistantRolePolicy,
  type AssistantBoardCatalogueEntry,
} from './assistant.system-prompt'
import { listBoards } from '@/lib/server/domains/boards/board.service'
import { runSynthesis, safeJsonRepair, type AttemptOutcome } from './synthesis-core'
import {
  evaluateZeroToolCompletion,
  type ZeroToolCompletionEvaluation,
} from './assistant.completion-evaluator'
import { wrapUntrustedText } from './injection-guard'
// Read-only reach into the tickets domain (an existing edge — assistant.toolspec.ts's
// create_ticket tool already imports from it) for the ticket copilot's grounding
// facts and thread. Never edited as part of this task: the tickets domain's own
// files are owned by a concurrent unified-inbox workstream.
import { getTicket } from '@/lib/server/domains/tickets/ticket.service'
import { listTicketMessages } from '@/lib/server/domains/tickets/ticket-message.service'
import { loadConversationThread } from './assistant.thread'
import { buildTicketTranscript, buildConversationTranscript, budgetTranscript } from './transcript'
import {
  createChunkQueue,
  createPairingTracker,
  runErrorChunk,
  runFinishedChunk,
  runStartedChunk,
  stepFinishedChunk,
  stepStartedChunk,
  type WireRunIds,
} from './agui'

const log = logger.child({ component: 'assistant-runtime' })

/** The structured reason Quinn escalates — it decides THAT, never WHERE. */
export type EscalationReason = AssistantHandoffReason

/** Who authored a thread turn. Human teammate replies are distinct from Quinn's own. */
export type AssistantThreadSender = 'customer' | 'assistant' | 'human_agent'

/** A turn in the assistant thread. */
export interface AssistantThreadMessage {
  sender: AssistantThreadSender
  content: string
}

/** A handoff Quinn requested by calling handoff_to_human. */
export interface EscalationOutcome {
  reason: EscalationReason
  mode: 'handoff'
  customerNeed: string
  attempted: string[]
  recommendedNextStep: string
}

export interface AssistantTurnTrace {
  promptVersion: typeof ASSISTANT_PROMPT_VERSION
  configRevision: number
  role: AssistantRole
  tone?: AssistantTone
  responseLength?: AssistantResponseLength
  appliedGuidance: Array<{ id: string; name: string }>
  toolCalls: AssistantToolOutcome[]
  configFallbackReason?: string
}

export interface AssistantRuntimeConfig {
  config: AssistantConfig
  revision: number
  workspaceName: string
  actionsEnabled: boolean
  /** `assistantCustomActions` flag: gates dynamic custom-action registration (Phase 5). */
  customActionsEnabled: boolean
  configFallbackReason?: string
}

/**
 * Whether an answered turn's `text` reads as a customer-facing reply draft or
 * as internal analysis/guidance for the teammate. Only ever consumed on the
 * copilot surface (the widget always sends its text to the customer), where it
 * decides whether the sidebar offers "Add to composer" as the primary action
 * (draft_reply) or renders the answer as read-only text (analysis).
 * Defaults to `draft_reply` wherever the model doesn't classify (see the final
 * return), so it is strictly additive to existing behaviour.
 */
export type AssistantAnswerType = 'draft_reply' | 'analysis'

/** Why Quinn completed a turn without claiming it had answered the question. */
export type AssistantCannotAnswerReason = AssistantInabilityReason

/** Fields shared by every customer-visible terminal outcome. */
interface AssistantDeliveredFields {
  text: string
  /** Reply-draft vs analysis intent for this turn's `text` (copilot surface
   *  only); `draft_reply` whenever the model didn't classify. */
  answerType: AssistantAnswerType
  citations: AssistantCitation[]
  /** Whether any surviving citation is internal (`citations.some(c => c.internal)`), the
   *  server-derived flag the copilot leak gate reads. A customer-facing turn CAN carry
   *  it — the past-conversation-summaries source flags every citation internal
   *  regardless of ceiling — which is why the orchestrator strips `internal` before
   *  persisting a widget turn's citations (see assistant.orchestrator.ts); the flag
   *  stays ledger-only on every surface. */
  internalSourced: boolean
  /**
   * Write-tool calls this turn turned into pending-approval rows (P2-C.4),
   * lifted verbatim off `toolContext.ledger.proposedActions`: unlike citations
   * these are never model-curated, so every proposal this run made is
   * reported. Empty outside `writeToolPolicy: 'propose'` (or any other
   * caller that never resolves a write tool to 'approval').
   */
  proposedActions: AssistantProposedAction[]
  identity: AssistantIdentity
  trace: AssistantTurnTrace
  escalation?: EscalationOutcome
}

/**
 * What one turn produces. `cannot_answer` is derived only from Quinn calling
 * the report_inability tool; `suppressed` means the silence rule muted Quinn.
 */
export type AssistantTurnResult =
  | ({ status: 'answered' } & AssistantDeliveredFields)
  | ({
      status: 'cannot_answer'
      cannotAnswerReason: AssistantCannotAnswerReason
    } & AssistantDeliveredFields)
  | { status: 'suppressed'; reason: 'silence' }

/**
 * A step surfaced while Quinn works, for a live "thinking / searching" trace in
 * the widget. `thinking` is the default working state; `tool` names the tool the
 * agentic loop just invoked, any name present in this turn's assembled tool set
 * (the registry, not a hardcoded list, decides what's valid).
 */
export type AssistantActivity = { kind: 'thinking' } | { kind: 'tool'; tool: string }

/** Map a turn's activity step to the widget's status vocabulary: 'thinking' is
 *  the default working state; any tool call reads as a knowledge search or (for
 *  every other tool) reviewing the conversation. Shared by the widget's
 *  publishActivity (assistant.orchestrator.ts) and the copilot route's status
 *  line — both render the exact same three states from the same steps. */
export function activityToStatus(activity: AssistantActivity): AssistantActivityStatus {
  if (activity.kind === 'thinking') return 'thinking'
  return activity.tool === 'search' ? 'searching_kb' : 'reviewing_conversation'
}

interface AssistantTurnCommonInput {
  /** Quinn's service principal (authors replies next wave). */
  assistantPrincipalId: PrincipalId
  /** The linked conversation, or null (sandbox, which also implies simulate mode for write tools). */
  conversationId?: ConversationId | null
  /**
   * The linked ticket (unified inbox §2.9, Copilot only) — mutually exclusive
   * with `conversationId` in practice (a turn grounds on exactly one item; the
   * copilot route only ever sets one of the two). Grounds the turn on the
   * ticket's title/status/stage/requester plus its thread (see
   * `buildTicketContextPrompt`), deliberately WITHOUT the customer-history
   * grounding a real `conversationId` gets (no `customerPrincipalId` is ever
   * derived for a ticket-scoped turn, so the past-conversation-summaries
   * source returns nothing for it — see its own module doc on why a missing
   * scope must never fall back to unscoped).
   */
  ticketId?: TicketId | null
  /** The active involvement, for audit rows and pending actions. Null before the first involvement opens, or in the sandbox. */
  involvementId?: AssistantInvolvementId | null
  /** The customer message this turn answers, keying the write-tool idempotency key. Null in the sandbox. */
  latestCustomerMessageId?: string | null
  /** Actual latest role request when the role owns a synthetic model message. */
  latestRequestForGuidance?: string
  /**
   * Per-request NARROWING filter over search's grounding sources
   * (the copilot Answer-sources picker); undefined consults every source the
   * workspace's flags already registered. See `retrieveKnowledge`.
   */
  sourceTypes?: RetrievedItem['sourceType'][]
  /**
   * Phase C conversational block layer (slice C-6): a one-time instruction
   * from the `let_assistant_answer` workflow step that invoked this turn,
   * folded into the system prompt for just this turn (see
   * buildStepInstructionsPrompt) — not persisted config, so it has nothing to
   * do with assistantConfig below. Undefined/null for every non-workflow
   * caller.
   */
  stepInstructions?: string | null
  /**
   * Force write tools to report what they would do instead of running, even
   * with a real `conversationId` (which otherwise implies a live run; see
   * `makeAssistantToolContext`). Undefined preserves the existing
   * conversationId-derived default for every caller. Used by Test agent; live
   * role policy is selected exclusively by the discriminated role below.
   */
  simulate?: boolean
  /**
   * The teammate who asked this turn's question — Copilot only.
   * `assistantPrincipalId` always identifies Quinn itself, never the human on
   * the other end, so per-teammate usage reporting (analytics/copilot-usage.ts)
   * needs a separate field to attribute a turn to its asker. Rides the
   * usage-log metadata as `principalId` when set; undefined for every other
   * surface (a widget turn's asker is the customer in the conversation, not a
   * teammate), so the metadata carries no `principalId` key in that case.
   */
  actorPrincipalId?: PrincipalId | null
  /** Tenant db handle for the tools; defaults to the app db. */
  db?: Executor
  /** Aborts the in-flight provider call. */
  signal?: AbortSignal
  /** Streams clean answer-text fragments as they arrive. */
  onTextDelta?: (delta: string) => void
  /** Surfaces agentic steps (tool calls) as they happen, for a live status trace. */
  onActivity?: (activity: AssistantActivity) => void
  /**
   * AG-UI wire forwarding (see synthesis-core's option of the same name):
   * receives the turn's committed model-stream chunks for a route serving the
   * AG-UI protocol. Internal seam — routes reach it via `streamAssistantTurn`,
   * which owns the canonical run lifecycle around these chunks; direct callers
   * (orchestrator, evals) leave it unset and are byte-for-byte unchanged.
   */
  wireSink?: (chunk: StreamChunk) => void
}

/**
 * The trust boundary is a discriminated input contract. A caller cannot select
 * a customer role with the team surface, or silently fall through from omitted
 * Copilot intent to a different permission profile.
 */
export type AssistantTurnInput = AssistantTurnCommonInput &
  (
    | {
        role: 'customer_support'
        surface: Exclude<AssistantSurface, 'copilot'>
        messages: AssistantThreadMessage[]
      }
    | {
        role: 'copilot_qa'
        surface: 'copilot'
        messages: AssistantThreadMessage[]
      }
  )

export class AssistantNotConfiguredError extends Error {
  constructor() {
    super('The assistant is not configured: an AI client and chat model are required')
    this.name = 'AssistantNotConfiguredError'
  }
}

/** Whether Quinn can run: AI client plus an effective chat model. */
export function isAssistantConfigured(): boolean {
  return (
    isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) &&
    getChatModel('assistant') !== null
  )
}

/**
 * Cap on the agentic loop. Sized for the worst legitimate exploration — a
 * search, a refined search, a write-tool call, and the final answer, with
 * headroom — because exhausting it mid-exploration yields no answer at all
 * (observed as intermittent failed runs at 4 when a model split its tool
 * calls across rounds). The prompt separately caps searches at two, so the
 * budget bounds cost without being the thing that cuts an answer short.
 */
export const ASSISTANT_MAX_ITERATIONS = 6

const citationInputSchema = z.object({
  type: z.enum(['article', 'post', 'snippet', 'summary']),
  id: z.string(),
})

const assistantOutputSchema = z.object({
  text: z.string(),
  citations: z.array(citationInputSchema),
  // Copilot-only intent tag (see buildCopilotFramingPrompt). Optional: the
  // widget's base prompt never asks for it, weak models may drop it, and the
  // salvage paths only recover `text` — so every omission falls back to
  // `draft_reply` at the return sites rather than failing validation.
  answerType: z.enum(['draft_reply', 'analysis']).optional(),
})

type AssistantOutput = z.infer<typeof assistantOutputSchema>

export type AssistantCompletionIssueCode =
  | 'non_conformant_output'
  | 'empty_terminal_reply'
  | 'inability_with_citations'
  | 'empty_search_without_resolution_tool'
  | 'uncited_retrieved_answer'
  | 'fabricated_citation'
  | 'incomplete_zero_tool_response'
  | 'zero_tool_evaluation_failed'

export class AssistantCompletionError extends Error {
  readonly name = 'AssistantCompletionError'

  constructor(readonly code: AssistantCompletionIssueCode) {
    super(`assistant completion rejected: ${code}`)
  }
}

export interface AssistantCompletionTrace {
  searchCalls: number
  sources: ReadonlyMap<string, AssistantCitation>
  toolCalls: readonly string[]
  inabilityReported: boolean
  handoffRequested: boolean
  /** Whether admin-authored guidance was injected this turn. Guidance facts
   *  (policies, guarantees) are legitimate grounding, so an answered turn
   *  whose searches all came back empty is not automatically a fabrication. */
  hasAdminGuidance: boolean
}

/**
 * Enforce Quinn's terminal-outcome protocol after the model-controlled tool
 * loop. Tool choice remains agentic; only the claim that work is complete is
 * checked against the request-local tool ledger.
 */
export function validateAssistantCompletion(
  final: unknown,
  trace: AssistantCompletionTrace
): asserts final is AssistantOutput {
  const parsedResult = assistantOutputSchema.safeParse(final)
  if (!parsedResult.success) throw new AssistantCompletionError('non_conformant_output')
  const output = parsedResult.data

  const text = output.text.trim()
  if (text.length === 0) throw new AssistantCompletionError('empty_terminal_reply')

  const groundedCitations = output.citations.filter((citation) => trace.sources.has(citation.id))
  if (groundedCitations.length !== output.citations.length) {
    throw new AssistantCompletionError('fabricated_citation')
  }

  if (trace.inabilityReported) {
    if (output.citations.length > 0) {
      throw new AssistantCompletionError('inability_with_citations')
    }
    return
  }

  // A different tool result may itself be the complete basis for the final
  // response (for example a handoff or ticket creation after an empty search).
  // Admin guidance also legitimately grounds an answer no search could find
  // (e.g. a money-back guarantee stated only in a guidance rule), so its
  // presence exempts the turn from the empty-search rejection — the
  // fabricated-citation gate above still applies unconditionally.
  const hasAlternativeToolResult = trace.toolCalls.some((name) => name !== 'search')
  if (
    trace.searchCalls > 0 &&
    trace.sources.size === 0 &&
    !trace.handoffRequested &&
    !hasAlternativeToolResult &&
    !trace.hasAdminGuidance
  ) {
    throw new AssistantCompletionError('empty_search_without_resolution_tool')
  }
  // get_status legitimately resolves an EMPTY search (live state, no
  // retrieval), but it must not excuse paraphrasing retrieved sources
  // without citing them — only a write/control tool result can do that.
  const hasNonReadResolutionTool = trace.toolCalls.some(
    (name) => name !== 'search' && name !== 'get_status'
  )
  if (
    trace.searchCalls > 0 &&
    trace.sources.size > 0 &&
    groundedCitations.length === 0 &&
    !trace.handoffRequested &&
    !hasNonReadResolutionTool
  ) {
    throw new AssistantCompletionError('uncited_retrieved_answer')
  }
}

/** Feedback added only after a semantic completion failure. */
export const ASSISTANT_COMPLETION_REPAIR_PROMPT =
  'Your previous final response was not a complete resolution of the latest request. Reconsider the request and continue the agentic cycle. You may make zero or more tool calls: use none only when you can already give a useful response or must ask one necessary clarification. When a tool can perform a needed lookup, check, action, or handoff, call it now and inspect its result instead of promising future work. The final JSON is response content, not an action channel.'

/**
 * Extract the first balanced `{...}` object from a string, respecting quoted
 * strings and escapes. Peels a JSON envelope out of any prose the model wrapped
 * around it (a common weak-model failure: a chatty preamble, then the JSON).
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

/** Parse a candidate as-is, then via a syntax repair pass; validate both. */
function parseOrRepair(candidate: string): AssistantOutput | null {
  for (const text of [candidate, safeJsonRepair(candidate)]) {
    if (text === null) continue
    try {
      return assistantOutputSchema.parse(JSON.parse(text))
    } catch {
      // try the next, looser candidate
    }
  }
  return null
}

/**
 * Recover the structured answer from raw model output when strict decoding
 * didn't hold. Providers that accept `response_format: json_schema` without
 * truly enforcing it let a weak model fence the JSON, prefix it with prose,
 * emit prose then JSON, or truncate it. Layered defense (strictest first):
 * whole string, fenced block, embedded object — each tried raw and through a
 * `jsonrepair` pass, then validated. A truncated envelope still yields the
 * answer text via a partial parse. Returns null when nothing usable was
 * produced (empty or prose-only output), leaving the caller to fall back.
 */
export function salvageAssistantOutput(raw: string): AssistantOutput | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const embedded = extractFirstJsonObject(trimmed)
  const fenceless = stripCodeFences(trimmed).trim()
  for (const candidate of [trimmed, fenceless, embedded]) {
    if (!candidate) continue
    const parsed = parseOrRepair(candidate)
    if (parsed) return parsed
  }

  // Truncated past the point repair can validate: recover at least the answer
  // text from a partial parse, dropping any half-formed citations.
  const partial = parsePartialJSON(embedded ?? fenceless) as { text?: unknown } | undefined
  if (typeof partial?.text === 'string' && partial.text.trim().length > 0) {
    return { text: partial.text.trim(), citations: [] }
  }

  return null
}

// ---------------------------------------------------------------- pure rules ---

/**
 * Silence rule: any human teammate reply after Quinn's last message mutes it
 * until an explicit re-engagement (assign-back or a later workflow step), which
 * the caller signals by not passing the muting human turn. When Quinn has never
 * spoken, any human teammate turn means a human is already handling it.
 */
export function respondEligible(messages: AssistantThreadMessage[]): boolean {
  let lastAssistant = -1
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].sender === 'assistant') lastAssistant = i
  }
  return !messages.some((m, i) => m.sender === 'human_agent' && i > lastAssistant)
}

/**
 * Assemble the structured citation list: keep only ids the tools actually
 * surfaced this run (dropping hallucinated ids and, when nothing cleared the
 * retrieval confidence floor, all of them), deduped in model order, enriched
 * with the title + url from the ledger.
 */
export function assembleCitations(
  cited: Array<{ type: 'article' | 'post' | 'snippet' | 'summary'; id: string }>,
  ledger: Map<string, AssistantCitation>
): AssistantCitation[] {
  const seen = new Set<string>()
  const out: AssistantCitation[] = []
  for (const c of cited) {
    const known = ledger.get(c.id)
    if (!known || seen.has(c.id)) continue
    seen.add(c.id)
    out.push(known)
  }
  return out
}

/**
 * Rewrite the model's inline `[n]` citation markers so each references the FINAL
 * assembled citation list (after hallucinated ids are dropped and duplicates are
 * merged), removing markers whose source didn't survive. The widget renders each
 * surviving `[n]` as a numbered dot bound to `citations[n-1]`. Text with no
 * markers is returned as-is — grounding still shows via the sources trace.
 */
export function relinkCitations(
  text: string,
  modelCitations: Array<{ type: 'article' | 'post' | 'snippet' | 'summary'; id: string }>,
  finalCitations: AssistantCitation[]
): string {
  // Empty finalCitations falls through cleanly: remap is empty, so every marker
  // maps to nothing and is stripped.
  const finalIndexById = new Map(finalCitations.map((c, i) => [c.id, i + 1]))
  const remap = new Map<number, number>()
  modelCitations.forEach((c, i) => {
    const target = finalIndexById.get(c.id)
    if (target != null) remap.set(i + 1, target)
  })
  return text
    .replace(/\[(\d+)\]/g, (_m, n) => {
      const mapped = remap.get(Number(n))
      return mapped != null ? `[${mapped}]` : ''
    })
    .trimEnd()
}

/**
 * A substantive answer (not a bare greeting): the assumed/confirmed resolution
 * outcomes only count when Quinn actually answered. Citations imply substance;
 * otherwise require more than a short pleasantry.
 */
export function isSubstantiveAnswer(turn: {
  text: string
  citations: AssistantCitation[]
}): boolean {
  if (turn.citations.length > 0) return true
  return turn.text.trim().length >= 40
}

/**
 * The "Your tools" section: one bullet per tool actually assembled this turn,
 * drawn from the tool's own `promptGuidance` line rather than a hardcoded list
 * of names here. This is the whole extension point — a new tool spec is a new
 * bullet automatically, with zero edits to this file. `[]` (every tool
 * disabled, or a message that needs none) reads as a plain no-tools line
 * rather than an empty, confusing header.
 */
/**
 * The fields the catalogue prompt needs off a conversation attribute
 * definition — a narrow shape (not the full `ConversationAttribute`) so this
 * module doesn't couple to the conversation-attributes domain's full type,
 * only what it actually renders.
 */
/**
 * System prompt for the turn. Exported so tests can pin the grounding,
 * scope-honesty, citation, and injection guards. `tools` is this turn's
 * actual assembled tool set (see `buildToolsPrompt`) — pass `[]` for a
 * tools-agnostic assertion. `attributeDefinitions` is the live catalogue
 * (fetched by the caller — this function stays pure IO-wise); it only ever
 * renders when `set_attribute` is one of `tools` AND at least one definition
 * is passed, so every existing caller that omits it (or passes `[]`) sees the
 * byte-identical prompt from before this section existed.
 */
/**
 * Frame an optional, admin-authored prompt block appended after the base
 * prompt: it adds to the base rules but never overrides them. Mirrors the base
 * prompt's injection-guard phrasing (content to follow, not license to override
 * what came before it) so a guidance rule or a surface instruction can't be
 * used to smuggle in a conflicting rule.
 */
/**
 * Frame the copilot surface: unlike every other surface, this turn is
 * answering a support TEAMMATE working the conversation, not the customer in
 * it. Structural (not admin-authored free text), so it carries no
 * injection-guard framing of its own; it composes right after the base
 * prompt, before basics/surface instructions/guidance, and only for
 * `surface: 'copilot'` (see `runAssistantTurn`).
 */
/** The ticket facts `buildTicketContextPrompt` composes into its structural line. */
export interface TicketGroundingFacts {
  title: string
  status: string
  /** Null when the ticket's status has no configured stage mapping. */
  stage: string | null
  requester: string
}

/**
 * Ticket grounding block (unified inbox §2.9): the ticket copilot's parallel
 * to the conversation surface's grounding, added right after the copilot
 * framing block. Structural facts (title/status/stage/requester) are plain
 * text (not caller-authored, so no injection-guard framing); the thread
 * itself is caller/customer-authored text same as a conversation transcript,
 * so it's wrapped via `wrapUntrustedText` (injection-guard.ts) rather than
 * trusted as instructions.
 */
export function buildTicketContextPrompt(ticket: TicketGroundingFacts, transcript: string): string {
  const statusLine = ticket.stage ? `${ticket.status} (${ticket.stage})` : ticket.status
  return [
    `Ticket: "${ticket.title}". Status: ${statusLine}. Requester: ${ticket.requester}.`,
    wrapUntrustedText('The ticket thread you are answering questions about', transcript),
  ].join('\n')
}

/**
 * Resolve the ticket-grounding facts a ticket-scoped copilot turn needs: the
 * structural facts plus the rendered thread. Best-effort — a failed lookup
 * (the ticket vanished between the route's `assertTicketViewable` gate and
 * this turn, or a transient DB error) logs and returns null rather than
 * failing the whole turn; the turn still runs, just without ticket-specific
 * grounding, the same fallback shape a missing customer row already gets
 * above for the conversation branch.
 *
 * `all: true` pulls the ENTIRE ordered thread (not the default newest-page
 * window, which silently drops the original request on a long ticket); the
 * shared `budgetTranscript` then trims by chars with a head+tail window, so the
 * opening messages survive even when the thread is over budget. CONVERGENCE
 * PHASE 0: the ticket thread is the pair union (listTicketMessages ->
 * pair-thread.service) — a linked conversation's messages fold into the
 * grounding transcript. `includeInternal`
 * follows the audience (D1): the copilot resolves to 'team', so internal notes
 * are folded into the (teammate-only, never-persisted) grounding block; any
 * future non-team surface passes 'public' and gets the byte-identical notes-free
 * render.
 */
async function loadTicketGroundingContext(
  ticketId: TicketId,
  includeInternal: boolean
): Promise<{
  facts: TicketGroundingFacts
  transcript: string
  internalSourced: boolean
} | null> {
  try {
    const [ticket, thread] = await Promise.all([
      getTicket(ticketId),
      listTicketMessages(ticketId, { includeInternal, all: true }),
    ])
    return {
      facts: {
        title: ticket.title,
        status: ticket.status.name,
        stage: ticket.stage.label,
        requester: ticket.requester?.displayName ?? 'None',
      },
      transcript: budgetTranscript(buildTicketTranscript(thread.messages)),
      internalSourced: thread.messages.some((message) => message.isInternal),
    }
  } catch (err) {
    log.warn({ err, ticketId }, 'failed to load ticket grounding context; continuing without it')
    return null
  }
}

/**
 * The conversation facts `buildConversationContextPrompt` composes into its
 * structural line — the conversation analog of `TicketGroundingFacts`. Folded
 * off the same lookup that resolves the customer principal id (see
 * `runAssistantTurn`), so it costs no extra round-trip.
 */
export interface ConversationGroundingFacts {
  /** Requester displayName, or 'None' when the visitor has no name. */
  customer: string
  /** Conversation subject/title if present, else null. */
  subject: string | null
  /** open/snoozed/closed/... */
  status: string
  /** messenger/email/web_form, or null when unknown. */
  channel: string | null
}

/**
 * Neutralize a customer-controllable fact (conversation subject, customer
 * display name) before it goes into the trusted structural line: strip newlines
 * and other control chars so a crafted subject/name can't break out of its line
 * to inject a fake instruction, and cap the length so one field can't crowd the
 * prompt. The thread body is separately fenced via `wrapUntrustedText`; this
 * guards the one place a caller-authored value sits on a trusted line.
 */
function sanitizeFactValue(value: string, max = 200): string {
  // eslint-disable-next-line no-control-regex
  const flattened = value.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim()
  return flattened.length > max ? `${flattened.slice(0, max)}…` : flattened
}

/**
 * Conversation grounding block (the sibling of `buildTicketContextPrompt`): the
 * conversation-scoped copilot's parallel to the ticket surface's grounding,
 * added right after the copilot framing block. Status/channel are system values;
 * subject and customer name are customer-controllable, so they pass through
 * `sanitizeFactValue` before joining the trusted structural line. The thread
 * itself is customer-authored text, so it's wrapped via `wrapUntrustedText`
 * (injection-guard.ts) exactly like the ticket block rather than trusted as
 * instructions.
 */
export function buildConversationContextPrompt(
  facts: ConversationGroundingFacts,
  transcript: string
): string {
  const subject = facts.subject ? ` "${sanitizeFactValue(facts.subject)}".` : ''
  const channel = facts.channel ? ` Channel: ${facts.channel}.` : ''
  return [
    `Conversation${subject} Status: ${facts.status}. Customer: ${sanitizeFactValue(facts.customer)}.${channel}`,
    wrapUntrustedText('The conversation thread you are answering questions about', transcript),
  ].join('\n')
}

/**
 * Resolve the conversation-grounding thread for a conversation-scoped copilot
 * turn. The `facts` are already in hand from the customer-lookup round-trip in
 * `runAssistantTurn` (folded there to avoid a second query), so this only loads
 * and renders the thread. Best-effort in exactly the same shape as
 * `loadTicketGroundingContext`: a failed thread load logs `warn` and returns
 * null so the turn still runs, just ungrounded. It also returns null when the
 * thread renders empty (a conversation with only system events), so an empty
 * grounding block is never pushed. `all: true` loads the whole thread, not the
 * newest window, so a long conversation's original request survives into
 * `budgetTranscript`'s head. `includeInternal` follows the audience (D1) — the
 * copilot resolves to 'team', so a teammate's internal notes on the open thread
 * are visible to Quinn here (labelled `Note (internal):` by the renderer); the
 * persisted on-close summary loads the thread notes-free and is unaffected.
 */
async function loadConversationGroundingContext(
  conversationId: ConversationId,
  facts: ConversationGroundingFacts,
  includeInternal: boolean
): Promise<{
  facts: ConversationGroundingFacts
  transcript: string
  internalSourced: boolean
} | null> {
  try {
    const messages = await loadConversationThread(conversationId, {
      includeInternal,
      all: true,
    })
    const transcript = budgetTranscript(buildConversationTranscript(messages))
    if (!transcript) return null
    return {
      facts,
      transcript,
      internalSourced: messages.some((message) => message.isInternal),
    }
  } catch (err) {
    log.warn(
      { err, conversationId },
      'failed to load conversation grounding; continuing without it'
    )
    return null
  }
}

/** `buildGuidancePrompt`'s result: the composed block plus which rules made it in. */
// ------------------------------------------------------------------- the loop ---

/** Map thread turns to model messages (human teammate turns read as assistant-side). */
function toModelMessages(messages: AssistantThreadMessage[]) {
  return messages.map((m) => ({
    role: m.sender === 'customer' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }))
}

/**
 * Classify an attempt for the usage log from observed tool state: handoff and
 * inability are tool calls, no_sources means retrieval surfaced no citation
 * candidate, otherwise this was a normal answer.
 */
function deriveAnswerKind(
  attempt: AttemptOutcome,
  toolContext: AssistantToolContext
): AiAnswerKind {
  if (attempt.validationError) return 'invalid_output'
  if (toolContext.ledger.handoffRequest) return 'escalated'
  if (toolContext.ledger.inabilityReport) {
    return toolContext.ledger.inabilityReport.reason === 'no_relevant_sources'
      ? 'no_sources'
      : 'no_answer'
  }
  if (toolContext.ledger.sources.size === 0) return 'no_sources'
  return 'answered'
}

/**
 * Run one assistant turn. Returns a suppressed result when the silence rule
 * mutes Quinn (no model spend); otherwise runs the agentic loop and returns the
 * cited answer plus any handoff/inability decision recorded by tools.
 *
 * Malformed structured output (a known weak-model failure mode) is salvaged
 * where possible and retried once. Exhausted failure throws: a caller may
 * retry or surface an error, but the server never authors words as Quinn.
 */
export async function runAssistantTurn(input: AssistantTurnInput): Promise<AssistantTurnResult> {
  const surface = input.surface
  const role = input.role
  const rolePolicy = resolveAssistantRolePolicy(role)
  const messages = input.messages

  if (!respondEligible(messages)) {
    return { status: 'suppressed', reason: 'silence' }
  }

  if (!isAssistantConfigured()) {
    throw new AssistantNotConfiguredError()
  }
  // isAssistantConfigured() guarantees an effective chat model above.
  const model = getChatModel('assistant')!

  const audience = resolveContentAudience(surface)
  if (audience !== rolePolicy.contentAudience) {
    throw new Error(`Assistant role ${role} cannot run with ${audience} content`)
  }
  const conversationId = input.conversationId ?? null
  const ticketId = input.ticketId ?? null
  const execDb = input.db ?? db
  let runtimeConfig: AssistantRuntimeConfig
  try {
    runtimeConfig = await getAssistantRuntimeConfig()
  } catch (error) {
    log.error({ err: error }, 'assistant runtime config read failed; using fail-closed defaults')
    runtimeConfig = {
      config: structuredClone(DEFAULT_ASSISTANT_CONFIG),
      revision: 1,
      workspaceName: 'this workspace',
      actionsEnabled: false,
      customActionsEnabled: false,
      configFallbackReason: 'database_read_failed',
    }
  }

  // Compile the resolved agent's per-agent knowledge map (config v3) into this
  // turn's enabled retrieval sources + status flag. This is the single seam
  // that turns admin toggles into the assembled toolset: search
  // registers iff ≥1 source is enabled, get_status iff `status` is on, and the
  // enabled set both scopes retrieval and drives the tool's source enumeration.
  const knowledgeSnapshot = resolveAssistantKnowledgeSnapshot(
    roleToAgent(role),
    runtimeConfig.config,
    audience
  )

  // Customer voice always resolves from the Agent's sub-config: the
  // customer-facing support role maps to `agent`, and `rolePolicy.customerVoice`
  // gates every read below so a copilot turn (no voice, D11) never consults it.
  // This is the one v3 resolution the runtime owns; the pure prompt module still
  // takes a flat `{ identity, voice }`.
  const agentVoice = runtimeConfig.config.agents.agent.voice

  // The current conversation's customer, for customer-scoped retrieval
  // (past-conversation summaries — see conversation-summary-retrieval.ts).
  // Resolved here because this is the one place a turn has both a
  // conversation id and a db handle; a turn with no conversation (the
  // sandbox, or a ticket-scoped turn) leaves this undefined, and that source
  // MUST return nothing in that case rather than fall back to unscoped (see
  // its own module doc) — a ticket-scoped turn deliberately never resolves
  // this, per the ticket branch's "skip customer-history grounding" contract.
  // Only the copilot surface grounds on the open conversation, so only it pays
  // for the grounding FACTS (customer displayName via the principal join, plus
  // subject/status/channel); the customer-facing widget path keeps the narrow
  // single-column read it always had, since all it needs off this row is
  // `customerPrincipalId` for the past-conversation source.
  let customerPrincipalId: PrincipalId | undefined
  let conversationFacts: ConversationGroundingFacts | null = null
  if (conversationId) {
    if (surface === 'copilot') {
      const [conversationRow] = await execDb
        .select({
          visitorPrincipalId: conversations.visitorPrincipalId,
          customer: principal.displayName,
          subject: conversations.subject,
          status: conversations.status,
          channel: conversations.channel,
        })
        .from(conversations)
        .leftJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
        .where(eq(conversations.id, conversationId))
        .limit(1)
      customerPrincipalId = conversationRow?.visitorPrincipalId
      if (conversationRow) {
        conversationFacts = {
          customer: conversationRow.customer ?? 'None',
          subject: conversationRow.subject,
          status: conversationRow.status,
          channel: conversationRow.channel,
        }
      }
    } else {
      const [conversationRow] = await execDb
        .select({ visitorPrincipalId: conversations.visitorPrincipalId })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1)
      customerPrincipalId = conversationRow?.visitorPrincipalId
    }
  }

  // Ticket grounding (unified inbox §2.9): resolved alongside the customer
  // lookup above, before tool assembly, so it's ready to fold into the system
  // prompt below. Null when there's no ticket to ground on, or the lookup
  // failed (see `loadTicketGroundingContext`'s own doc).
  // Copilot Q&A may inspect internal notes and carries that provenance into its
  // result — but only when the Copilot's `internalNotes` knowledge toggle is on
  // (config v3).
  const includeInternalGrounding =
    role === 'copilot_qa' && runtimeConfig.config.agents.copilot.knowledge.internalNotes
  const ticketGrounding = ticketId
    ? await loadTicketGroundingContext(ticketId, includeInternalGrounding)
    : null

  // Conversation grounding (copilot conversation surface): the sibling of the
  // ticket block. `conversationFacts` is only ever populated on the copilot
  // surface above, so its presence already implies that surface (a widget turn
  // grounds the customer IS in the thread and needs no "the thread you are
  // answering about" block). Uses the facts folded off the lookup plus the
  // rendered thread; null when there's no conversation, no facts row, or the
  // thread load failed. A turn has either a conversationId or a ticketId, never
  // both, so at most one grounding block is ever pushed below.
  const conversationGrounding =
    conversationId && conversationFacts
      ? await loadConversationGroundingContext(
          conversationId,
          conversationFacts,
          includeInternalGrounding
        )
      : null
  const contextInternallySourced =
    ticketGrounding?.internalSourced === true ||
    conversationGrounding?.internalSourced === true ||
    (role === 'copilot_qa' && messages.some((message) => message.sender === 'assistant'))

  // Shared construction point (simulate derives from the null conversation =
  // sandbox; actor defaults to Quinn's bounded set).
  const toolContext = makeAssistantToolContext({
    db: execDb,
    assistantPrincipalId: input.assistantPrincipalId,
    assistantName: runtimeConfig.config.identity.name,
    role,
    audience,
    conversationId,
    ticketId,
    customerPrincipalId,
    sourceTypes: input.sourceTypes,
    knowledge: knowledgeSnapshot,
    involvementId: input.involvementId,
    latestCustomerMessageId: input.latestCustomerMessageId,
    simulate: input.simulate,
    writeToolPolicy: input.simulate === true ? 'simulate' : rolePolicy.writeToolPolicy,
  })
  const promptChannel = surface === 'widget' || surface === 'email' ? surface : null
  const guidanceChannel = surface
  let guidanceCandidates: AssistantGuidanceRule[] = []
  try {
    guidanceCandidates = await listEnabledGuidanceCandidates({ agent: roleToAgent(role) })
  } catch (error) {
    log.warn({ err: error }, 'guidance candidate loading failed; continuing without guidance')
  }

  const { alwaysOn, conditional } = splitGuidanceCandidates(guidanceCandidates)
  const latestRequest =
    input.latestRequestForGuidance ??
    [...messages].reverse().find((message) => message.sender === 'customer')?.content ??
    ''
  const selectedConditionalIds = await selectApplicableGuidance({
    candidates: conditional,
    latestRequest,
    recentConversation: messages,
    conversationId: conversationId ?? undefined,
    role,
    channel: guidanceChannel ?? undefined,
    promptVersion: ASSISTANT_PROMPT_VERSION,
    configRevision: runtimeConfig.revision,
    configFallbackReason: runtimeConfig.configFallbackReason,
    ...(rolePolicy.customerVoice
      ? {
          tone: agentVoice.tone,
          responseLength: agentVoice.responseLength,
        }
      : {}),
    signal: input.signal,
  })
  const selectedConditionalIdSet = new Set(selectedConditionalIds)
  const alwaysOnIds = new Set(alwaysOn.map((rule) => rule.id))
  const selectedGuidance = applyGuidanceBudget(
    guidanceCandidates.filter(
      (rule) => alwaysOnIds.has(rule.id) || selectedConditionalIdSet.has(rule.id)
    )
  )

  // Custom actions (Phase 5): when the `assistantCustomActions` flag is on,
  // resolve every enabled definition assigned to THIS turn's agent into a
  // dynamic write-risk spec. Turn-scoped like the flag/write-policy read below,
  // so a retry can't change the set mid-turn. A definition assigned to the
  // other agent, disabled, or resolved for the wrong agent simply never
  // appears. Best-effort: a load failure drops custom actions for the turn
  // rather than failing the whole reply.
  let customActionSpecs: AssistantToolSpec[] = []
  if (runtimeConfig.customActionsEnabled) {
    try {
      customActionSpecs = await listActionSpecsForAgent(roleToAgent(role), execDb)
    } catch (error) {
      log.warn({ err: error }, 'custom action load failed; omitting custom actions this turn')
    }
  }

  // Tool wiring (flag + role-derived write policy) is turn-scoped config, not
  // per-attempt state — assembled once so a retry can't re-read settings and
  // flip gating mid-turn, and shares the same tool set across every attempt.
  // `activeSpecs` (the specs behind `tools`, index-aligned) is what the
  // system prompt's per-tool guidance composes from below.
  let { tools, activeSpecs } = await assembleAssistantToolset(
    toolContext,
    undefined,
    runtimeConfig.actionsEnabled,
    customActionSpecs
  )
  let toolNames = new Set(tools.map((t) => t.name))

  // Live attribute catalogue (P0 catalogue injection): fetched only when
  // set_attribute actually made it into this turn's tool set, so a turn with
  // the tool disabled (or assistantTools off entirely) never pays for the
  // read. IO stays here, not inside buildAssistantSystemPrompt, which is pure.
  let attributeDefinitions: Awaited<ReturnType<typeof listConversationAttributes>> | undefined
  if (toolNames.has('set_attribute')) {
    try {
      attributeDefinitions = await listConversationAttributes()
    } catch (error) {
      log.warn({ err: error }, 'attribute catalogue load failed; omitting set_attribute')
      const keep = activeSpecs.map((spec) => spec.name !== 'set_attribute')
      tools = tools.filter((_, index) => keep[index])
      activeSpecs = activeSpecs.filter((_, index) => keep[index])
      toolNames = new Set(tools.map((tool) => tool.name))
    }
  }

  // Live board catalogue, the sibling of the attribute block above:
  // capture_feedback's required boardId is unknowable to the model without an
  // enumeration, so the tool is only usable alongside its catalogue — fetched
  // when the tool made the cut, and the tool dropped when the read fails (a
  // catalogue-less capture_feedback just stalls the model on a guessable id).
  let boardCatalogue: AssistantBoardCatalogueEntry[] | undefined
  if (toolNames.has('capture_feedback')) {
    try {
      boardCatalogue = (await listBoards()).map((board) => ({
        id: board.id,
        name: board.name,
        description: board.description ?? null,
      }))
    } catch (error) {
      log.warn({ err: error }, 'board catalogue load failed; omitting capture_feedback')
      boardCatalogue = undefined
    }
    if (!boardCatalogue || boardCatalogue.length === 0) {
      const keep = activeSpecs.map((spec) => spec.name !== 'capture_feedback')
      tools = tools.filter((_, index) => keep[index])
      activeSpecs = activeSpecs.filter((_, index) => keep[index])
      toolNames = new Set(tools.map((tool) => tool.name))
    }
  }

  const trustedContextParts: string[] = []
  const modelMessages = toModelMessages(messages)
  if (ticketGrounding) {
    const status = ticketGrounding.facts.stage
      ? `${ticketGrounding.facts.status} (${ticketGrounding.facts.stage})`
      : ticketGrounding.facts.status
    trustedContextParts.push(
      `Ticket title: ${sanitizeFactValue(ticketGrounding.facts.title)}. Status: ${sanitizeFactValue(status)}. Requester: ${sanitizeFactValue(ticketGrounding.facts.requester)}.`
    )
    modelMessages.unshift({
      role: 'user',
      content: wrapUntrustedText('Ticket transcript for context', ticketGrounding.transcript),
    })
  }
  if (conversationGrounding) {
    trustedContextParts.push(
      `Conversation status: ${conversationGrounding.facts.status}. Customer: ${sanitizeFactValue(conversationGrounding.facts.customer)}.${conversationGrounding.facts.subject ? ` Subject: ${sanitizeFactValue(conversationGrounding.facts.subject)}.` : ''}${conversationGrounding.facts.channel ? ` Channel: ${conversationGrounding.facts.channel}.` : ''}`
    )
    modelMessages.unshift({
      role: 'user',
      content: wrapUntrustedText(
        'Conversation transcript for context',
        conversationGrounding.transcript
      ),
    })
  }

  const guidanceCandidateIds = guidanceCandidates.map((rule) => rule.id)
  const guidanceAppliedIds = selectedGuidance.map((rule) => rule.id)
  const appliedGuidance = selectedGuidance.map((rule) => ({ id: rule.id, name: rule.name }))
  const systemPrompts = buildAssistantSystemMessages({
    role,
    // The pure prompt module takes a flat `{ identity, voice }`; voice always
    // resolves from the Agent sub-config (customer-voice roles only — copilot
    // turns set customerVoice:false and never read it).
    config: { identity: runtimeConfig.config.identity, voice: agentVoice },
    workspaceName: runtimeConfig.workspaceName,
    tools: activeSpecs,
    trustedRuntimeContext: trustedContextParts.join('\n') || null,
    channel: promptChannel,
    guidance: selectedGuidance.map((rule) => rule.instruction),
    workflowInstructions: input.stepInstructions,
    attributeCatalogue: attributeDefinitions,
    boardCatalogue,
  })

  // Tool-backed turns have an objective execution ledger. A zero-tool public
  // reply is the only ambiguous terminal path: it can be valid small talk or a
  // missed support request. Check only that narrow path, using the configured
  // quality-gate model when present and otherwise Quinn's own model. The check
  // cannot call tools or author customer text; a rejection simply gives Quinn
  // another agentic iteration in which it again chooses zero or more tools.
  const completionEvaluatorModel = getChatModel('qualityGate') ?? model
  let zeroToolEvaluation: ZeroToolCompletionEvaluation | null = null

  // Instrumentation-only OTel tracing (one span per turn, child spans per tool
  // call). Attributes stay privacy-minimal — the same non-textual vocabulary as
  // the ai_usage_log metadata below (role, surface, versions, finish reason,
  // token usage, tool names/counts), never tool args/results or customer text.
  // No-op unless an exporter is registered at process start (gh #313).
  const tracingMiddleware = createAssistantTracingMiddleware({
    role,
    surface,
    promptVersion: ASSISTANT_PROMPT_VERSION,
    configRevision: runtimeConfig.revision,
  })

  const outcome = await runSynthesis<never, AssistantToolContext>({
    model,
    systemPrompts,
    messages: modelMessages,
    outputSchema: assistantOutputSchema,
    middleware: [tracingMiddleware],
    // The user-interactive agentic turn re-dials a pristine transport RUN_ERROR
    // (nothing streamed, no tool ran) up to twice; a committed failure never
    // re-dials. Inline callers (evaluator/guidance) keep the default 0.
    transportRetries: 2,
    tools: {
      specs: tools,
      context: toolContext,
      agentLoopStrategy: maxIterations(ASSISTANT_MAX_ITERATIONS),
      names: toolNames,
    },
    deltaField: 'text',
    salvageMode: 'forgiving',
    salvage: (raw) => salvageAssistantOutput(raw),
    // Customer-visible text is model-authored or absent. A provider/decoding
    // failure propagates to the caller for retry/observability; it is never
    // converted into a canned Quinn message.
    onFailure: 'throw',
    signal: input.signal,
    onTextDelta: input.onTextDelta,
    onActivity: input.onActivity,
    wireSink: input.wireSink,
    usageLogParams: {
      // Every assistant turn logs the 'assistant' pipeline step.
      pipelineStep: rolePolicy.pipelineStep,
      callType: 'chat_completion',
      model,
      metadata: {
        conversationId: input.conversationId ?? null,
        // Unified inbox §2.9: the ticket-scoped copilot turn's analog of
        // conversationId above, same always-present-defaulting-null shape (a
        // turn grounds on exactly one of the two, never both).
        ticketId: input.ticketId ?? null,
        // The only signal that distinguishes a copilot turn from every other
        // surface in ai_usage_log — see analytics/copilot-usage.ts, which
        // counts questions and groups per-teammate activity off this field.
        surface,
        role,
        promptVersion: ASSISTANT_PROMPT_VERSION,
        configRevision: runtimeConfig.revision,
        ...(rolePolicy.customerVoice
          ? {
              tone: agentVoice.tone,
              responseLength: agentVoice.responseLength,
            }
          : {}),
        ...(guidanceCandidateIds.length > 0 ? { guidanceCandidateIds } : {}),
        ...(guidanceAppliedIds.length > 0 ? { guidanceAppliedIds } : {}),
        ...(runtimeConfig.configFallbackReason
          ? { configFallbackReason: runtimeConfig.configFallbackReason }
          : {}),
        ...(input.actorPrincipalId ? { principalId: input.actorPrincipalId } : {}),
      },
    },
    deriveAnswerKind: (attempt) => deriveAnswerKind(attempt, toolContext),
    deriveAttemptMetadata: (attempt) => ({
      // Durable, privacy-minimal agent trace: names and counts only. Tool args,
      // results, and customer text stay out of ai_usage_log metadata.
      toolCalls: [...toolContext.ledger.toolCalls],
      toolOutcomes: [...toolContext.ledger.toolOutcomes],
      searchCalls: toolContext.ledger.searchCalls,
      citationCandidates: toolContext.ledger.sources.size,
      completionDisposition: attempt.validationError
        ? 'invalid'
        : toolContext.ledger.handoffRequest
          ? 'handoff'
          : toolContext.ledger.inabilityReport
            ? 'inability'
            : 'answer',
      ...(toolContext.ledger.handoffRequest
        ? { handoffReason: toolContext.ledger.handoffRequest.reason }
        : {}),
      ...(toolContext.ledger.inabilityReport
        ? { inabilityReason: toolContext.ledger.inabilityReport.reason }
        : {}),
      ...(zeroToolEvaluation
        ? {
            zeroToolCompletionDecision: zeroToolEvaluation.decision,
            zeroToolCompletionReason: zeroToolEvaluation.reason,
          }
        : {}),
    }),
    validateFinal: async (final) => {
      validateAssistantCompletion(final, {
        searchCalls: toolContext.ledger.searchCalls,
        sources: toolContext.ledger.sources,
        toolCalls: toolContext.ledger.toolCalls,
        inabilityReported: toolContext.ledger.inabilityReport !== null,
        handoffRequested: toolContext.ledger.handoffRequest !== null,
        hasAdminGuidance: selectedGuidance.length > 0,
      })

      if (
        audience !== 'public' ||
        conversationId === null ||
        toolContext.ledger.toolCalls.length > 0
      ) {
        return
      }

      const parsed = assistantOutputSchema.parse(final)
      try {
        zeroToolEvaluation = await evaluateZeroToolCompletion({
          model: completionEvaluatorModel,
          messages,
          candidate: parsed.text,
          availableTools: [...toolNames],
          surface,
          conversationId,
          promptVersion: ASSISTANT_PROMPT_VERSION,
          configRevision: runtimeConfig.revision,
          role,
          tone: agentVoice.tone,
          responseLength: agentVoice.responseLength,
          configFallbackReason: runtimeConfig.configFallbackReason,
          signal: input.signal,
        })
      } catch (error) {
        log.warn({ err: error }, 'zero-tool completion evaluation failed')
        throw new AssistantCompletionError('zero_tool_evaluation_failed')
      }

      if (zeroToolEvaluation.decision === 'retry') {
        throw new AssistantCompletionError('incomplete_zero_tool_response')
      }
    },
    onAttemptStart: () => {
      // Fresh ledger per attempt so a retry starts clean. A whole-object swap,
      // not a per-field reset: a newly added ledger field cannot be forgotten
      // here, and nothing holds a live reference to the old ledger across
      // attempts anyway (both return sites below snapshot via spread at return
      // time instead).
      toolContext.ledger = makeAssistantToolLedger()
      zeroToolEvaluation = null
    },
    onRetry: (_attempt, error) => {
      if (
        error instanceof AssistantCompletionError &&
        !systemPrompts.includes(ASSISTANT_COMPLETION_REPAIR_PROMPT)
      ) {
        systemPrompts.push(ASSISTANT_COMPLETION_REPAIR_PROMPT)
      }
      log.warn({ err: error }, 'assistant turn attempt failed, retrying once')
    },
  })

  if (outcome.outcome !== 'success') throw outcome.lastError ?? new Error('assistant turn failed')

  const parsedResult = assistantOutputSchema.safeParse(outcome.final)
  if (!parsedResult.success) {
    throw new AssistantCompletionError('non_conformant_output')
  }
  const parsed = parsedResult.data
  const citations = assembleCitations(parsed.citations, toolContext.ledger.sources)
  // Operational decisions come exclusively from tool calls. This compatibility
  // projection lets existing consumers render the handoff state; the model's
  // final object contains no action field.
  const escalation = toolContext.ledger.handoffRequest
    ? ({ ...toolContext.ledger.handoffRequest, mode: 'handoff' } as const)
    : undefined
  const trace: AssistantTurnTrace = {
    promptVersion: ASSISTANT_PROMPT_VERSION,
    configRevision: runtimeConfig.revision,
    role,
    ...(rolePolicy.customerVoice
      ? {
          tone: agentVoice.tone,
          responseLength: agentVoice.responseLength,
        }
      : {}),
    appliedGuidance,
    toolCalls: [...toolContext.ledger.toolOutcomes],
    ...(runtimeConfig.configFallbackReason
      ? { configFallbackReason: runtimeConfig.configFallbackReason }
      : {}),
  }
  const delivered = {
    text: relinkCitations(parsed.text, parsed.citations, citations),
    // Quinn's self-classification (copilot surface only); every other surface
    // omits it, and so does a model that didn't bother — both land on the
    // customer-safe default, so this never demotes a widget reply.
    answerType: parsed.answerType ?? (role === 'copilot_qa' ? 'analysis' : 'draft_reply'),
    citations,
    internalSourced:
      contextInternallySourced ||
      [...toolContext.ledger.sources.values()].some((source) => source.internal === true),
    proposedActions: [...toolContext.ledger.proposedActions],
    identity: runtimeConfig.config.identity,
    trace,
    ...(escalation && { escalation }),
  }
  if (toolContext.ledger.inabilityReport) {
    return {
      status: 'cannot_answer',
      cannotAnswerReason: toolContext.ledger.inabilityReport.reason,
      ...delivered,
    }
  }
  return { status: 'answered', ...delivered }
}

export interface StreamAssistantTurnOptions {
  input: AssistantTurnInput
  /** Thread/run ids echoed on the canonical lifecycle chunks (from the AG-UI
   *  request body, so the client correlates the run it started). */
  wire: WireRunIds
  /**
   * Maps the turn's post-processed result to this surface's terminal payload
   * (CopilotFinalPayload, AssistantTestFinalPayload, ...), carried on AG-UI's
   * standard RUN_FINISHED.result slot. Runs after
   * the turn fully completes — citations relinked, completion validated — so
   * the payload is the enriched result, never the raw model object.
   */
  buildFinalPayload: (result: AssistantTurnResult) => unknown
  /** Maps a turn failure to the wire error frame. Defaults to
   *  not_configured / turn_failed. */
  mapError?: (error: unknown) => { code: string; message: string }
}

function defaultMapError(error: unknown): { code: string; message: string } {
  if (error instanceof AssistantNotConfiguredError) {
    return { code: 'not_configured', message: error.message }
  }
  return { code: 'turn_failed', message: 'The assistant could not complete this turn.' }
}

/**
 * The AG-UI wire shape of one assistant turn, for routes serving
 * `toServerSentEventsResponse`. Runs the exact `runAssistantTurn` (identical
 * retry/salvage/post-processing semantics) with its committed model-stream
 * chunks forwarded to the wire, wrapped in ONE canonical run lifecycle:
 *
 *   RUN_STARTED, <committed model chunks: text deltas as raw structured JSON,
 *   TOOL_CALL_*, CUSTOM (incl. structured-output.*)>, STEP_* activity, and a
 *   terminal RUN_FINISHED whose standard `result` slot carries the
 *   post-processed surface payload
 *
 * — or RUN_ERROR as the terminal frame on failure. The engine's own
 * per-iteration lifecycle chunks never reach the wire (synthesis-core filters
 * them): ChatClient settles a run on ANY RUN_FINISHED, so a mid-loop one would
 * end the client's turn early. A suppressed turn (silence rule) emits no model
 * chunks, just the lifecycle pair with the suppressed payload on `result`.
 */
export function streamAssistantTurn(
  options: StreamAssistantTurnOptions
): AsyncGenerator<StreamChunk> {
  const queue = createChunkQueue()
  const mapError = options.mapError ?? defaultMapError

  // Server-authoritative activity on AG-UI's standard step lifecycle: each
  // status change is a STEP_STARTED (stepName = the shared activity
  // vocabulary), closing the previous step first so pairs stay balanced.
  // Deliberately NOT routed through the commit buffer — 'thinking' fires at
  // attempt start, before any model chunk exists, and the client should show
  // it immediately (matching the old contract's timing).
  const callerOnActivity = options.input.onActivity
  let openStep: AssistantActivityStatus | null = null
  const closeOpenStep = (): void => {
    if (openStep !== null) {
      queue.push(stepFinishedChunk(openStep))
      openStep = null
    }
  }
  const onActivity = (activity: AssistantActivity): void => {
    const status = activityToStatus(activity)
    if (status !== openStep) {
      closeOpenStep()
      queue.push(stepStartedChunk(status))
      openStep = status
    }
    callerOnActivity?.(activity)
  }

  // AG-UI pairing compliance: close any triad a committed-but-failed attempt
  // left open before a retry's new message or the terminal frame (see
  // createPairingTracker). `observe` runs BEFORE the chunk is pushed so its
  // synthetic END lands ahead of a superseding START.
  const pairing = createPairingTracker((chunk) => queue.push(chunk))
  const wireSink = (chunk: StreamChunk): void => {
    pairing.observe(chunk)
    queue.push(chunk)
  }

  queue.push(runStartedChunk(options.wire))
  void runAssistantTurn({ ...options.input, onActivity, wireSink })
    .then((result) => {
      pairing.closeOpen()
      closeOpenStep()
      queue.push(runFinishedChunk(options.wire, options.buildFinalPayload(result)))
      queue.end()
    })
    .catch((error: unknown) => {
      log.warn({ err: error }, 'assistant wire turn failed')
      pairing.closeOpen()
      closeOpenStep()
      const { code, message } = mapError(error)
      queue.push(runErrorChunk(options.wire, code, message))
      queue.end()
    })

  return queue.stream()
}
