/**
 * Shared gate sequences for every teammate-facing Copilot entry point, in two
 * shapes for two error contracts:
 *
 * - `gateCopilotAguiRequest`, for the AG-UI streaming routes (copilot.ts,
 *   transform.ts, suggest.ts): `copilot.use` permission -> AG-UI body parse
 *   (`chatParamsFromRequestBody`, with the route's own fields validated off
 *   `forwardedProps` against its zod schema) -> `assertCopilotAvailable` (the
 *   `inboxAi` flag, then the assistant being configured) -> the AI token
 *   budget -> item-scoped viewability (`assertConversationViewable` or
 *   `assertTicketVisible`, whichever the parsed ref carries — unified inbox
 *   §2.9), each already mapped onto the route's error envelope
 *   (forbiddenResponse / errorResponse).
 * - `gateCopilotFn`, for the copilot server fns (copilot-events.ts): the
 *   same order minus parse and budget, every failure
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
import { chatParamsFromRequestBody } from '@tanstack/ai'
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
 * `errorResponse` in `gateCopilotAguiRequest`, a propagated throw out of
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
 * The `inboxAi` flag -> assistant-configured half of the Copilot
 * gate sequence, order load-bearing (the flag is checked first). Permission
 * and item viewability differ per gate shape and stay out of this helper;
 * this covers only the two checks both shapes (`gateCopilotAguiRequest`,
 * `gateCopilotFn`) run verbatim.
 */
export async function assertCopilotAvailable(): Promise<void> {
  if (!(await isFeatureEnabled('inboxAi'))) {
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
 * NotFoundError — `gateCopilotAguiRequest` maps it onto its error envelope,
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
 * Throw-shaped sibling of `gateCopilotAguiRequest` for the copilot server fns
 * (copilot-events.ts), which surface every failure as a
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
 * The parsed AG-UI envelope a passed `gateCopilotAguiRequest` hands back
 * alongside the gate outputs: the client-accumulated message history and the
 * thread/run ids to echo on the canonical lifecycle chunks.
 */
export interface CopilotAguiEnvelope {
  messages: ReadonlyArray<unknown>
  threadId: string
  runId: string
}

export type CopilotAguiGateResult<T> =
  | (CopilotGateOk<T> & { agui: CopilotAguiEnvelope })
  | CopilotGateFailed

/**
 * The Response-shaped gate for the AG-UI streaming routes: the body is an
 * AG-UI `RunAgentInput` (validated by `chatParamsFromRequestBody`), and the
 * route's own fields — the item ref plus whatever else it needs — ride
 * `forwardedProps`, validated against the caller's schema.
 */
export async function gateCopilotAguiRequest<
  T extends { conversationId: string } | { ticketId: string },
>(
  request: Request,
  forwardedPropsSchema: z.ZodType<T>,
  invalidRequestMessage: string
): Promise<CopilotAguiGateResult<T>> {
  let auth: AuthContext
  try {
    auth = await requireAuth({ permission: PERMISSIONS.COPILOT_USE })
  } catch (err) {
    if (!isAuthDenialError(err)) throw err
    return { ok: false, response: forbiddenResponse('Copilot access required') }
  }

  let parsed: T
  let agui: CopilotAguiEnvelope
  try {
    const params = await chatParamsFromRequestBody(await request.json())
    parsed = forwardedPropsSchema.parse(params.forwardedProps)
    agui = { messages: params.messages, threadId: params.threadId, runId: params.runId }
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
    return { ok: true, auth, actor, parsed, conversationId, ticketId, agui }
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { ok: false, response: errorResponse(err.code, err.message, 404) }
    }
    throw err
  }
}
