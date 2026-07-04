/**
 * Quinn's v1 tool layer.
 *
 * Two read-only tools, both structurally gated: typed zod inputs, allowlisted
 * output fields, and a runtime context that never reaches the model. Action
 * tools (status / assign / create-post) join the next wave; they are left out
 * entirely rather than half-wired.
 *
 * - `search_knowledge` wraps the shared retrieval module and is ALWAYS
 *   audience-scoped: what Quinn can cite is exactly what the viewer could
 *   already see.
 * - `get_conversation_context` is a read-only fetch of the current conversation
 *   via the conversation domain's query module (never mutated here).
 */
import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { conversations, eq } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import type { HelpCenterAudience } from '@/lib/server/domains/help-center/help-center-search.service'
import { retrieveKbArticles } from './retrieval'
import { listMessages } from '@/lib/server/domains/conversation/conversation.query'

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

/** Build the server-side tool set bound to a runtime context. */
export function createAssistantTools() {
  const searchKnowledge = searchKnowledgeTool.server<AssistantToolContext>(
    async (args, toolCtx) => {
      const ctx = toolCtx.context
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
  )

  const getConversationContext = getConversationContextTool.server<AssistantToolContext>(
    async (_args, toolCtx) => {
      const ctx = toolCtx.context
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
  )

  return [searchKnowledge, getConversationContext]
}
