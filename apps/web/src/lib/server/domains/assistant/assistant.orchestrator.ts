/**
 * Quinn turn orchestration — the assistant side of the conversation<->assistant
 * cycle. `runAssistantTurnForConversation` runs one out-of-band turn for a widget
 * conversation (persisting Quinn's reply and maintaining the involvement record);
 * `attributeCsatIfLastHandler` mirrors a submitted CSAT rating onto the
 * involvement when Quinn was the last handler.
 *
 * Ownership lives in the assistant domain, but the cycle reaches back into the
 * conversation domain for the message-append + hand-off primitives it exports
 * (`appendAssistantReply`, `executeAssistantHandoff`). That direction of the
 * assistant<->conversation cycle is adjudicated and recorded in GRAPH.md.
 */
import {
  db,
  and,
  eq,
  isNull,
  desc,
  conversationMessages,
  type AssistantHandoffReason,
} from '@/lib/server/db'
import type { AssistantInvolvementId, ConversationId, PrincipalId } from '@quackback/ids'
import type { ConversationMessageCitation } from '@/lib/shared/conversation/types'
import type { ConversationAuthorInput } from '@/lib/server/domains/conversation/conversation.types'
import {
  appendAssistantReply,
  appendAssistantHandoffNote,
  executeAssistantHandoff,
} from '@/lib/server/domains/conversation/conversation.service'
import { publishConversationOnlyEvent } from '@/lib/server/realtime/conversation-channels'
import {
  writeActivitySnapshot,
  clearActivitySnapshot,
} from '@/lib/server/domains/assistant/assistant-activity-snapshot'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { getLiveWorkflowReferencedAttributeKeys } from '@/lib/server/domains/workflows/workflow.service'
import { classifyConversationAttributes } from '@/lib/server/domains/conversation-attributes/ai-classification.service'
import {
  ensureAssistantPrincipal,
  getAssistantPrincipal,
  loadConversationThread,
  mapRowsToThreadMessages,
  getLatestInvolvement,
  openInvolvement,
  voidAssumedResolutionForConversation,
  recordHandoff,
  recordAssistantAnswer,
  setInvolvementRating,
  isAssistantConfigured,
  respondEligible,
  runAssistantTurn,
  activityToStatus,
} from '.'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'assistant-orchestrator' })

// The assistant's service principal is immutable once provisioned, so its id is
// memoized in-process to skip the find-or-create round trip on every turn.
let memoizedAssistantPrincipalId: PrincipalId | null = null

async function ensureAssistantPrincipalId(): Promise<PrincipalId> {
  if (memoizedAssistantPrincipalId) return memoizedAssistantPrincipalId
  const principal = await ensureAssistantPrincipal()
  memoizedAssistantPrincipalId = principal.id
  return memoizedAssistantPrincipalId
}

/** Test-only: clear the in-process principal-id memo between cases. */
export function __resetAssistantPrincipalMemo(): void {
  memoizedAssistantPrincipalId = null
}

/**
 * Phase 2 live re-check (AI-ATTRIBUTES-PARITY-SPEC.md §3): on an inbound
 * customer message, while Quinn is participating, re-classify JUST the
 * attribute keys some LIVE workflow condition actually references — so a
 * mid-conversation intent change is fresh by the time a handoff-triggered
 * workflow branches on it. Mirrors both competitors' cost gate: no live
 * workflow references an AI attribute at all, and this never even reaches
 * the classifier. Fire-and-forget from the caller; every gate here is a
 * cheap read and `classifyConversationAttributes` never throws on its own,
 * so the catch is defense in depth, not the primary safety net.
 */
async function triggerLiveAttributeRecheck(conversationId: ConversationId): Promise<void> {
  try {
    if (!(await isFeatureEnabled('inboxAi'))) return
    const keys = await getLiveWorkflowReferencedAttributeKeys()
    if (keys.size === 0) return
    await classifyConversationAttributes(conversationId, {
      trigger: 'live_recheck',
      restrictToKeys: [...keys],
    })
  } catch (err) {
    log.warn({ err, conversationId }, 'live attribute re-check failed')
  }
}

/**
 * Run one out-of-band assistant turn for a widget conversation. Gated on a
 * configured AI client and the `assistant.respond` setting; the silence rule
 * mutes it when a human has replied since Quinn's last message. Persists Quinn's
 * reply as an ordinary assistant-authored message, maintains the involvement
 * record, and executes any escalation the engine decided on. Best-effort
 * throughout — the caller invokes it fire-and-forget.
 *
 * `opts.stepInstructions` (Phase C conversational block layer, slice C-6):
 * threaded straight onto the turn's input, folded into just this one turn's
 * system prompt (see assistant.runtime.ts's buildStepInstructionsPrompt) —
 * never persisted config. Only action.executor.ts's `let_assistant_answer`
 * case ever passes this; every other caller (the ordinary customer-message
 * turn in conversation.service.ts) omits it.
 */
