/**
 * Quinn proactive suggested replies (QUINN-PROACTIVE-SUGGESTIONS-SPEC.md):
 * a read-only draft-reply card generated for a teammate viewing a
 * conversation/ticket whose latest message is from the customer with no
 * teammate reply after it (pull-on-view — the server never speculates on an
 * item nobody has open; there is no server-push per inbound message, see the
 * spec's non-goals). Sibling of copilot.ts, sharing its whole gate sequence
 * (`gateCopilotRequest`: copilot.use -> body parse -> inboxAi flag +
 * configured -> AI token budget -> item-scoped viewability) PLUS one more
 * layer: the `assistantProactiveSuggestions` flag, checked the same way
 * `assertCopilotAvailable` checks `inboxAi` (404 NOT_FOUND when off)
 * — a workspace can run Copilot Q&A without ever turning suggestions on.
 *
 * Unlike copilot.ts, this turn answers no question: it drafts a ready-to-send
 * reply to the item's latest CUSTOMER message. Everything that makes it a
 * suggestion turn — the fixed drafting instruction fed as the turn's sole
 * message, the suggestion framing prompt, the 'copilot_suggest' usage-log
 * `pipelineStep` (see analytics/copilot-usage.ts's header on the convention),
 * the read-only tool policy (never even a preview or a pending-approval
 * proposal: a suggestion drafts, it never acts), and the tool-led honest miss
 * that the server maps to `skip` — is owned end-to-end by
 * `copilotIntent: 'suggest'` (see `COPILOT_INTENT_PROFILES`,
 * assistant.runtime.ts), so this route passes no messages, no writeToolPolicy,
 * nothing intent-shaped: it just invokes the intent. `surface: 'copilot'`
 * keeps every other copilot behavior identical (the 'team' retrieval ceiling,
 * item grounding via `buildConversationContextPrompt`/`buildTicketContextPrompt`,
 * guidance rules, per-surface instructions).
 *
 * Silence-rule distinction (spec): the customer-facing silence rule
 * (`respondEligible`, muting Quinn once a human teammate has replied) governs
 * Quinn speaking TO THE CUSTOMER autonomously (the widget). A suggestion is
 * agent-facing assist, not an autonomous customer-facing reply, so the rule
 * must not gate it — and structurally it never does: the intent profile owns
 * the turn's messages (the single fixed drafting instruction, never a
 * `human_agent` sender — see `SUGGEST_TURN_MESSAGES`, assistant.runtime.ts),
 * which is all `respondEligible` ever inspects. A teammate having already
 * replied earlier in the real thread has no bearing on whether a fresh
 * suggestion is worth drafting for the NEXT customer message.
 *
 * Request contract: an item ref (conversationId XOR ticketId) plus
 * `lastCustomerMessageId`, the id of the message the client believes is the
 * item's latest customer message (its cache key — see the spec's
 * regenerate-on-new-message model). This route re-derives the item's actual
 * latest customer-authored message itself (a targeted single-row read, see
 * `loadAssistantItemState` — the full thread is loaded exactly once, by
 * `runAssistantTurn`, as grounding) and REJECTS with 409 CONFLICT if it
 * doesn't match `lastCustomerMessageId` (covers both "stale cache" and "id
 * from the wrong item" in one comparison), rather than silently generating
 * against the newer message and annotating the response — the simpler of the
 * two contracts the spec offered, and the one that keeps `SuggestFinalPayload`
 * free of a field to carry that note. The same read carries the item's
 * closed state, rejected with the same 409 shape: a closed item's latest
 * customer message is typically a thank-you that needs no reply, so drafting
 * for it would burn a paid turn per teammate who dwells on it. The client
 * renders NOTHING for a 409 (the same UI result as a tool-led honest miss):
 * recovery needs no user action — for staleness the client's
 * per-(item, lastCustomerMessageId) cache key already changed with the newer
 * message, and for a closed item there is nothing to suggest until it reopens
 * with new customer traffic (which changes the cache key too).
 *
 * Streaming contract: FINAL-ONLY, per the suggest.v1 contract doc
 * (copilot-contract.ts) — no delta frames are sent. A suggestion's honest
 * miss is only knowable at the end of the run, so streaming deltas
 * would put a half-drafted guess on screen that a trailing skip then
 * evaporates. The error frame is unchanged.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { isValidTypeId } from '@quackback/ids'
import {
  runAssistantTurn,
  ensureAssistantPrincipal,
  loadAssistantItemState,
} from '@/lib/server/domains/assistant'
import { gateCopilotRequest, streamAssistantSse } from '@/lib/server/domains/assistant/copilot-gate'
import { withAssistantItemRef } from '@/lib/server/domains/assistant/item-ref.schema'
import {
  isFeatureEnabled,
  isCopilotCapabilityEnabled,
} from '@/lib/server/domains/settings/settings.service'
import { errorResponse, conflictResponse } from '@/lib/server/domains/api/responses'
import { logger } from '@/lib/server/logger'
import {
  SUGGEST_EVENTS,
  type SuggestFinalPayload,
  type SuggestErrorPayload,
} from '@/lib/shared/assistant/copilot-contract'

const log = logger.child({ component: 'assistant-suggest' })

const lastCustomerMessageIdSchema = z.string().refine((v) => isValidTypeId(v, 'conversation_msg'), {
  message: 'Invalid message ID format',
})

const requestSchema = withAssistantItemRef({
  lastCustomerMessageId: lastCustomerMessageIdSchema,
})

/** The final frame every no-suggestion outcome maps to (see `handleSuggest`). */
const SKIP_FINAL: SuggestFinalPayload = {
  text: '',
  citations: [],
  internalSourced: false,
  skip: true,
}

