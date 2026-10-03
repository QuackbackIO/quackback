import { createFileRoute } from '@tanstack/react-router'
import {
  chatParamsFromRequestBody,
  toServerSentEventsResponse,
  type StreamChunk,
} from '@tanstack/ai'
import { z } from 'zod'
import { requireAuth, policyActorFromAuth } from '@/lib/server/functions/auth-helpers'
import { isAuthDenialError } from '@/lib/server/functions/auth-errors'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { DomainException } from '@/lib/shared/errors'
import { errorResponse, forbiddenResponse } from '@/lib/server/domains/api/responses'
import {
  streamAssistantTurn,
  type AssistantTurnResult,
} from '@/lib/server/domains/assistant/assistant.runtime'
import { ensureAssistantPrincipal } from '@/lib/server/domains/assistant/assistant.principal'
import {
  aguiThreadMessages,
  runStartedChunk,
  runFinishedChunk,
  withSseKeepalive,
} from '@/lib/server/domains/assistant/agui'
import { assertWorkspaceCopilotAvailable } from '@/lib/server/domains/assistant/workspace-copilot-gate'
import {
  acquireWorkspaceTurn,
  completeWorkspaceTurn,
  failWorkspaceTurn,
} from '@/lib/server/domains/assistant/workspace-threads.service'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { requireEntitlement } from '@/lib/server/domains/settings/cloud/entitlements'
import type { WorkspaceCopilotFinalPayload } from '@/lib/shared/assistant/workspace-contract'
import type { JsonValue } from '@/lib/shared/json'

const forwardedPropsSchema = z.object({ threadKey: z.string().max(200) }).strict()
function finalFields(
  result: AssistantTurnResult
): Omit<WorkspaceCopilotFinalPayload, 'threadKey' | 'messageId'> {
  if (result.status === 'suppressed')
    return { text: '', citations: [], proposedActions: [], navigation: [] }
  return {
    text: result.text,
    citations: result.citations as unknown as JsonValue[],
    proposedActions: result.proposedActions,
    navigation: result.navigation ?? [],
  }
}
export async function handleWorkspaceCopilot({ request }: { request: Request }): Promise<Response> {
  let auth
  try {
    auth = await requireAuth({ permission: PERMISSIONS.COPILOT_USE })
  } catch (error) {
    if (isAuthDenialError(error)) return forbiddenResponse('Copilot access required')
    throw error
  }
  const actor = await policyActorFromAuth(auth)
  let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>,
    threadKey: string,
    question: string
  try {
    params = await chatParamsFromRequestBody(await request.json())
    threadKey = forwardedPropsSchema.parse(params.forwardedProps).threadKey
    // Client history is never model input. Only the final user request enters persistence.
    const last = params.messages.at(-1)
    if (last?.role !== 'user')
      return errorResponse('INVALID_REQUEST', 'A question is required', 400)
    const messages = aguiThreadMessages([last], { maxTurns: 1, maxChars: 4001 })
    question = messages[0]?.content ?? ''
    if (!question.trim() || question.length > 4000)
      return errorResponse('INVALID_REQUEST', 'A question is required', 400)
  } catch {
    return errorResponse('INVALID_REQUEST', 'A valid conversation and question are required', 400)
  }
  try {
    await assertWorkspaceCopilotAvailable(actor)
    await requireEntitlement('aiDrafts')
    await enforceAiTokenBudget()
    const assistant = await ensureAssistantPrincipal()
    const turn = await acquireWorkspaceTurn(actor, threadKey, params.runId, question)
    const wire = { threadId: params.threadId, runId: params.runId }
    if (turn.status === 'completed') {
      async function* replay(): AsyncGenerator<StreamChunk> {
        yield runStartedChunk(wire)
        yield runFinishedChunk(wire, turn.status === 'completed' ? turn.payload : undefined)
      }
      return toServerSentEventsResponse(replay())
    }
    const { leaseToken } = turn
    const stream = streamAssistantTurn({
      input: {
        role: 'workspace_assistant',
        surface: 'workspace',
        actor,
        actorPrincipalId: auth.principal.id,
        assistantPrincipalId: assistant.id,
        conversationId: null,
        ticketId: null,
        workspaceThreadKey: threadKey,
        latestCustomerMessageId: turn.messageId,
        messages: turn.messages,
        signal: request.signal,
      },
      wire,
      buildFinalPayload: async (result) =>
        completeWorkspaceTurn(actor, threadKey, params.runId, leaseToken, finalFields(result)),
      mapError: () => ({ code: 'TURN_FAILED', message: 'Copilot run failed' }),
    })
    async function* settled(): AsyncGenerator<StreamChunk> {
      try {
        yield* stream
      } finally {
        await failWorkspaceTurn(threadKey, params.runId, leaseToken)
      }
    }
    return withSseKeepalive(toServerSentEventsResponse(settled()))
  } catch (error) {
    if (error instanceof DomainException)
      return errorResponse(error.code, error.message, error.statusCode)
    throw error
  }
}
export const Route = createFileRoute('/api/admin/assistant/workspace')({
  server: { handlers: { POST: handleWorkspaceCopilot } },
})