export async function runAssistantTurnForConversation(
  conversationId: ConversationId,
  opts?: {
    surface?: 'widget' | 'workflow_step'
    stepInstructions?: string | null
  }
): Promise<void> {
  if (!isAssistantConfigured()) return

  try {
    await enforceAiTokenBudget()
  } catch (err) {
    if (err instanceof TierLimitError) {
      log.info({ conversationId }, 'assistant turn skipped: ai token budget exceeded')
      return
    }
    throw err
  }

  // Messenger config is read uncached, but only past the sync AI-configured gate
  // above — so it costs a settings round trip solely when AI is set up.
  const { getMessengerConfig } = await import('@/lib/server/domains/settings/settings.widget')
  const messenger = await getMessengerConfig()
  if (messenger.assistant?.respond !== true) return

  // Overlap the principal find-or-create with the thread read: the raw read is
  // principal-independent (only the pure mapping needs the id), so both run at
  // once, then the map labels Quinn's own turns.
  const [assistantPrincipalId, threadRows] = await Promise.all([
    ensureAssistantPrincipalId(),
    loadConversationThread(conversationId),
  ])
  const messages = mapRowsToThreadMessages(threadRows, assistantPrincipalId)
  if (messages.length === 0) return

  // Silence rule: a human is handling it. Bail before touching the involvement
  // record (no revive, no active lookup) or spending on the model.
  if (!respondEligible(messages)) return

  // Phase 2 live re-check: fire-and-forget, independent of how this turn
  // resolves (answer, hand-off, or an internally-suppressed reply all still
  // want fresh attribute values before any live workflow branches on them).
  // `messages` already reflects the just-persisted customer message, so the
  // re-check classifies against the freshest transcript.
  void triggerLiveAttributeRecheck(conversationId)

  // A returning customer revives an assumed-resolved involvement rather than
  // opening a new one; reuse the revived row as the active one when present.
  // One latest-row read answers both involvement questions below: a
  // conversation has at most one active involvement and it is always the most
  // recently created row (openInvolvement only inserts when none is active;
  // every other transition updates in place), so `latest.status` alone says
  // whether Quinn is engaged ('active') and whether it bowed out ('handed_off').
  const revived = await voidAssumedResolutionForConversation(conversationId)
  const latest = revived ?? (await getLatestInvolvement(conversationId))
  const active = latest?.status === 'active' ? latest : null

  // Handoff silence: once Quinn hands a conversation to the team, the team
  // owns it — including the window before a teammate's first reply, which the
  // message-based silence rule above cannot see. Quinn never re-enters on its
  // own; a workflow step is the explicit re-engagement path and bypasses this.
  if ((opts?.surface ?? 'widget') === 'widget' && latest?.status === 'handed_off') return

  // The customer message this turn answers, for the write-tool idempotency
  // key: a retried turn over the same message must key the same way. In-memory
  // over the thread rows already loaded above; the filter semantics (latest
  // 'visitor' row among non-internal, non-deleted messages — the SQL half is
  // loadConversationThread's) are deliberately identical to the targeted
  // `loadAssistantItemState` read (assistant.thread.ts) the suggest route
  // uses where no thread is in hand — change one and you must change the other.
  const latestCustomerMessageId =
    threadRows.filter((m) => m.senderType === 'visitor').at(-1)?.id ?? null

  // Ephemeral turn signals for the widget's live trace + streamed answer. These
  // go to the conversation channel ONLY (never the inbox) and are never
  // persisted; the final reply below is the durable record. `assistant_delta`
  // carries the FULL clean answer so far, reset per attempt via the `thinking`
  // activity, so a retry or a dropped frame self-heals.
  let streamed = ''
  // The live preview is OPTIMISTIC: an attempt can still fail after its text
  // streamed (a structural rejection of the decoded output, or a transport
  // error that forces a re-dial). Once that happens the customer has already
  // watched one answer get retracted — streaming a second candidate that could
  // ALSO be retracted reads as the bot answering twice. From the first
  // invalidation on, the turn goes preview-silent: activity statuses keep the
  // typing indicator alive and the retry's answer arrives once, as the final
  // reply.
  let previewSilent = false
  // Coalesce delta publishes: each carries the FULL answer so far, so publishing
  // on every fragment is O(N^2) bytes + one Redis publish per token. Throttle to
  // a smooth cadence — a dropped tail is harmless since the persisted reply is the
  // ground truth that replaces the buffer moments later.
  let lastDeltaAt = 0
  // Mirrored into Redis on every publish (and cleared when the turn ends, in
  // the finally below) so a subscriber that connects mid-turn can replay the
  // current state instead of missing it — see assistant-activity-snapshot.ts.
  const publishActivity = (status: 'thinking' | 'searching_kb' | 'reviewing_conversation') => {
    const event = {
      kind: 'assistant_activity' as const,
      conversationId,
      status,
      at: new Date().toISOString(),
    }
    publishConversationOnlyEvent(conversationId, event)
    void writeActivitySnapshot(conversationId, event)
  }

  // The finally is the single place the snapshot is cleared: every exit —
  // suppressed, hand-off, answered, or the failure floor below — must leave
  // no stale trace for a later subscriber to replay.
  try {
    const result = await runAssistantTurn({
      messages,
      assistantPrincipalId,
      conversationId,
      role: 'customer_support',
      surface: opts?.surface ?? 'widget',
      involvementId: active?.id ?? null,
      latestCustomerMessageId,
      stepInstructions: opts?.stepInstructions ?? null,
      onActivity: (activity) => {
        if (activity.kind === 'thinking') {
          // A fresh 'thinking' after answer text already streamed is a retry:
          // the finished attempt was invalidated after the fact. Retract the
          // dead preview EXPLICITLY (the widget also clears on the activity
          // event, but an empty delta closes the race for any consumer that
          // handles only deltas) and go preview-silent for the rest of the
          // turn — see `previewSilent`.
          if (streamed.length > 0 && !previewSilent) {
            previewSilent = true
            publishConversationOnlyEvent(conversationId, {
              kind: 'assistant_delta',
              conversationId,
              text: '',
              at: new Date().toISOString(),
            })
          }
          streamed = ''
        }
        publishActivity(activityToStatus(activity))
      },
      onTextDelta: (delta) => {
        streamed += delta
        if (previewSilent) return
        const now = Date.now()
        if (now - lastDeltaAt < 90) return
        lastDeltaAt = now
        publishConversationOnlyEvent(conversationId, {
          kind: 'assistant_delta',
          conversationId,
          text: streamed,
          at: new Date(now).toISOString(),
        })
      },
    })
    // Suppressed by the engine's own silence check — nothing to persist. An
    // honest cannot-answer outcome is still a customer-visible terminal reply
    // and must be persisted; it simply must not advance resolution state.
    if (result.status === 'suppressed') return

    // Defense in depth: public delivery is forbidden if any internal context
    // reached the model, even when the model omitted that source from its final
    // citations. Retrieval should prevent this upstream; persistence also
    // fails closed so a future source cannot silently weaken the boundary.
    if (result.internalSourced) {
      throw new InternalSourcedReplyError()
    }

    // A substantive answer or escalation engages Quinn and needs an
    // involvement. A standalone inability reply does not open an involvement
    // that could otherwise sit active forever with no answer clock.
    const involvement =
      active ??
      (result.status === 'answered' || result.escalation
        ? await openInvolvement({ conversationId, triggeredBy: 'first_touch' })
        : null)

    const author: ConversationAuthorInput = {
      principalId: assistantPrincipalId,
      displayName: result.identity.name,
      avatarUrl: result.identity.avatarUrl,
    }

    // Answer, inability, or handoff: persist the model-authored reply. This is
    // the ONE persistence
    // point for citations, and the projection is an ALLOWLIST typed as the
    // stored shape (ConversationMessageCitation): the persisted shape is
    // structural, so a new ephemeral field on the in-flight AssistantCitation
    // (today `internal`, the copilot leak gate, and `updatedAt`, the copilot
    // freshness line) can never leak into storage — it simply isn't projected,
    // no per-field strip to forget.
    const persistedCitations = result.citations.map(
      (c): ConversationMessageCitation => ({ type: c.type, id: c.id, title: c.title, url: c.url })
    )
    await appendAssistantReply(conversationId, result.text, author, {
      waiting: result.escalation?.mode === 'handoff',
      citations: persistedCitations,
    })

    if (result.escalation?.mode === 'handoff') {
      if (!involvement) {
        throw new Error('assistant handoff requires an involvement')
      }
      // handoff_to_human was called during the agentic cycle. The model's own
      // final text is already persisted above; apply the requested operation
      // and its internal audit note without replacing that text server-side.
      await escalateToHuman(
        conversationId,
        involvement.id,
        result.escalation.reason,
        author,
        result.escalation
      )
      return
    }

    if (result.status === 'answered') {
      if (!involvement) {
        throw new Error('assistant answer requires an involvement')
      }
      // Only a validated answer stamps the inactivity clock and can later be
      // interpreted as an assumed resolution.
      await recordAssistantAnswer(involvement.id, {
        sources: result.citations.map((c) => ({
          type: c.type,
          id: c.id,
          title: c.title,
          url: c.url,
        })),
      })
    }
  } catch (err) {
    // An abort is a cancellation, not a failure, and must not escalate.
    if (err instanceof Error && err.name === 'AbortError') throw err
    // The leak guard gets its own log line: an internal-content near-miss is a
    // different operational event than a provider failure, even though both
    // resolve the same way for the customer (a human takes over).
    if (err instanceof InternalSourcedReplyError) {
      log.error({ conversationId }, 'internal-sourced reply blocked; escalating to a human')
    } else {
      log.error({ err, conversationId }, 'assistant turn failed; escalating to a human')
    }
    try {
      await runAssistantFailureFloor(conversationId, assistantPrincipalId)
    } catch (floorErr) {
      // A broken floor must stay observable: log it and surface the ORIGINAL
      // failure to the caller's catch instead of masking it with the floor's.
      log.error({ err: floorErr, conversationId }, 'assistant failure floor could not hand off')
      throw err
    }
  } finally {
    await clearActivitySnapshot(conversationId)
  }
}

