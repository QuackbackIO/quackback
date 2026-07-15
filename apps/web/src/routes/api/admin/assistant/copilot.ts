/**
 * Copilot: a private, teammate-facing Q&A sidebar in the inbox item
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
 * `resolveEffectiveToolMode`) regardless of the assistantTools setting and
 * each tool's configured mode: a copilot turn is a teammate asking Quinn a
 * question about the conversation, never Quinn acting in it directly, so a
 * write-tool call turns into a pending-approval proposal instead of running
 * for real (P2-C.4, "act-on-approval"). This includes metadata writes such as
 * `set_attribute`: every state change requires an explicit teammate decision.
 * Proposing is the one documented exception to "never writes to it": a proposal
 * inserts a real `assistant_pending_actions` row and an accompanying internal
 * note on the conversation announcing it (surfacePendingActionNote, so other
 * teammates see the proposal in the thread without polling). No other conversation message is
 * written and no involvement is opened. `proposedActions` on the final payload
 * mirrors what got proposed, straight off the tool context's ledger.
 *
 * Gated on `copilot.use` (the authz matrix picks this up automatically) and
 * the `inboxAi` flag, mirroring sandbox.ts's SSE shape otherwise.
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
import { gateCopilotRequest, streamAssistantSse } from '@/lib/server/domains/assistant/copilot-gate'
import { withAssistantItemRef } from '@/lib/server/domains/assistant/item-ref.schema'
import { isCopilotCapabilityEnabled } from '@/lib/server/domains/settings/settings.service'
import { errorResponse } from '@/lib/server/domains/api/responses'
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
  const { auth, parsed, conversationId, ticketId } = gate

  // Copilot Q&A capability gate (v3 config). Layered past inboxAi the same way
  // suggest.ts layers assistantProactiveSuggestions: the same 404 NOT_FOUND
  // shape, one config knob up. A workspace can keep Copilot's identity while
  // turning its Q&A off.
  if (!(await isCopilotCapabilityEnabled('qa'))) {
    return errorResponse('NOT_FOUND', 'Copilot Q&A is not available', 404)
  }

  // Provisioning Quinn's identity is idempotent and, like the sandbox, not a
  // conversation write of its own.
  const assistant = await ensureAssistantPrincipal()
  const messages = toTurnMessages(parsed.history, parsed.question)

  return streamAssistantSse({
    request,
    error: {
      event: COPILOT_EVENTS.error,
      payload: { code: 'TURN_FAILED', message: 'Copilot run failed' } satisfies CopilotErrorPayload,
    },
    logError: (err) => log.error({ err }, 'copilot turn failed'),
    run: async (sse) => {
      const result = await runAssistantTurn({
        messages,
        assistantPrincipalId: assistant.id,
        role: 'copilot_qa',
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
        sourceTypes: parsed.sourceTypes,
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
    },
  })
}

export const Route = createFileRoute('/api/admin/assistant/copilot')({
  server: {
    handlers: {
      POST: handleCopilot,
    },
  },
})