export async function handleSuggest({ request }: { request: Request }): Promise<Response> {
  const gate = await gateCopilotRequest(
    request,
    requestSchema,
    'A valid conversationId or ticketId, and lastCustomerMessageId, are required'
  )
  if (!gate.ok) return gate.response
  const { auth, parsed, conversationId, ticketId } = gate

  // Additional gate past assertCopilotAvailable's inboxAi check: the
  // same 404 NOT_FOUND shape, one flag layer up. A workspace can run Copilot
  // Q&A without proactive suggestions ever turning on.
  if (!(await isFeatureEnabled('assistantProactiveSuggestions'))) {
    return errorResponse('NOT_FOUND', 'Proactive suggestions are not available', 404)
  }

  // Copilot suggested-drafts capability gate (v3 config): a workspace can run
  // proactive suggestions off independently of the flag, and vice-versa. Same
  // 404 NOT_FOUND shape as the flag check above.
  if (!(await isCopilotCapabilityEnabled('suggestedReplies'))) {
    return errorResponse('NOT_FOUND', 'Suggested replies are not available', 404)
  }

  // One targeted read covers both pre-spend gates (see this file's doc
  // comment): the closed check and the staleness check. Client-appropriate
  // wording, not recovery instructions, on both — the client renders nothing
  // for a 409, so the message only ever surfaces in logs/devtools. A missing
  // item row can only mean it vanished since the viewability gate; the same
  // silent 409 is the right degradation there too.
  const item = await loadAssistantItemState(conversationId, ticketId)
  if (!item || item.closed) {
    return conflictResponse('The conversation is closed')
  }
  if (item.latestCustomerMessageId !== parsed.lastCustomerMessageId) {
    return conflictResponse('A newer customer message arrived')
  }

  const assistant = await ensureAssistantPrincipal()

  return streamAssistantSse({
    request,
    error: {
      event: SUGGEST_EVENTS.error,
      payload: {
        code: 'TURN_FAILED',
        message: 'Suggestion generation failed',
      } satisfies SuggestErrorPayload,
    },
    logError: (err) => log.error({ err }, 'suggestion turn failed'),
    run: async (sse) => {
      // Final-only: no onTextDelta is wired, so no suggest.v1.delta frames
      // are ever sent (see the streaming contract in this file's doc comment).
      const result = await runAssistantTurn({
        assistantPrincipalId: assistant.id,
        role: 'suggested_reply',
        conversationId,
        ticketId,
        surface: 'copilot',
        // Owns the suggestion invariants end-to-end: the turn's fixed
        // drafting message, the framing, the 'copilot_suggest' usage-log
        // step, the read-only tool policy, and the report_inability-to-skip
        // mapping (see COPILOT_INTENT_PROFILES,
        // assistant.runtime.ts).
        actorPrincipalId: auth.principal.id,
        latestCustomerMessageId: item.latestCustomerMessageId,
        signal: request.signal,
      })

      // Every no-suggestion outcome collapses to the one skip frame: the
      // engine muting the turn (defensive; the intent's own turn messages
      // never carry human_agent), the tool-derived `skip` honest miss, and a
      // done-but-empty text (a model that left "text" blank without setting
      // skip: an empty card is a stuck card, so blank means skip here).
      if (result.status === 'suppressed' || result.skip || !result.text.trim()) {
        sse.send(SUGGEST_EVENTS.final, SKIP_FINAL)
      } else {
        sse.send(SUGGEST_EVENTS.final, {
          text: result.text,
          citations: result.citations,
          internalSourced: result.internalSourced,
        } satisfies SuggestFinalPayload)
      }
    },
  })
}

export const Route = createFileRoute('/api/admin/assistant/suggest')({
  server: {
    handlers: {
      POST: handleSuggest,
    },
  },
})
