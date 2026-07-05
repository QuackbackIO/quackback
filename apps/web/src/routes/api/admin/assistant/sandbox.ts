/**
 * Assistant test sandbox (admin-only).
 *
 * Streams a single Quinn turn against live config WITHOUT creating any
 * conversation, message, or involvement — sandbox threads never touch the
 * inbox. Mirrors the kb-ask SSE chunk-event style. Gated on `settings.manage`
 * (the same permission that governs the AI settings area), which the authz
 * matrix picks up automatically.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireAuth } from '@/lib/server/functions/auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  isAssistantConfigured,
  runAssistantTurn,
  ensureAssistantPrincipal,
} from '@/lib/server/domains/assistant'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { createSseStream, SSE_RESPONSE_HEADERS } from '@/lib/server/utils/sse'
import { logger } from '@/lib/server/logger'
import { SANDBOX_EVENTS } from '@/lib/shared/assistant/sandbox-contract'
import { ASSISTANT_SURFACES } from '@/lib/shared/assistant/surfaces'

const log = logger.child({ component: 'assistant-sandbox' })

const MAX_MESSAGES = 50
const MAX_CONTENT_CHARS = 4000

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        sender: z.enum(['customer', 'assistant', 'human_agent']),
        content: z.string().min(1).max(MAX_CONTENT_CHARS),
      })
    )
    .min(1)
    .max(MAX_MESSAGES),
  // Lets the admin preview a non-default surface's saved instructions +
  // guidance scoping; defaults to the messenger widget.
  surface: z.enum(ASSISTANT_SURFACES).default('widget'),
})

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status })
}

export async function handleSandbox({ request }: { request: Request }): Promise<Response> {
  try {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  } catch {
    return jsonError(403, 'FORBIDDEN', 'Admin access required')
  }

  let parsed: z.infer<typeof requestSchema>
  try {
    parsed = requestSchema.parse(await request.json())
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'A non-empty messages array is required')
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

  // Provisioning Quinn's identity is idempotent and is not a conversation,
  // message, or involvement — the sandbox creates none of those.
  const assistant = await ensureAssistantPrincipal()

  const sse = createSseStream()

  void (async () => {
    try {
      const result = await runAssistantTurn({
        messages: parsed.messages,
        assistantPrincipalId: assistant.id,
        conversationId: null,
        surface: parsed.surface,
        signal: request.signal,
        onTextDelta: (text) => sse.send(SANDBOX_EVENTS.delta, { text }),
      })

      if (result.status === 'suppressed') {
        sse.send(SANDBOX_EVENTS.final, { text: '', citations: [], suppressed: result.reason })
      } else {
        sse.send(SANDBOX_EVENTS.final, {
          text: result.text,
          citations: result.citations,
          escalation: result.escalation ?? null,
        })
      }
    } catch (error) {
      if (!request.signal.aborted) {
        log.error({ err: error }, 'assistant sandbox turn failed')
        sse.send(SANDBOX_EVENTS.error, { code: 'TURN_FAILED', message: 'Assistant run failed' })
      }
    } finally {
      sse.close()
    }
  })()

  return new Response(sse.stream, { headers: SSE_RESPONSE_HEADERS })
}

export const Route = createFileRoute('/api/admin/assistant/sandbox')({
  server: {
    handlers: {
      POST: handleSandbox,
    },
  },
})
