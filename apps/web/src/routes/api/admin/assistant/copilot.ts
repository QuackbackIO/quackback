/**
 * Quinn Copilot: a private, teammate-facing Q&A sidebar in the inbox item
 * panel (COPILOT-SIDEBAR-UX.md; item-scoped per unified inbox §2.9). Streams
 * a single turn scoped to a real conversation OR a real ticket — exactly one,
 * see `item-ref.schema.ts` — for grounding (the customer-scoped
 * past-conversation-summaries source on the conversation branch, the ticket
 * context block on the ticket branch — see assistant.runtime.ts's
 * `runAssistantTurn`) and for the retrieval ceiling (surface 'copilot'
 * resolves to the 'team' ContentAudience either way). This route never writes
 * to the conversation/ticket itself and never opens or touches an
 * assistant_involvements row: those side effects live entirely in
 * assistant.orchestrator.ts's runAssistantTurnForConversation, which this
 * route never calls; it calls the runtime seam (runAssistantTurn) directly,
 * exactly as the admin sandbox does.
 *
 * ACTION tools are forced to `writeToolPolicy: 'propose'` (see
 * `resolveEffectiveToolMode`) regardless of the assistantActions setting and
 * each tool's configured mode: a copilot turn is a teammate asking Quinn a
 * question about the conversation, never Quinn acting in it directly, so a
 * write-tool call turns into a pending-approval proposal instead of running
 * for real (P2-C.4, "act-on-approval"). The ONE exception is a metadata write
 * (`set_attribute` — recording a classification attribute, `metadataWrite` on
 * its spec): that is not an action, is guarded by the write path's AI-precedence
 * rule, and runs autonomously here like on the widget surface — but only within
 * the asking teammate's own permission ceiling (`askerActor` below): tools execute
 * under Quinn's actor, so a teammate who could not set the attribute themselves
 * gets a proposal instead, whose approval flow re-checks the approver's
 * permissions. So proposing is ONE documented exception
 * to "never writes to it" and metadata classification is the OTHER: a proposal
 * inserts a real `assistant_pending_actions` row and an accompanying internal
 * note on the conversation announcing it (surfacePendingActionNote, so other
 * teammates see the proposal in the thread without polling), while an
 * autonomous metadata write sets the attribute via the single write path
 * (src:'ai', never overwriting a human value). No OTHER conversation message is
 * written and no involvement is opened. `proposedActions` on the final payload
 * mirrors what got proposed, straight off the tool context's ledger.
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
import { withAssistantItemRef } from '@/lib/server/domains/assistant/item-ref.schema'
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

// Backward compatible: the pre-§2.9 client only ever sends `conversationId`,
// which is still just the schema's first union branch (see
// `withAssistantItemRef`'s doc comment).
const requestSchema = withAssistantItemRef({
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
    'A valid conversationId or ticketId, and a question, are required'
  )
  if (!gate.ok) return gate.response
  const { auth, actor, parsed, conversationId, ticketId } = gate

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
        // A real conversation OR ticket id (unlike the sandbox's null-null),
        // never both — so the turn gets item-scoped grounding (the
        // past-conversation-summaries source on the conversation branch, the
        // ticket context block on the ticket branch; see this file's doc
        // comment). `writeToolPolicy: 'propose'` keeps a write tool from ever
        // executing for real here, turning it into a pending-approval
        // proposal instead.
        conversationId,
        ticketId,
        surface: 'copilot',
        // Attributes this turn to the asking teammate in the usage log, for
        // the per-teammate breakdown in analytics/copilot-usage.ts — Quinn's
        // own principal id above never identifies the human on the other end.
        actorPrincipalId: auth.principal.id,
        // The gate's resolved actor, doubling as the asking teammate's
        // permission ceiling: it bounds the metadata-write exemption from
        // 'propose' (see this file's doc comment), so a direct set_attribute
        // only fires when THIS teammate could set it themselves.
        askerActor: actor,
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
          // No text, so no action buttons render either way; the neutral
          // default keeps the payload well-formed.
          answerType: 'draft_reply',
        } satisfies CopilotFinalPayload)
      } else {
        sse.send(COPILOT_EVENTS.final, {
          text: result.text,
          citations: result.citations,
          internalSourced: result.internalSourced,
          proposedActions: result.proposedActions ?? [],
          answerType: result.answerType,
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