/** The defense-in-depth leak guard's own error type, so the failure floor can
 *  log it distinctly from an ordinary provider failure. */
class InternalSourcedReplyError extends Error {
  constructor() {
    super('refusing to persist an internal-sourced customer reply')
  }
}

/**
 * Failure floor: a hard turn failure must not strand the customer with a
 * vanished typing indicator and no reply. There is no model-authored text to
 * persist — and the server never authors words as Quinn — so the honest
 * terminal outcome is a human handoff: executeAssistantHandoff opens and
 * routes the conversation, and its system message ("Connecting you to the
 * team") is what the customer sees. Deliberately NOT surface-scoped: a
 * workflow-step turn serves the same waiting customer, so its failure
 * escalates identically.
 */
async function runAssistantFailureFloor(
  conversationId: ConversationId,
  assistantPrincipalId: PrincipalId
): Promise<void> {
  // Re-check ownership at floor time with FRESH reads (never state from the
  // failed turn): a human may have replied and another turn may have handed
  // off while this one was failing. Either way the conversation is in human
  // hands and the floor must stay out.
  const rowsNow = await loadConversationThread(conversationId)
  const messagesNow = mapRowsToThreadMessages(rowsNow, assistantPrincipalId)
  if (!respondEligible(messagesNow)) return
  // One latest-row read answers both involvement questions — same invariant
  // as the pre-turn gate.
  const latest = await getLatestInvolvement(conversationId)
  if (latest?.status === 'handed_off') return
  const involvement =
    latest?.status === 'active'
      ? latest
      : await openInvolvement({ conversationId, triggeredBy: 'first_touch' })
  await escalateToHuman(conversationId, involvement.id, 'system_error', {
    principalId: assistantPrincipalId,
  })
}

