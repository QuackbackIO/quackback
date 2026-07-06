/**
 * Quinn Copilot: a private, teammate-facing Q&A sidebar in the inbox
 * conversation panel (COPILOT-SIDEBAR-UX.md). Streams a single turn scoped to
 * a real conversation, for grounding (get_conversation_context and the
 * customer-scoped past-conversation summaries source) and for the retrieval
 * ceiling (surface 'copilot' resolves to the 'team' ContentAudience), but
 * NEVER writes to it: no conversation message, no assistant_involvements row,
 * no unread-count change. Those side effects live entirely in
 * assistant.orchestrator.ts's runAssistantTurnForConversation, which this
 * route never calls; it calls the runtime seam (runAssistantTurn) directly,
 * exactly as the admin sandbox does. Write tools are additionally forced to
 * simulate (never execute for real) regardless of the assistantActions
 * setting: a copilot turn is a teammate asking Quinn a question about the
 * conversation, never Quinn acting in it.
 *
 * Gated on `copilot.use` (the authz matrix picks this up automatically) and
 * the `assistantCopilot` flag, mirroring sandbox.ts's SSE shape otherwise.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { isValidTypeId } from '@quackback/ids'
import type { ConversationId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from '@/lib/server/functions/auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import {
  isAssistantConfigured,
  runAssistantTurn,
  ensureAssistantPrincipal,
  type AssistantActivity,
  type AssistantThreadMessage,
} from '@/lib/server/domains/assistant'
import { assertConversationViewable } from '@/lib/server/domains/conversation/conversation.service'
import { NotFoundError } from '@/lib/shared/errors'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { createSseStream, SSE_RESPONSE_HEADERS } from '@/lib/server/utils/sse'
import { logger } from '@/lib/server/logger'
import {
  COPILOT_EVENTS,
  type CopilotDeltaPayload,
  type CopilotActivityPayload,
  type CopilotFinalPayload,
  type CopilotErrorPayload,
} from '@/lib/shared/assistant/copilot-contract'

const log = logger.child({ component: 'assistant-copilot' })

const MAX_QUESTION_CHARS = 4000
const MAX_HISTORY_TURNS = 20

const requestSchema = z.object({
  conversationId: z
    .string()
    .refine((v) => isValidTypeId(v, 'conversation'), { message: 'Invalid conversation ID format' }),
  question: z.string().min(1).max(MAX_QUESTION_CHARS),
  history: z
    .array(
      z.object({
        role: z.enum(['teammate', 'copilot']),
        content: z.string().min(1).max(MAX_QUESTION_CHARS),
      })
    )
    .max(MAX_HISTORY_TURNS)
    .default([]),
  sourceTypes: z.array(z.enum(['article', 'post', 'snippet', 'summary'])).optional(),
})

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status })
}

/** Map the teammate's prior turns + new question onto the runtime's message
 *  vocabulary: a teammate turn reads as 'customer' (the one asking Quinn),
 *  Copilot's own prior answers read as 'assistant', and the question is
 *  always last. */
function toTurnMessages(
  history: Array<{ role: 'teammate' | 'copilot'; content: string }>,
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

/** Mirrors assistant.orchestrator.ts's publishActivity status mapping: the
 *  widget's activity vocabulary, reused verbatim for the sidebar's status line. */
function activityStatus(activity: AssistantActivity): CopilotActivityPayload['status'] {
  if (activity.kind === 'thinking') return 'thinking'
  return activity.tool === 'search_knowledge' ? 'searching_kb' : 'reviewing_conversation'
}

export async function handleCopilot({ request }: { request: Request }): Promise<Response> {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try {
    auth = await requireAuth({ permission: PERMISSIONS.COPILOT_USE })
  } catch {
    return jsonError(403, 'FORBIDDEN', 'Copilot access required')
  }

  let parsed: z.infer<typeof requestSchema>
  try {
    parsed = requestSchema.parse(await request.json())
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'A valid conversationId and question are required')
  }

  if (!(await isFeatureEnabled('assistantCopilot'))) {
    return jsonError(404, 'NOT_FOUND', 'Copilot is not available')
  }

  if (!isAssistantConfigured()) {
    return jsonError(503, 'AI_NOT_CONFIGURED', 'The assistant is not configured')
  }

  try {
    await enforceAiTokenBudget()
  } catch (err) {
    if (err instanceof TierLimitError) {
      return jsonError(err.statusCode, err.code, err.message)
    }
    throw err
  }

  const conversationId = parsed.conversationId as ConversationId
  try {
    const actor = await policyActorFromAuth(auth)
    await assertConversationViewable(conversationId, actor)
  } catch (err) {
    if (err instanceof NotFoundError) {
      return jsonError(404, err.code, err.message)
    }
    throw err
  }

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
        // past-conversation-summaries source); `simulate: true` keeps write
        // tools from ever executing for real regardless.
        conversationId,
        surface: 'copilot',
        sourceTypes: parsed.sourceTypes,
        simulate: true,
        signal: request.signal,
        onTextDelta: (text) =>
          sse.send(COPILOT_EVENTS.delta, { text } satisfies CopilotDeltaPayload),
        onActivity: (activity) =>
          sse.send(COPILOT_EVENTS.activity, {
            status: activityStatus(activity),
          } satisfies CopilotActivityPayload),
      })

      if (result.status === 'suppressed') {
        sse.send(COPILOT_EVENTS.final, {
          text: '',
          citations: [],
          internalSourced: false,
          suppressed: result.reason,
        } satisfies CopilotFinalPayload)
      } else {
        sse.send(COPILOT_EVENTS.final, {
          text: result.text,
          citations: result.citations,
          internalSourced: result.internalSourced,
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
