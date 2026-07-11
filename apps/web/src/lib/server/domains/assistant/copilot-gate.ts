/**
 * Shared gate sequences for every teammate-facing Copilot entry point, in two
 * shapes for two error contracts:
 *
 * - `gateCopilotRequest`, for the two SSE routes (copilot.ts, transform.ts):
 *   `copilot.use` permission -> body parse against the caller's own zod
 *   schema -> `assertCopilotAvailable` (the `assistantCopilot` flag, then the
 *   assistant being configured) -> the AI token budget -> item-scoped
 *   viewability (`assertConversationViewable` or `assertTicketVisible`,
 *   whichever the parsed request carries — unified inbox §2.9), each already
 *   mapped onto the route's error envelope (forbiddenResponse /
 *   errorResponse). Both routes ran this exact sequence verbatim before this;
 *   only the request schema and the invalid-request message differ between
 *   them, so this is generic over both.
 * - `gateCopilotFn`, for the copilot server fns (copilot-events.ts,
 *   copilot-summary.ts): the same order minus parse and budget, every failure
 *   left as its original throw (see its doc). The Response shape can't just
 *   wrap the throw shape: its parse and budget steps interleave the shared
 *   steps, so the two share `assertCopilotAvailable` and
 *   `resolveViewableItem` instead of one wrapping the other.
 *
 * sandbox.ts is deliberately NOT a caller: it has no conversation to assert
 * viewability against and gates on a different permission (`settings.manage`,
 * not `copilot.use`), so its shape genuinely differs rather than merely
 * duplicating these.
 */
import type { z } from 'zod'
import type { ConversationId, TicketId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import {
  requireAuth,
  policyActorFromAuth,
  type AuthContext,
} from '@/lib/server/functions/auth-helpers'
// The leaf module, not auth-helpers' re-export: route tests mock auth-helpers
// wholesale, and importing the matcher from the pure leaf keeps the REAL
// denial vocabulary in play there instead of a restated copy.
import { isAuthDenialError } from '@/lib/server/functions/auth-errors'
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
 * to reproduce either gate shape's original error exactly (a mapped
 * `errorResponse` in `gateCopilotRequest`, a propagated throw out of
 * `gateCopilotFn`).
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
 * and item viewability differ per gate shape and stay out of this helper;
 * this covers only the two checks both shapes (`gateCopilotRequest`,
 * `gateCopilotFn`) run verbatim.
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
  /**
   * The caller's resolved policy actor (the same one the item-viewability
   * check ran against), so a route can bound further work by the teammate's
   * own permission set — e.g. copilot.ts's `askerActor` ceiling — without
   * re-resolving it.
   */
  actor: Actor
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
 * Item-scoped viewability, the last step of both gate shapes: resolve which
 * branch of the `{ conversationId } | { ticketId }` ref the request carries
 * and assert THAT item is viewable by the actor. Throws the assert helpers'
 * NotFoundError — `gateCopilotRequest` maps it onto its error envelope,
 * `gateCopilotFn` lets it propagate.
 */
async function resolveViewableItem(
  itemRef: { conversationId: string } | { ticketId: string },
  actor: Actor
): Promise<{ conversationId: ConversationId | null; ticketId: TicketId | null }> {
  if ('conversationId' in itemRef) {
    const conversationId = itemRef.conversationId as ConversationId
    await assertConversationViewable(conversationId, actor)
    return { conversationId, ticketId: null }
  }
  const ticketId = itemRef.ticketId as TicketId
  await assertTicketVisible(ticketId, actor)
  return { conversationId: null, ticketId }
}

/**
 * Throw-shaped sibling of `gateCopilotRequest` for the copilot server fns
 * (copilot-events.ts, copilot-summary.ts), which surface every failure as a
 * thrown rejection rather than a mapped Response. Same gate order, minus the
 * body parse (owned by each fn's validator) and the token budget — budget
 * enforcement lives at the model-invocation seam, not this auth gate: an fn
 * that invokes the model does so through a generator that enforces it itself
 * (conversation-summary.service.ts calls `enforceAiTokenBudget` inside both
 * its generators), and an fn that never invokes the model (copilot-events.ts)
 * has nothing to budget. A future fn that calls the model directly must call
 * `enforceAiTokenBudget` itself. The sequence here: `copilot.use` ->
 * `assertCopilotAvailable` -> `policyActorFromAuth` -> item viewability.
 * Failures propagate as their original throws (`requireAuth`'s vocabulary
 * Errors, CopilotUnavailableError, NotFoundError), so each caller's error
 * handling sees exactly what it saw running the sequence inline.
 */
export async function gateCopilotFn(
  itemRef: { conversationId: string } | { ticketId: string }
): Promise<{
  auth: AuthContext
  actor: Actor
  conversationId: ConversationId | null
  ticketId: TicketId | null
}> {
  const auth = await requireAuth({ permission: PERMISSIONS.COPILOT_USE })
  await assertCopilotAvailable()
  const actor = await policyActorFromAuth(auth)
  const { conversationId, ticketId } = await resolveViewableItem(itemRef, actor)
  return { auth, actor, conversationId, ticketId }
}

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
  } catch (err) {
    // Only a genuine denial maps to 403 (isAuthDenialError lives beside
    // requireAuth's throws, so vocabulary and matcher change together).
    // Anything else — a session-store or settings-read failure — is
    // infrastructure and must surface as a 500, never be dressed up as
    // "Copilot access required".
    if (!isAuthDenialError(err)) throw err
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

  const actor = await policyActorFromAuth(auth)
  try {
    const { conversationId, ticketId } = await resolveViewableItem(parsed, actor)
    return { ok: true, auth, actor, parsed, conversationId, ticketId }
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { ok: false, response: errorResponse(err.code, err.message, 404) }
    }
    throw err
  }
}
