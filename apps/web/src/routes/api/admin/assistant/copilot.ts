/**
 * Quinn Copilot: a private, teammate-facing Q&A sidebar in the inbox
 * conversation panel (COPILOT-SIDEBAR-UX.md). Streams a single turn scoped to
 * a real conversation, for grounding (get_conversation_context and the
 * customer-scoped past-conversation summaries source) and for the retrieval
 * ceiling (surface 'copilot' resolves to the 'team' ContentAudience). This
 * route never writes to the conversation itself and never opens or touches an
 * assistant_involvements row: those side effects live entirely in
 * assistant.orchestrator.ts's runAssistantTurnForConversation, which this
 * route never calls; it calls the runtime seam (runAssistantTurn) directly,
 * exactly as the admin sandbox does.
 *
 * Write tools are forced to `writeToolPolicy: 'propose'` (see
 * `resolveEffectiveToolMode`) regardless of the assistantActions setting and
 * each tool's configured mode: a copilot turn is a teammate asking Quinn a
 * question about the conversation, never Quinn acting in it directly, so a
 * write-tool call always turns into a pending-approval proposal instead of
 * running for real (P2-C.4, "act-on-approval", the beyond-Fin edge). This is
 * ONE documented exception to "never writes to it": proposing does insert a
 * real `assistant_pending_actions` row and an accompanying internal note on
 * the conversation announcing it (surfacePendingActionNote, so other
 * teammates see the proposal in the thread without polling), but nothing
 * else. The write tool's own effect never runs, no OTHER conversation message
 * is written, and no involvement is opened. `proposedActions` on the final
 * payload mirrors what got proposed, straight off the tool context's ledger.
 *
 * Gated on `copilot.use` (the authz matrix picks this up automatically) and
 * the `assistantCopilot` flag, mirroring sandbox.ts's SSE shape otherwise.
 * The shared gate sequence (permission -> body parse -> flag -> configured ->
 * token budget -> conversation-viewable) lives in copilot-gate.ts, alongside
 * transform.ts.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  runAssistantTurn,
  ensureAssistantPrincipal,
  activityToStatus,
  type AssistantThreadMessage,
} from '@/lib/server/domains/assistant'
import { gateCopilotRequest } from '@/lib/server/domains/assistant/copilot-gate'
import { conversationIdSchema } from '@/lib/server/domains/assistant/conversation-id.schema'
import { createSseStream, SSE_RESPONSE_HEADERS } from '@/lib/server/utils/sse'
import { logger } from '@/lib/server/logger'
import {
  COPILOT_EVENTS,
  type CopilotDeltaPayload,
  type CopilotActivityPayload,
  type CopilotFinalPayload,
  type CopilotErrorPayload,
  type CopilotHistoryEntry,
} from '@/lib/shared/assistant/copilot-contract'

const log = logger.child({ component: 'assistant-copilot' })

const MAX_QUESTION_CHARS = 4000
const MAX_HISTORY_TURNS = 20

// The zod literals are the runtime validation; the type annotation just pins
// the parsed shape to the shared CopilotHistoryEntry so the route and the
// sidebar's history building can never drift silently.
const historyEntrySchema: z.ZodType<CopilotHistoryEntry> = z.object({
  role: z.enum(['teammate', 'copilot']),
  content: z.string().min(1).max(MAX_QUESTION_CHARS),
})

const requestSchema = z.object({
  conversationId: conversationIdSchema,
  question: z.string().min(1).max(MAX_QUESTION_CHARS),
  history: z.array(historyEntrySchema).max(MAX_HISTORY_TURNS).default([]),
  sourceTypes: z.array(z.enum(['article', 'post', 'snippet', 'summary'])).optional(),
})

/** Map the teammate's prior turns + new question onto the runtime's message
 *  vocabulary: a teammate turn reads as 'customer' (the one asking Quinn),
 *  Copilot's own prior answers read as 'assistant', and the question is
 *  always last. */
function toTurnMessages(
  history: CopilotHistoryEntry[],
  question: string
): AssistantThreadMessage[] {
  return [
    ...history.map((h) => ({
      sender: h.role === 'teammate' ? ('customer' as const) : ('assistant' as const),
      content: h.content,
    })),
    { sender: 'customer' as const, content: question },
  ]
}

export async function handleCopilot({ request }: { request: Request }): Promise<Response> {
  const gate = await gateCopilotRequest(
    request,
    requestSchema,
    'A valid conversationId and question are required'
  )
  if (!gate.ok) return gate.response
  const { parsed, conversationId } = gate

  // Provisioning Quinn's identity is idempotent and, like the sandbox, not a
  // conversation write of its own.
  const assistant = await ensureAssistantPrincipal()
  const messages = toTurnMessages(parsed.history, parsed.question)

  const sse = createSseStream()

  void (async () => {
    try {
      const result = await runAssistantTurn({
        messages,
        assistantPrincipalId: assistant.id,
        // A real conversation id (unlike the sandbox's null) so the turn gets
        // customer-scoped grounding (get_conversation_context, the
        // past-conversation-summaries source); `writeToolPolicy: 'propose'`
        // keeps a write tool from ever executing for real here, turning it
        // into a pending-approval proposal instead (see this file's doc
        // comment).
        conversationId,
        surface: 'copilot',
        sourceTypes: parsed.sourceTypes,
        writeToolPolicy: 'propose',
        signal: request.signal,
        onTextDelta: (text) =>
          sse.send(COPILOT_EVENTS.delta, { text } satisfies CopilotDeltaPayload),
        onActivity: (activity) =>
          sse.send(COPILOT_EVENTS.activity, {
            status: activityToStatus(activity),
          } satisfies CopilotActivityPayload),
      })

      if (result.status === 'suppressed') {
        sse.send(COPILOT_EVENTS.final, {
          text: '',
          citations: [],
          internalSourced: false,
          suppressed: result.reason,
          proposedActions: [],
        } satisfies CopilotFinalPayload)
      } else {
        sse.send(COPILOT_EVENTS.final, {
          text: result.text,
          citations: result.citations,
          internalSourced: result.internalSourced,
          proposedActions: result.proposedActions ?? [],
        } satisfies CopilotFinalPayload)
      }
    } catch (error) {
      if (!request.signal.aborted) {
        log.error({ err: error }, 'copilot turn failed')
        sse.send(COPILOT_EVENTS.error, {
          code: 'TURN_FAILED',
          message: 'Copilot run failed',
        } satisfies CopilotErrorPayload)
      }
    } finally {
      sse.close()
    }
  })()

  return new Response(sse.stream, { headers: SSE_RESPONSE_HEADERS })
}

export const Route = createFileRoute('/api/admin/assistant/copilot')({
  server: {
    handlers: {
      POST: handleCopilot,
    },
  },
})
