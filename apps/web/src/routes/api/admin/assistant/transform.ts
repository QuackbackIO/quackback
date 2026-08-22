/**
 * Copilot transforms (P2-C.1, COPILOT-SIDEBAR-UX.md "What P2-C adds"): a
 * teammate-facing rewrite over already-composed text, streamed the same way as
 * the copilot route it's cloned from. Two client entry points share this one
 * endpoint: the answer card's "Add to composer & modify" menu and the reply
 * composer's Improve menu. Both send whatever text they're acting on plus a
 * transform kind, and get back the rewritten text.
 *
 * The item id (conversation OR ticket — exactly one, see `item-ref.schema.ts`)
 * anchors context + authorization ONLY: `assertConversationViewable` /
 * `assertTicketViewable` confirms the caller may see this item (so a teammate
 * can't probe a transform against one they have no business in), but the
 * transform itself never reads or writes the item's messages, and (like
 * copilot.ts) never touches assistant_involvements or unread counts.
 *
 * WIRE: TanStack AI's AG-UI protocol (as copilot.ts). The client POSTs a
 * `RunAgentInput` whose forwardedProps carry the item ref and the transform
 * kind, and whose trailing user message is the SOURCE TEXT to rewrite; the
 * response is `toServerSentEventsResponse(streamSynthesisToWire(...))`: one
 * canonical RUN_STARTED/RUN_FINISHED pair around the rewrite's committed model
 * chunks, with the `TransformFinalPayload` ({ text }) on the standard
 * RUN_FINISHED.result slot. Failures end the stream with a coded RUN_ERROR.
 *
 * Same gate order as copilot.ts: `copilot.use` -> AI configured -> the AI
 * token budget -> the item-viewable check. That shared sequence lives in
 * copilot-gate.ts (`gateCopilotAguiRequest`).
 */
import { createFileRoute } from '@tanstack/react-router'
import { toServerSentEventsResponse } from '@tanstack/ai'
import { z } from 'zod'
import { runCopilotTransform } from '@/lib/server/domains/assistant'
import { gateCopilotAguiRequest } from '@/lib/server/domains/assistant/copilot-gate'
import { aguiThreadMessages, streamSynthesisToWire } from '@/lib/server/domains/assistant/agui'
import { withAssistantItemRef } from '@/lib/server/domains/assistant/item-ref.schema'
import { errorResponse } from '@/lib/server/domains/api/responses'
import { logger } from '@/lib/server/logger'
import {
  TRANSFORM_KINDS,
  type TransformFinalPayload,
} from '@/lib/shared/assistant/copilot-contract'

const log = logger.child({ component: 'assistant-transform' })

const MAX_TEXT_CHARS = 8000

// The transform kind rides forwardedProps; the SOURCE TEXT is the AG-UI
// request's trailing user message (the AG-UI-native shape — the thing being
// rewritten reads as the turn's user turn, not a bespoke body field).
// `language` is the `translate` kind's target (English name, see
// TRANSLATE_LANGUAGES); optional on the wire, required for that kind below.
const forwardedPropsSchema = withAssistantItemRef({
  transform: z.enum(TRANSFORM_KINDS),
  language: z.string().trim().min(1).max(60).optional(),
})

export async function handleTransform({ request }: { request: Request }): Promise<Response> {
  const gate = await gateCopilotAguiRequest(
    request,
    forwardedPropsSchema,
    'A valid conversationId or ticketId, a transform, and source text are required'
  )
  if (!gate.ok) return gate.response
  const { auth, parsed, agui } = gate

  // A language-less translate can only produce a broken instruction, so it is
  // rejected here rather than left for the transform module's throw.
  if (parsed.transform === 'translate' && !parsed.language) {
    return errorResponse('INVALID_REQUEST', 'A target language is required for translate', 400)
  }

  // The source text is the trailing user turn, length-capped exactly as the
  // old `text` body field was (over-cap truncates, matching the AG-UI history
  // contract, rather than rejecting).
  const [source] = aguiThreadMessages(agui.messages, { maxTurns: 1, maxChars: MAX_TEXT_CHARS })
  if (!source || source.sender !== 'customer') {
    return errorResponse('INVALID_REQUEST', 'Source text is required', 400)
  }

  return toServerSentEventsResponse(
    streamSynthesisToWire({
      wire: { threadId: agui.threadId, runId: agui.runId },
      run: (wireSink) =>
        runCopilotTransform({
          transform: parsed.transform,
          text: source.content,
          principalId: auth.principal.id,
          language: parsed.language,
          signal: request.signal,
          wireSink,
        }),
      buildFinalPayload: (result): TransformFinalPayload => ({ text: result.text }),
      mapError: (err) => {
        log.error({ err }, 'copilot transform failed')
        return { code: 'TRANSFORM_FAILED', message: 'Transform failed' }
      },
    })
  )
}

export const Route = createFileRoute('/api/admin/assistant/transform')({
  server: {
    handlers: {
      POST: handleTransform,
    },
  },
})