/**
 * Terminal escalation shared by the model-led handoff and the failure floor.
 * recordHandoff is the compare-and-set gate: when it loses (a concurrent turn
 * already ended the involvement), every conversation-side effect is skipped,
 * so the customer can never see a second "Connecting you to the team".
 */
async function escalateToHuman(
  conversationId: ConversationId,
  involvementId: AssistantInvolvementId,
  reason: AssistantHandoffReason,
  author: ConversationAuthorInput,
  note?: {
    reason: string
    customerNeed: string
    attempted: string[]
    recommendedNextStep: string
  }
): Promise<void> {
  const handed = await recordHandoff(involvementId, reason)
  if (!handed) return
  await Promise.all([
    ...(note ? [appendAssistantHandoffNote(conversationId, note, author)] : []),
    executeAssistantHandoff(conversationId, reason, author),
  ])
}

/**
 * Mirror a submitted CSAT rating onto Quinn's involvement when it was the last
 * handler (the most recent visitor-facing reply was Quinn's). Best-effort: never
 * throws into the CSAT path.
 */
export async function attributeCsatIfLastHandler(
  conversationId: ConversationId,
  rating: number
): Promise<void> {
  try {
    // Gate on the involvement first: no involvement means Quinn never engaged,
    // so skip the principal + last-message reads entirely.
    const involvement = await getLatestInvolvement(conversationId)
    if (!involvement) return
    const assistantPrincipal = await getAssistantPrincipal()
    if (!assistantPrincipal) return
    const [last] = await db
      .select({ principalId: conversationMessages.principalId })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversationId),
          eq(conversationMessages.senderType, 'agent'),
          eq(conversationMessages.isInternal, false),
          isNull(conversationMessages.deletedAt)
        )
      )
      .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
      .limit(1)
    if (!last || last.principalId !== assistantPrincipal.id) return
    await setInvolvementRating(involvement.id, rating)
  } catch (err) {
    log.warn({ err }, 'attribute csat to assistant involvement failed')
  }
}
