/**
 * Quinn's tool catalogue: one spec per tool, describing what it does, who can
 * enable it, and how it runs, alongside the model-facing definition and its
 * server implementation. `assistant.tools.ts` assembles the catalogue into
 * TanStack AI server tools; nothing here talks to the model runtime directly.
 *
 * Every spec carries a control-mode contract even though only 'autonomous' is
 * reachable today — checking `permissions` and enforcing `defaultMode` /
 * approval both land in a later task. Read tools never support 'approval':
 * approval gates a change before it happens, and reads don't change anything.
 */
import { toolDefinition, type ToolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { conversations, eq } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { PrincipalId, ConversationId, AssistantInvolvementId, BoardId } from '@quackback/ids'
import type { HelpCenterAudience } from '@/lib/server/domains/help-center/help-center-search.service'
import { retrieveKbArticles } from './retrieval'
import { listMessages } from '@/lib/server/domains/conversation/conversation.query'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import {
  TICKET_TYPES,
  CONVERSATION_PRIORITIES,
  type TicketType,
  type ConversationPriority,
} from '@/lib/shared/db-types'
import type { Actor } from '@/lib/server/policy/types'
import { setConversationAttribute } from '@/lib/server/domains/conversation-attributes/set-attribute.service'
import { readAttributeValue } from '@/lib/shared/conversation/attribute-values'
import { setConversationStatus } from '@/lib/server/domains/conversation/conversation.service'
import { createTicket } from '@/lib/server/domains/tickets/ticket.service'
import { createPostFromConversation } from '@/lib/server/domains/conversation/conversation.convert'
import { quinnActor } from './assistant.actor'

/** A structured citation — the only citation contract; never free-form markdown. */
export interface AssistantCitation {
  type: 'article' | 'post'
  id: string
  title: string
  url: string
}

/**
 * Request-local context threaded to server tools (and middleware). Carries the
 * tenant db handle, Quinn's service principal, the viewer audience for
 * retrieval scoping, the linked conversation (null in the sandbox), and a
 * mutable ledger of sources surfaced this run. It is passed to `chat({ context })`
 * and NEVER serialized into the model prompt.
 */
export interface AssistantToolContext {
  db: Executor
  assistantPrincipalId: PrincipalId
  audience: HelpCenterAudience
  conversationId: ConversationId | null
  /** Sources surfaced by search_knowledge this run, keyed by id, for citation assembly. */
  sources: Map<string, AssistantCitation>
  /** search_knowledge calls made this attempt, for the server-side search budget. */
  searchCalls: number
  /** True in the admin sandbox: write tools report what they would do instead of running. */
  simulate: boolean
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
  audience: HelpCenterAudience
  conversationId: ConversationId | null
  involvementId?: AssistantInvolvementId | null
  latestCustomerMessageId?: string | null
  simulate?: boolean
  actor?: Actor
}): AssistantToolContext {
  return {
    db: init.db,
    assistantPrincipalId: init.assistantPrincipalId,
    audience: init.audience,
    conversationId: init.conversationId,
    sources: new Map<string, AssistantCitation>(),
    searchCalls: 0,
    simulate: init.simulate ?? init.conversationId === null,
    involvementId: init.involvementId ?? null,
    latestCustomerMessageId: init.latestCustomerMessageId ?? null,
    actor: init.actor ?? quinnActor(init.assistantPrincipalId),
  }
}

/** Per-article snippet budget handed to the model (full content stays server-side). */
const KNOWLEDGE_SNIPPET_CHARS = 1200

/**
 * Hard per-attempt budget on search_knowledge. Prompt discipline alone does not
 * hold — a model that dislikes its results keeps reformulating until the
 * iteration cap kills the whole turn with no answer (observed as fallback
 * replies). Past the budget the tool returns no articles and an explicit
 * instruction to answer from what was already retrieved, which deterministically
 * ends the exploration while keeping everything already in context usable.
 */
export const SEARCH_BUDGET_PER_TURN = 3

/** Recent messages get_conversation_context returns. */
const CONTEXT_MESSAGE_LIMIT = 20

/** Public help-center path for a retrieved article. */
function helpArticleUrl(categorySlug: string, slug: string): string {
  return `/hc/articles/${categorySlug}/${slug}`
}

/** Read tools only observe; write tools change state and can require approval. */
export type ToolRiskClass = 'read' | 'write'

