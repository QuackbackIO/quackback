/**
 * Shared gate sequence for the two teammate-facing Copilot SSE routes
 * (copilot.ts, transform.ts): `copilot.use` permission -> body parse against
 * the caller's own zod schema -> `assertCopilotAvailable` (the
 * `assistantCopilot` flag, then the assistant being configured) -> the AI
 * token budget -> item-scoped viewability (`assertConversationViewable` or
 * `assertTicketVisible`, whichever the parsed request carries — unified
 * inbox §2.9), each already mapped onto the route's error envelope
 * (forbiddenResponse / errorResponse). Both routes ran this exact sequence
 * verbatim before this; only the request schema and the invalid-request
 * message differ between them, so this is generic over both.
 *
 * sandbox.ts is deliberately NOT a caller: it has no conversation to assert
 * viewability against and gates on a different permission (`settings.manage`,
 * not `copilot.use`), so its shape genuinely differs rather than merely
 * duplicating this one.
 */
import type { z } from 'zod'
import type { ConversationId, TicketId } from '@quackback/ids'
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
import { assertTicketVisible } from '@/lib/server/domains/tickets/ticket.service'
import { NotFoundError } from '@/lib/shared/errors'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { errorResponse, forbiddenResponse } from '@/lib/server/domains/api/responses'

/**
 * Thrown by `assertCopilotAvailable` when either check fails; carries enough
 * to reproduce either call site's original error exactly (a mapped
 * `errorResponse` here, a thrown `Error` in `copilot-summary.ts`).
 */
export class CopilotUnavailableError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'AI_NOT_CONFIGURED',
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'CopilotUnavailableError'
  }
}

/**
 * The `assistantCopilot` flag -> assistant-configured half of the Copilot
 * gate sequence, order load-bearing (the flag is checked first). Permission
 * and item viewability are call-site specific and stay out of this helper;
 * this covers only the two checks every Copilot entry point repeated
 * verbatim: `gateCopilotRequest` below, and both on-demand summary fns in
 * `copilot-summary.ts`.
 */
export async function assertCopilotAvailable(): Promise<void> {
  if (!(await isFeatureEnabled('assistantCopilot'))) {
    throw new CopilotUnavailableError('NOT_FOUND', 'Copilot is not available', 404)
  }
  if (!isAssistantConfigured()) {
    throw new CopilotUnavailableError('AI_NOT_CONFIGURED', 'The assistant is not configured', 503)
  }
}

export interface CopilotGateOk<T> {
  ok: true
  auth: AuthContext
  parsed: T
  /** Set when the request is conversation-scoped; null for a ticket-scoped one. */
  conversationId: ConversationId | null
  /** Set when the request is ticket-scoped; null for a conversation-scoped one. */
  ticketId: TicketId | null
}

export interface CopilotGateFailed {
  ok: false
  /** Already-shaped error Response; the caller returns this unchanged. */
  response: Response
}

export type CopilotGateResult<T> = CopilotGateOk<T> | CopilotGateFailed

/**
 * Run the shared gate. `schema` is the caller's own request shape — either a
 * `conversationId` field (validated as today, see `conversation-id.schema.ts`)
 * or a `ticketId` one (see `item-ref.schema.ts`'s `withAssistantItemRef`, the
 * only kind of schema the two callers actually build); `invalidRequestMessage`
 * is the route-specific 400 body text a malformed request gets. Returns
 * either the gate's outputs for the caller to continue its own turn-specific
 * logic, or a Response the caller must return immediately, untouched.
 */
export async function gateCopilotRequest<
  T extends { conversationId: string } | { ticketId: string },
>(
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

  try {
    await assertCopilotAvailable()
  } catch (err) {
    if (err instanceof CopilotUnavailableError) {
      return { ok: false, response: errorResponse(err.code, err.message, err.statusCode) }
    }
    throw err
  }

  try {
    await enforceAiTokenBudget()
  } catch (err) {
    if (err instanceof TierLimitError) {
      return { ok: false, response: errorResponse(err.code, err.message, err.statusCode) }
    }
    throw err
  }

  let conversationId: ConversationId | null = null
  let ticketId: TicketId | null = null
  try {
    const actor = await policyActorFromAuth(auth)
    if ('conversationId' in parsed) {
      conversationId = parsed.conversationId as ConversationId
      await assertConversationViewable(conversationId, actor)
    } else {
      ticketId = parsed.ticketId as TicketId
      await assertTicketVisible(ticketId, actor)
    }
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { ok: false, response: errorResponse(err.code, err.message, 404) }
    }
    throw err
  }

  return { ok: true, auth, parsed, conversationId, ticketId }
}
