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
 * route never calls; it calls the runtime seam directly, exactly as the
 * admin sandbox does.
 *
 * WIRE: TanStack AI's AG-UI protocol. The client (useChat) POSTs a
 * `RunAgentInput` — its accumulated message history plus `forwardedProps`
 * carrying the item ref and source filter — and the response is
 * `toServerSentEventsResponse(streamAssistantTurn(...))`: one canonical
 * RUN_STARTED/RUN_FINISHED pair around the turn's committed model chunks
 * (structured-JSON text deltas, TOOL_CALL_*), STEP_STARTED/STEP_FINISHED
 * activity status lines, and a terminal RUN_FINISHED whose standard `result`
 * slot carries the post-processed `CopilotFinalPayload`. Failures end the
 * stream with a coded RUN_ERROR frame instead.
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
 * teammates see the proposal in the thread without polling). No other
 * conversation message is written and no involvement is opened.
 * `proposedActions` on the final payload mirrors what got proposed, straight
 * off the tool context's ledger.
 *
 * Gated on `copilot.use` (the authz matrix picks this up automatically) and
 * the `inboxAi` flag. The shared gate sequence (permission -> AG-UI body parse
 * -> flag -> configured -> token budget -> item-viewable) lives in
 * copilot-gate.ts (`gateCopilotAguiRequest`), alongside transform.ts.
 */
import { createFileRoute } from '@tanstack/react-router'
import { toServerSentEventsResponse } from '@tanstack/ai'
import { z } from 'zod'
import {
  streamAssistantTurn,
  ensureAssistantPrincipal,
  type AssistantTurnResult,
} from '@/lib/server/domains/assistant'
import { gateCopilotAguiRequest } from '@/lib/server/domains/assistant/copilot-gate'
import { aguiThreadMessages } from '@/lib/server/domains/assistant/agui'
import { withAssistantItemRef } from '@/lib/server/domains/assistant/item-ref.schema'
import { isCopilotCapabilityEnabled } from '@/lib/server/domains/settings/settings.service'
import { errorResponse } from '@/lib/server/domains/api/responses'
import type { CopilotFinalPayload } from '@/lib/shared/assistant/copilot-contract'

const MAX_QUESTION_CHARS = 4000
const MAX_HISTORY_TURNS = 20

// The route's own fields ride the AG-UI request's forwardedProps; the message
// history is the AG-UI envelope itself (no separate `history` field anymore).
const forwardedPropsSchema = withAssistantItemRef({
  sourceTypes: z.array(z.enum(['article', 'post', 'snippet', 'summary'])).optional(),
})

function toFinalPayload(result: AssistantTurnResult): CopilotFinalPayload {
  if (result.status === 'suppressed') {
    return {
      text: '',
      citations: [],
      internalSourced: false,
      suppressed: result.reason,
      proposedActions: [],
      // No text, so no action buttons render either way; the neutral
      // default keeps the payload well-formed.
      answerType: 'draft_reply',
    }
  }
  return {
    text: result.text,
    citations: result.citations,
    internalSourced: result.internalSourced,
    proposedActions: result.proposedActions ?? [],
    answerType: result.answerType,
  }
}

export async function handleCopilot({ request }: { request: Request }): Promise<Response> {
  const gate = await gateCopilotAguiRequest(
    request,
    forwardedPropsSchema,
    'A valid conversationId or ticketId is required'
  )
  if (!gate.ok) return gate.response
  const { auth, parsed, conversationId, ticketId, agui } = gate

  // Copilot Q&A capability gate (v3 config). Layered past inboxAi: a 404
  // NOT_FOUND shape, one config knob up. A workspace can keep Copilot's
  // identity while turning its Q&A off.
  if (!(await isCopilotCapabilityEnabled('qa'))) {
    return errorResponse('NOT_FOUND', 'Copilot Q&A is not available', 404)
  }

  // The AG-UI history maps onto the runtime's thread vocabulary (teammate
  // turns read as 'customer' — the one asking Quinn); the question is the
  // trailing user turn, length-gated exactly as the old request schema was.
  const messages = aguiThreadMessages(agui.messages, {
    maxTurns: MAX_HISTORY_TURNS + 1,
    maxChars: MAX_QUESTION_CHARS,
  })
  const question = messages.at(-1)
  if (!question || question.sender !== 'customer') {
    return errorResponse('INVALID_REQUEST', 'A question is required', 400)
  }

  // Provisioning Quinn's identity is idempotent and, like the sandbox, not a
  // conversation write of its own.
  const assistant = await ensureAssistantPrincipal()

  return toServerSentEventsResponse(
    streamAssistantTurn({
      input: {
        messages,
        assistantPrincipalId: assistant.id,
        role: 'copilot_qa',
        // A real conversation OR ticket id (unlike the sandbox's null-null),
        // never both — so the turn gets item-scoped grounding (see this
        // file's doc comment). `writeToolPolicy: 'propose'` keeps a write
        // tool from ever executing for real here.
        conversationId,
        ticketId,
        surface: 'copilot',
        // Attributes this turn to the asking teammate in the usage log, for
        // the per-teammate breakdown in analytics/copilot-usage.ts — Quinn's
        // own principal id above never identifies the human on the other end.
        actorPrincipalId: auth.principal.id,
        sourceTypes: parsed.sourceTypes,
        signal: request.signal,
      },
      wire: { threadId: agui.threadId, runId: agui.runId },
      buildFinalPayload: toFinalPayload,
      mapError: () => ({ code: 'TURN_FAILED', message: 'Copilot run failed' }),
    })
  )
}

export const Route = createFileRoute('/api/admin/assistant/copilot')({
  server: {
    handlers: {
      POST: handleCopilot,
    },
  },
})
