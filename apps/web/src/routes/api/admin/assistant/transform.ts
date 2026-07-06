/**
 * Quinn Copilot transforms (P2-C.1, COPILOT-SIDEBAR-UX.md "What P2-C adds"): a
 * teammate-facing rewrite over already-composed text, streamed the same way as
 * the copilot route it's cloned from. Two client entry points share this one
 * endpoint: the answer card's "Add to composer & modify" menu and the reply
 * composer's Format chip. Both send whatever text they're acting on plus a
 * transform kind, and get back the rewritten text.
 *
 * The conversation id anchors context + authorization ONLY: `assertConversationViewable`
 * confirms the caller may see this conversation (so a teammate can't probe a
 * transform against a conversation they have no business in), but the
 * transform itself never reads or writes the conversation's messages, and
 * (like copilot.ts) never touches assistant_involvements or unread counts.
 *
 * Same gate order as copilot.ts: `copilot.use` -> the `assistantCopilot` flag
 * -> AI configured -> the AI token budget -> the conversation-viewable check.
 * That shared sequence lives in copilot-gate.ts, alongside copilot.ts.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { runCopilotTransform } from '@/lib/server/domains/assistant'
import { gateCopilotRequest } from '@/lib/server/domains/assistant/copilot-gate'
import { conversationIdSchema } from '@/lib/server/domains/assistant/conversation-id.schema'
import { createSseStream, SSE_RESPONSE_HEADERS } from '@/lib/server/utils/sse'
import { logger } from '@/lib/server/logger'
import {
  TRANSFORM_EVENTS,
  TRANSFORM_KINDS,
  type TransformDeltaPayload,
  type TransformFinalPayload,
  type TransformErrorPayload,
} from '@/lib/shared/assistant/copilot-contract'

const log = logger.child({ component: 'assistant-transform' })

const MAX_TEXT_CHARS = 8000

const requestSchema = z.object({
  conversationId: conversationIdSchema,
  text: z.string().min(1).max(MAX_TEXT_CHARS),
  transform: z.enum(TRANSFORM_KINDS),
})

export async function handleTransform({ request }: { request: Request }): Promise<Response> {
  const gate = await gateCopilotRequest(
    request,
    requestSchema,
    'A valid conversationId, text, and transform are required'
  )
  if (!gate.ok) return gate.response
  const { auth, parsed } = gate

  const sse = createSseStream()

  void (async () => {
    try {
      const result = await runCopilotTransform({
        transform: parsed.transform,
        text: parsed.text,
        principalId: auth.principal.id,
        signal: request.signal,
        onTextDelta: (text) =>
          sse.send(TRANSFORM_EVENTS.delta, { text } satisfies TransformDeltaPayload),
      })
      sse.send(TRANSFORM_EVENTS.final, { text: result.text } satisfies TransformFinalPayload)
    } catch (error) {
      if (!request.signal.aborted) {
        log.error({ err: error }, 'copilot transform failed')
        sse.send(TRANSFORM_EVENTS.error, {
          code: 'TRANSFORM_FAILED',
          message: 'Transform failed',
        } satisfies TransformErrorPayload)
      }
    } finally {
      sse.close()
    }
  })()

  return new Response(sse.stream, { headers: SSE_RESPONSE_HEADERS })
}

export const Route = createFileRoute('/api/admin/assistant/transform')({
  server: {
    handlers: {
      POST: handleTransform,
    },
  },
})
