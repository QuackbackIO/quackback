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
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { isValidTypeId } from '@quackback/ids'
import type { ConversationId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from '@/lib/server/functions/auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { isAssistantConfigured, runCopilotTransform } from '@/lib/server/domains/assistant'
import { assertConversationViewable } from '@/lib/server/domains/conversation/conversation.service'
import { NotFoundError } from '@/lib/shared/errors'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { createSseStream, SSE_RESPONSE_HEADERS } from '@/lib/server/utils/sse'
import { errorResponse, forbiddenResponse } from '@/lib/server/domains/api/responses'
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
  conversationId: z
    .string()
    .refine((v) => isValidTypeId(v, 'conversation'), { message: 'Invalid conversation ID format' }),
  text: z.string().min(1).max(MAX_TEXT_CHARS),
  transform: z.enum(TRANSFORM_KINDS),
})

export async function handleTransform({ request }: { request: Request }): Promise<Response> {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try {
    auth = await requireAuth({ permission: PERMISSIONS.COPILOT_USE })
  } catch {
    return forbiddenResponse('Copilot access required')
  }

  let parsed: z.infer<typeof requestSchema>
  try {
    parsed = requestSchema.parse(await request.json())
  } catch {
    return errorResponse(
      'INVALID_REQUEST',
      'A valid conversationId, text, and transform are required',
      400
    )
  }

  if (!(await isFeatureEnabled('assistantCopilot'))) {
    return errorResponse('NOT_FOUND', 'Copilot is not available', 404)
  }

  if (!isAssistantConfigured()) {
    return errorResponse('AI_NOT_CONFIGURED', 'The assistant is not configured', 503)
  }

  try {
    await enforceAiTokenBudget()
  } catch (err) {
    if (err instanceof TierLimitError) {
      return errorResponse(err.code, err.message, err.statusCode)
    }
    throw err
  }

  const conversationId = parsed.conversationId as ConversationId
  try {
    const actor = await policyActorFromAuth(auth)
    await assertConversationViewable(conversationId, actor)
  } catch (err) {
    if (err instanceof NotFoundError) {
      return errorResponse(err.code, err.message, 404)
    }
    throw err
  }

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
