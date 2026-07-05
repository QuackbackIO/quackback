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
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { HelpCenterAudience } from '@/lib/server/domains/help-center/help-center-search.service'
import { retrieveKbArticles } from './retrieval'
import { listMessages } from '@/lib/server/domains/conversation/conversation.query'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

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
  outputSchema: z.object({
    articles: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        snippet: z.string(),
      })
    ),
    note: z.string().optional(),
  }),
})

export const getConversationContextTool = toolDefinition({
  name: 'get_conversation_context',
  description:
    'Fetch metadata and recent messages for the current conversation: its status, priority, whether a human teammate is assigned, and the latest messages. Use it to ground your reply in what has already been said.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    linked: z.boolean(),
    status: z.string().nullable(),
    priority: z.string().nullable(),
    assignedToHuman: z.boolean(),
    messages: z.array(z.object({ sender: z.string(), text: z.string() })),
  }),
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
]

/**
 * Static registry of Quinn's tools, keyed by name. Connector-backed tools
 * (data connectors, write actions) join this catalogue in a later task; for
 * now it holds the two read tools that exist today.
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