// The control-mode vocabulary is owned by the settings namespace that persists
// it (assistant -> settings is an established dependency direction); one union
// means the E-2 gate compares saved modes and supportedModes as one type.
export type { ToolControlMode } from '@/lib/server/domains/settings/settings.assistant'
import type { ToolControlMode } from '@/lib/server/domains/settings/settings.assistant'

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

function withGateEnvelope<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, assistantGateEnvelopeSchema])
}

/**
 * One entry in Quinn's tool catalogue. Bundles the model-facing `definition`
 * with the admin-facing metadata (label/description/risk/modes/permissions)
 * needed to list, control, and audit the tool, plus the actual `execute` body
 * kept separate from `definition` so a control-mode gate can wrap it without
 * touching the model-facing schema.
 */
export interface AssistantToolSpec<In = unknown, Out = unknown> {
  /** Stable snake_case id, derived from `definition.name` by defineToolSpec. */
  name: string
  /** Admin UI display name. */
  label: string
  /** Admin UI copy explaining what the tool does — not the model-facing description. */
  description: string
  risk: ToolRiskClass
  supportedModes: readonly ToolControlMode[]
  defaultMode: ToolControlMode
  /** Checked via can(quinnActor, p) before execute (wiring lands in a later task). */
  permissions: readonly PermissionKey[]
  /** The TanStack tool definition: model-facing name, description, and zod schemas. */
  definition: ToolDefinition<any, any, string>
  execute(args: In, ctx: AssistantToolContext): Promise<Out>
  /** Human-readable one-liner for approval cards and the audit log. */
  summarize(args: In): string
  idempotencyKey?(args: In, ctx: AssistantToolContext): string
}

export const searchKnowledgeTool = toolDefinition({
  name: 'search_knowledge',
  description:
    'Search the knowledge base for articles relevant to the customer question. Returns only content the current viewer is allowed to see. Call this before answering and cite the returned article ids.',
  inputSchema: z.object({
    query: z.string().min(1).max(500).describe('A focused search query derived from the question.'),
  }),
  outputSchema: withGateEnvelope(
    z.object({
      articles: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          snippet: z.string(),
        })
      ),
      note: z.string().optional(),
    })
  ),
})

export const getConversationContextTool = toolDefinition({
  name: 'get_conversation_context',
  description:
    'Fetch metadata and recent messages for the current conversation: its status, priority, whether a human teammate is assigned, and the latest messages. Use it to ground your reply in what has already been said.',
  inputSchema: z.object({}),
  outputSchema: withGateEnvelope(
    z.object({
      linked: z.boolean(),
      status: z.string().nullable(),
      priority: z.string().nullable(),
      assignedToHuman: z.boolean(),
      messages: z.array(z.object({ sender: z.string(), text: z.string() })),
    })
  ),
})

interface SearchKnowledgeArgs {
  query: string
}

interface SearchKnowledgeOutput {
  articles: Array<{ id: string; title: string; snippet: string }>
  note?: string
}

async function executeSearchKnowledge(
  args: SearchKnowledgeArgs,
  ctx: AssistantToolContext
): Promise<SearchKnowledgeOutput> {
  // Server-side search budget: end the exploration deterministically rather
  // than letting reformulation loops exhaust the iteration cap.
  ctx.searchCalls += 1
  if (ctx.searchCalls > SEARCH_BUDGET_PER_TURN) {
    return {
      articles: [],
      note: 'Search limit reached for this turn. Answer the customer now using only the articles already retrieved; if none were relevant, say you do not know and offer to connect a human.',
    }
  }
  // Audience-scoped from day one: the citation set can never exceed what the
  // viewer could already see.
  const articles = await retrieveKbArticles(args.query, { audience: ctx.audience })
  for (const a of articles) {
    ctx.sources.set(a.id, {
      type: 'article',
      id: a.id,
      title: a.title,
      url: helpArticleUrl(a.categorySlug, a.slug),
    })
  }
  return {
    articles: articles.map((a) => ({
      id: a.id,
      title: a.title,
      snippet: a.content.slice(0, KNOWLEDGE_SNIPPET_CHARS),
    })),
  }
}

interface ConversationContextOutput {
  linked: boolean
  status: string | null
  priority: string | null
  assignedToHuman: boolean
  messages: Array<{ sender: string; text: string }>
}

