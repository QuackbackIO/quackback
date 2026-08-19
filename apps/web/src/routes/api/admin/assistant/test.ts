/**
 * Test agent sandbox: an admin-only preview that runs the exact production turn
 * seam (`streamAssistantTurn` -> `runAssistantTurn`) against live config with
 * `conversationId: null` + `simulate: true` — a turn that never writes, never
 * audits, and never touches the inbox. Unlike copilot.ts this gates on
 * `settings.manage` (not `copilot.use`) and has NO item ref (the sandbox is not
 * scoped to any conversation or ticket), so it parses the AG-UI body directly
 * rather than through `gateCopilotAguiRequest`.
 *
 * WIRE: TanStack AI's AG-UI protocol (as copilot.ts). The client POSTs a
 * `RunAgentInput` whose messages are the test thread and whose forwardedProps
 * carry the two sandbox selectors (`channel`, `agent`); the response is
 * `toServerSentEventsResponse(streamAssistantTurn(...))`. The terminal
 * RUN_FINISHED.result carries the client-safe `AssistantTestFinalPayload`
 * (built by `buildFinalPayload` below), which is an explicit allowlist —
 * hidden prompts, instruction bodies, reasoning, tool args, and tool results
 * never cross the boundary. Failures end the stream with a coded RUN_ERROR.
 */
import { createFileRoute } from '@tanstack/react-router'
import { toServerSentEventsResponse, chatParamsFromRequestBody } from '@tanstack/ai'
import { z } from 'zod'
import {
  ensureAssistantPrincipal,
  isAssistantConfigured,
  streamAssistantTurn,
  type AssistantTurnInput,
  type AssistantTurnResult,
  type AssistantTurnTrace,
} from '@/lib/server/domains/assistant'
import { aguiThreadMessages } from '@/lib/server/domains/assistant/agui'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { requireAuth } from '@/lib/server/functions/auth-helpers'
import { isAuthDenialError } from '@/lib/server/functions/auth-errors'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  ASSISTANT_TEST_AGENTS,
  ASSISTANT_TEST_CHANNELS,
  ASSISTANT_TEST_MAX_CONTENT_CHARS,
  ASSISTANT_TEST_MAX_MESSAGES,
  type AssistantTestCitation,
  type AssistantTestFinalPayload,
  type AssistantTestTrace,
} from '@/lib/shared/assistant/test-agent-contract'

// The two sandbox selectors ride the AG-UI request's forwardedProps; the test
// thread is the AG-UI messages envelope itself.
const forwardedPropsSchema = z.object({
  channel: z.enum(ASSISTANT_TEST_CHANNELS).default('widget'),
  agent: z.enum(ASSISTANT_TEST_AGENTS).default('agent'),
})

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status })
}

/**
 * Copy only the Test agent trace contract, excluding runtime fallback detail.
 * The customer-facing role carries tone/length presets; the copilot role does
 * not (D11), so those two fields are asserted present only for
 * `customer_support` and omitted for `copilot_qa`.
 */
function toSafeTrace(trace: AssistantTurnTrace): AssistantTestTrace {
  const base = {
    promptVersion: trace.promptVersion,
    configRevision: trace.configRevision,
    appliedGuidance: trace.appliedGuidance.map(({ id, name }) => ({ id, name })),
    toolCalls: trace.toolCalls.map(({ name, outcome }) => ({ name, outcome })),
  }

  if (trace.role === 'customer_support') {
    if (!trace.tone || !trace.responseLength) {
      throw new Error('Test agent runtime returned a customer trace without presets')
    }
    return {
      ...base,
      role: 'customer_support',
      tone: trace.tone,
      responseLength: trace.responseLength,
    }
  }

  if (trace.role === 'copilot_qa') {
    return { ...base, role: 'copilot_qa' }
  }

  throw new Error(`Test agent runtime returned an unsupported role "${trace.role}"`)
}

/** Map a completed turn onto the client-safe final payload (the allowlist). A
 *  suppressed turn should never happen in the sandbox (its single customer turn
 *  can't trip the silence rule), so it fails the run rather than emit a card. */
function toFinalPayload(result: AssistantTurnResult): AssistantTestFinalPayload {
  if (result.status === 'suppressed') {
    throw new Error('Test agent turn was unexpectedly suppressed')
  }
  const citations: AssistantTestCitation[] = result.citations.map(({ type, id, title, url }) => ({
    type,
    id,
    title,
    url,
  }))
  return {
    text: result.text,
    citations,
    escalation: result.escalation ? { reason: result.escalation.reason, mode: 'handoff' } : null,
    trace: toSafeTrace(result.trace),
  }
}

export async function handleTestAgent({ request }: { request: Request }): Promise<Response> {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try {
    auth = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
  } catch (error) {
    if (!isAuthDenialError(error)) throw error
    return jsonError(403, 'FORBIDDEN', 'Assistant management access required')
  }

  let forwarded: z.infer<typeof forwardedPropsSchema>
  let agui: { messages: ReadonlyArray<unknown>; threadId: string; runId: string }
  try {
    const params = await chatParamsFromRequestBody(await request.json())
    forwarded = forwardedPropsSchema.parse(params.forwardedProps)
    agui = { messages: params.messages, threadId: params.threadId, runId: params.runId }
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'A valid customer conversation is required')
  }

  // The AG-UI history maps onto the runtime's thread vocabulary; the test turn
  // must end on a customer message (the thing Quinn is answering).
  const messages = aguiThreadMessages(agui.messages, {
    maxTurns: ASSISTANT_TEST_MAX_MESSAGES,
    maxChars: ASSISTANT_TEST_MAX_CONTENT_CHARS,
  })
  if (messages.length === 0 || messages.at(-1)?.sender !== 'customer') {
    return jsonError(400, 'INVALID_REQUEST', 'The final message must be from the customer')
  }

  if (!isAssistantConfigured()) {
    return jsonError(503, 'AI_NOT_CONFIGURED', 'The assistant is not configured')
  }

  try {
    await enforceAiTokenBudget()
  } catch (error) {
    if (error instanceof TierLimitError) {
      return Response.json(error.toResponseBody(), { status: error.statusCode })
    }
    throw error
  }

  const assistant = await ensureAssistantPrincipal()

  // The discriminated turn contract forbids selecting a customer role with the
  // team surface (and vice versa), so each agent builds its own complete input.
  // Both stay `conversationId: null` + `simulate: true` — a sandbox turn that
  // never writes, never audits, and never touches the inbox.
  const common = {
    messages,
    assistantPrincipalId: assistant.id,
    conversationId: null,
    simulate: true,
    signal: request.signal,
  }
  const input: AssistantTurnInput =
    forwarded.agent === 'copilot'
      ? {
          ...common,
          role: 'copilot_qa',
          surface: 'copilot',
          // Attributes this test turn to the teammate running it, mirroring the
          // live copilot route.
          actorPrincipalId: auth.principal.id,
        }
      : {
          ...common,
          role: 'customer_support',
          surface: forwarded.channel,
        }

  return toServerSentEventsResponse(
    streamAssistantTurn({
      input,
      wire: { threadId: agui.threadId, runId: agui.runId },
      buildFinalPayload: toFinalPayload,
      mapError: () => ({ code: 'TURN_FAILED', message: 'The test run failed' }),
    })
  )
}

export const Route = createFileRoute('/api/admin/assistant/test')({
  server: {
    handlers: {
      POST: handleTestAgent,
    },
  },
})
