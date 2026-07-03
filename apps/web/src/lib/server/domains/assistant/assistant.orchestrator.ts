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
import { db, and, eq, isNull, desc, conversationMessages } from '@/lib/server/db'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { ConversationAuthorInput } from '@/lib/server/domains/conversation/conversation.types'
import {
  appendAssistantReply,
  appendAssistantHandoffNote,
  executeAssistantHandoff,
} from '@/lib/server/domains/conversation/conversation.service'
import { publishConversationOnlyEvent } from '@/lib/server/realtime/conversation-channels'
import {
  ensureAssistantPrincipal,
  getAssistantPrincipal,
  loadConversationThread,
  mapRowsToThreadMessages,
  getActiveInvolvement,
  getLatestInvolvement,
  openInvolvement,
  voidAssumedResolutionForConversation,
  recordHandoff,
  recordAssistantAnswer,
  setInvolvementRating,
  isAssistantConfigured,
  respondEligible,
  runAssistantTurn,
  buildAssistantHandoverMessage,
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
 * Run one out-of-band assistant turn for a widget conversation. Gated on a
 * configured AI client and the `assistant.respond` setting; the silence rule
 * mutes it when a human has replied since Quinn's last message. Persists Quinn's
 * reply as an ordinary assistant-authored message, maintains the involvement
 * record, and executes any escalation the engine decided on. Best-effort
 * throughout — the caller invokes it fire-and-forget.
 */
export async function runAssistantTurnForConversation(
  conversationId: ConversationId
): Promise<void> {
  if (!isAssistantConfigured()) return

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

  // A returning customer revives an assumed-resolved involvement rather than
  // opening a new one; reuse the revived row as the active one when present.
  const revived = await voidAssumedResolutionForConversation(conversationId)
  const active = revived ?? (await getActiveInvolvement(conversationId))

  // Ephemeral turn signals for the widget's live trace + streamed answer. These
  // go to the conversation channel ONLY (never the inbox) and are never
  // persisted; the final reply below is the durable record. `assistant_delta`
  // carries the FULL clean answer so far, reset per attempt via the `thinking`
  // activity, so a retry or a dropped frame self-heals.
  let streamed = ''
  // Coalesce delta publishes: each carries the FULL answer so far, so publishing
  // on every fragment is O(N^2) bytes + one Redis publish per token. Throttle to
  // a smooth cadence — a dropped tail is harmless since the persisted reply is the
  // ground truth that replaces the buffer moments later.
  let lastDeltaAt = 0
  const publishActivity = (status: 'thinking' | 'searching_kb' | 'reviewing_conversation') =>
    publishConversationOnlyEvent(conversationId, {
      kind: 'assistant_activity',
      conversationId,
      status,
      at: new Date().toISOString(),
    })

  const result = await runAssistantTurn({
    messages,
    assistantPrincipalId,
    conversationId,
    escalationAlreadyOffered: active?.escalationOfferedAt != null,
    onActivity: (activity) => {
      if (activity.kind === 'thinking') {
        streamed = ''
        publishActivity('thinking')
      } else {
        publishActivity(
          activity.tool === 'search_knowledge' ? 'searching_kb' : 'reviewing_conversation'
        )
      }
    },
    onTextDelta: (delta) => {
      streamed += delta
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
  // Suppressed by the engine's own silence check — nothing to persist.
  if (result.status !== 'answered') return

  // Open on first touch; reuse the active involvement otherwise.
  const involvement =
    active ?? (await openInvolvement({ conversationId, triggeredBy: 'first_touch' }))

  const author: ConversationAuthorInput = {
    principalId: assistantPrincipalId,
    displayName: messenger.assistant?.name ?? 'Quinn',
    avatarUrl: messenger.assistant?.avatarUrl ?? null,
  }

  if (result.escalation?.mode === 'handoff') {
    const { getOfficeHoursSchedule } =
      await import('@/lib/server/domains/settings/settings.office-hours')
    const schedule = await getOfficeHoursSchedule()
    await appendAssistantReply(conversationId, buildAssistantHandoverMessage(schedule), author, {
      waiting: true,
    })
    // Reply posted; record the hand-off, drop an agent-only note explaining why
    // (so the teammate has context), and route it to a human — in parallel
    // (distinct rows — the involvement vs the note vs the conversation).
    await Promise.all([
      recordHandoff(involvement.id, result.escalation.reason),
      appendAssistantHandoffNote(conversationId, result.escalation.reason, author),
      executeAssistantHandoff(conversationId, result.escalation.reason),
    ])
    return
  }

  // Answer or offer: persist Quinn's reply (its text carries any offer), then
  // record the cited sources + stamp the inactivity clock (+ the single
  // escalation offer) in one involvement update.
  await appendAssistantReply(conversationId, result.text, author, {
    waiting: false,
    citations: result.citations,
  })
  await recordAssistantAnswer(involvement.id, {
    sources: result.citations.map((c) => ({ type: c.type, id: c.id, title: c.title, url: c.url })),
    offeredEscalation: result.escalation?.mode === 'offer',
  })
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