async function executeGetConversationContext(
  _args: Record<string, never>,
  ctx: AssistantToolContext
): Promise<ConversationContextOutput> {
  // No linked conversation (e.g. the admin sandbox): the transcript in the
  // prompt is all the context there is.
  if (!ctx.conversationId) {
    return { linked: false, status: null, priority: null, assignedToHuman: false, messages: [] }
  }
  // The row lookup and message page are independent; fetch them together.
  const [[row], page] = await Promise.all([
    ctx.db
      .select({
        status: conversations.status,
        priority: conversations.priority,
        assignedAgentPrincipalId: conversations.assignedAgentPrincipalId,
      })
      .from(conversations)
      .where(eq(conversations.id, ctx.conversationId))
      .limit(1),
    listMessages(ctx.conversationId, {
      includeInternal: false,
      limit: CONTEXT_MESSAGE_LIMIT,
    }),
  ])
  return {
    linked: true,
    status: row?.status ?? null,
    priority: row?.priority ?? null,
    assignedToHuman: Boolean(row?.assignedAgentPrincipalId),
    messages: page.messages.map((m) => ({ sender: m.senderType, text: m.content })),
  }
}

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
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .describe('The value to store. Use null to clear the attribute.'),
  }),
  outputSchema: withGateEnvelope(
    z.object({
      applied: z.boolean(),
      note: z.string().optional(),
    })
  ),
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
  outputSchema: withGateEnvelope(
    z.object({
      closed: z.boolean(),
      note: z.string().optional(),
    })
  ),
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
  outputSchema: withGateEnvelope(
    z.object({
      created: z.boolean(),
      ticketId: z.string().optional(),
      reference: z.string().optional(),
      title: z.string().optional(),
      note: z.string().optional(),
    })
  ),
})

export const captureFeedbackTool = toolDefinition({
  name: 'capture_feedback',
  description:
    'Turn a feature request or product suggestion from this conversation into a public feedback post attributed to the customer, so it joins the roadmap the team tracks. Use this for ideas and suggestions, not for problems that need a fix; use create_ticket for those. A teammate must approve before anything posts, since this publishes content under the customer identity.',
  inputSchema: z.object({
    boardId: z.string().min(1).describe('The board TypeID to post the feedback to.'),
    title: z.string().min(1).max(200).describe('A short, specific title for the feedback post.'),
    content: z.string().max(2000).optional().describe('Additional detail from the conversation.'),
  }),
  outputSchema: withGateEnvelope(
    z.object({
      created: z.boolean(),
      postId: z.string().optional(),
      note: z.string().optional(),
    })
  ),
})

const NO_CONVERSATION_NOTE = 'No linked conversation.'

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

interface SetAttributeArgs {
  key: string
  value: string | number | boolean | null
}

interface SetAttributeOutput {
  applied: boolean
  note?: string
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
      : readAttributeValue(attributes[args.key])?.v === args.value
  return applied
    ? { applied: true }
    : { applied: false, note: 'Attribute already set by another source.' }
}

interface EndConversationArgs {
  reason?: string
}

interface EndConversationOutput {
  closed: boolean
  note?: string
}

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
  return { closed: true }
}

interface CreateTicketArgs {
  type: TicketType
  title: string
  description?: string
  priority?: ConversationPriority
}

interface CreateTicketOutput {
  created: boolean
  ticketId?: string
  reference?: string
  title?: string
  note?: string
}

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

interface CaptureFeedbackArgs {
  boardId: string
  title: string
  content?: string
}

interface CaptureFeedbackOutput {
  created: boolean
  postId?: string
  note?: string
}

async function executeCaptureFeedback(
  args: CaptureFeedbackArgs,
  ctx: AssistantToolContext
): Promise<CaptureFeedbackOutput> {
  const conversationId = ctx.conversationId
  if (!conversationId) {
    return { created: false, note: NO_CONVERSATION_NOTE }
  }
  const result = await createPostFromConversation(
    {
      conversationId,
      boardId: args.boardId as BoardId,
      title: args.title,
      content: args.content,
    },
    {
      agentActor: ctx.actor,
      agentPrincipalId: ctx.assistantPrincipalId,
      agent: { principalId: ctx.assistantPrincipalId, displayName: 'Quinn' },
    }
  )
  return { created: result.created, postId: result.postId }
}

