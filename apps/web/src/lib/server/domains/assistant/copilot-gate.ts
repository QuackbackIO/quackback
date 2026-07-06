/**
 * Shared gate sequence for the two teammate-facing Copilot SSE routes
 * (copilot.ts, transform.ts): `copilot.use` permission -> body parse against
 * the caller's own zod schema -> the `assistantCopilot` flag -> the assistant
 * being configured -> the AI token budget -> `assertConversationViewable`,
 * each already mapped onto the route's error envelope (forbiddenResponse /
 * errorResponse). Both routes ran this exact sequence verbatim before this;
 * only the request schema and the invalid-request message differ between
 * them, so this is generic over both.
 *
 * sandbox.ts is deliberately NOT a caller: it has no conversation to assert
 * viewability against and gates on a different permission (`settings.manage`,
 * not `copilot.use`), so its shape genuinely differs rather than merely
 * duplicating this one.
 */
import type { z } from 'zod'
import type { ConversationId } from '@quackback/ids'
import {
  requireAuth,
  policyActorFromAuth,
  type AuthContext,
} from '@/lib/server/functions/auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
// The barrel, not a relative import to assistant.runtime.ts directly: every
// route test that exercises this gate mocks `isAssistantConfigured` at
// '@/lib/server/domains/assistant' (the same seam copilot.ts and transform.ts
// already imported it through), so this module needs to resolve through the
// same specifier to stay mockable. index.ts does not re-export this module,
// so there is no import cycle.
import { isAssistantConfigured } from '@/lib/server/domains/assistant'
import { assertConversationViewable } from '@/lib/server/domains/conversation/conversation.service'
import { NotFoundError } from '@/lib/shared/errors'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { errorResponse, forbiddenResponse } from '@/lib/server/domains/api/responses'

export interface CopilotGateOk<T> {
  ok: true
  auth: AuthContext
  parsed: T
  conversationId: ConversationId
}

export interface CopilotGateFailed {
  ok: false
  /** Already-shaped error Response; the caller returns this unchanged. */
  response: Response
}

export type CopilotGateResult<T> = CopilotGateOk<T> | CopilotGateFailed

/**
 * Run the shared gate. `schema` is the caller's own request shape (it must
 * carry a `conversationId` field, validated the same way by both routes
 * today — see `conversation-id.schema.ts`); `invalidRequestMessage` is the
 * route-specific 400 body text a malformed request gets. Returns either the
 * gate's outputs for the caller to continue its own turn-specific logic, or
 * a Response the caller must return immediately, untouched.
 */
export async function gateCopilotRequest<T extends { conversationId: string }>(
  request: Request,
  schema: z.ZodType<T>,
  invalidRequestMessage: string
): Promise<CopilotGateResult<T>> {
  let auth: AuthContext
  try {
    auth = await requireAuth({ permission: PERMISSIONS.COPILOT_USE })
  } catch {
    return { ok: false, response: forbiddenResponse('Copilot access required') }
  }

  let parsed: T
  try {
    parsed = schema.parse(await request.json())
  } catch {
    return { ok: false, response: errorResponse('INVALID_REQUEST', invalidRequestMessage, 400) }
  }

  if (!(await isFeatureEnabled('assistantCopilot'))) {
    return { ok: false, response: errorResponse('NOT_FOUND', 'Copilot is not available', 404) }
  }

  if (!isAssistantConfigured()) {
    return {
      ok: false,
      response: errorResponse('AI_NOT_CONFIGURED', 'The assistant is not configured', 503),
    }
  }

  try {
    await enforceAiTokenBudget()
  } catch (err) {
    if (err instanceof TierLimitError) {
      return { ok: false, response: errorResponse(err.code, err.message, err.statusCode) }
    }
    throw err
  }

  const conversationId = parsed.conversationId as ConversationId
  try {
    const actor = await policyActorFromAuth(auth)
    await assertConversationViewable(conversationId, actor)
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { ok: false, response: errorResponse(err.code, err.message, 404) }
    }
    throw err
  }

  return { ok: true, auth, parsed, conversationId }
}