/**
 * Build a catalogue entry from a tool definition plus its admin metadata.
 * `name` derives from the definition so the model-facing id and the registry
 * id can never drift, and the erasure to the registry's unknown-typed shape
 * lives here, in exactly one place, instead of a cast per entry.
 */
function defineToolSpec<In, Out>(spec: {
  label: string
  description: string
  risk: ToolRiskClass
  supportedModes: readonly ToolControlMode[]
  defaultMode: ToolControlMode
  permissions: readonly PermissionKey[]
  definition: ToolDefinition<any, any, string>
  execute: (args: In, ctx: AssistantToolContext) => Promise<Out>
  summarize: (args: In) => string
  idempotencyKey?: (args: In, ctx: AssistantToolContext) => string
}): AssistantToolSpec {
  return { name: spec.definition.name, ...spec } as AssistantToolSpec
}

const SPECS: readonly AssistantToolSpec[] = [
  defineToolSpec({
    label: 'Search knowledge',
    description: 'Search the published help center for articles the current viewer can see.',
    risk: 'read',
    supportedModes: ['disabled', 'autonomous'],
    defaultMode: 'autonomous',
    // Knowledge base reads are already scoped by viewer audience; there is no
    // separate conversation- or ticket-shaped permission to check here.
    permissions: [],
    definition: searchKnowledgeTool,
    execute: executeSearchKnowledge,
    summarize: (args) => `Search knowledge for "${args.query}"`,
  }),
  defineToolSpec({
    label: 'Read conversation context',
    description: 'Read the linked conversation status, priority, assignment, and recent messages.',
    risk: 'read',
    supportedModes: ['disabled', 'autonomous'],
    defaultMode: 'autonomous',
    // Reads a single conversation already scoped to the caller; view_all is
    // for listing across the workspace, which this tool never does.
    permissions: [PERMISSIONS.CONVERSATION_VIEW],
    definition: getConversationContextTool,
    execute: executeGetConversationContext,
    summarize: () => 'Read conversation context',
  }),
  defineToolSpec({
    label: 'Set attribute',
    description:
      'Record a structured fact on the conversation (category, plan tier, etc.) learned from what the customer said.',
    risk: 'write',
    supportedModes: ['disabled', 'approval', 'autonomous'],
    defaultMode: 'autonomous',
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
    risk: 'write',
    supportedModes: ['disabled', 'approval', 'autonomous'],
    defaultMode: 'approval',
    permissions: [PERMISSIONS.CONVERSATION_SET_STATUS],
    definition: endConversationTool,
    execute: executeEndConversation,
    summarize: () => 'Close the conversation',
  }),
  defineToolSpec({
    label: 'Create ticket',
    description: 'Open a support ticket to track work that needs a teammate beyond this conversation.',
    risk: 'write',
    supportedModes: ['disabled', 'approval', 'autonomous'],
    defaultMode: 'approval',
    permissions: [PERMISSIONS.TICKET_CREATE],
    definition: createTicketTool,
    execute: executeCreateTicket,
    summarize: (args) => `Create a ${args.type} ticket: "${args.title}"`,
  }),
  defineToolSpec({
    label: 'Capture feedback',
    description:
      'Create a public feedback post from the conversation, attributed to the customer, for the team roadmap.',
    risk: 'write',
    // Approval-only v0: a live post attributed to the visitor is public in a
    // way the other write tools are not, so there is no autonomous mode yet.
    supportedModes: ['disabled', 'approval'],
    defaultMode: 'approval',
    permissions: [PERMISSIONS.POST_CREATE, PERMISSIONS.POST_VOTE_ON_BEHALF],
    definition: captureFeedbackTool,
    execute: executeCaptureFeedback,
    summarize: (args) => `Capture feedback: "${args.title}"`,
  }),
]

/**
 * Static registry of Quinn's tools, keyed by name. Connector-backed tools
 * join this catalogue in a later task; for now it holds the read tools plus
 * the write tools that act on the conversation, a ticket, or a feedback post.
 */
export const ASSISTANT_TOOL_SPECS: Record<string, AssistantToolSpec> = Object.fromEntries(
  SPECS.map((s) => [s.name, s])
)

/**
 * Resolve the active tool catalogue. Today this is just the static registry;
 * per-workspace connector tools join the list here in a later task without
 * changing callers.
 */
export function resolveToolSpecs(): AssistantToolSpec[] {
  return Object.values(ASSISTANT_TOOL_SPECS)
}
