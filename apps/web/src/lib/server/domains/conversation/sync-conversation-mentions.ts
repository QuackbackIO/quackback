/**
 * Persist @-mentions inside an internal conversation note and alert the mentioned
 * teammates in-app.
 *
 * Mirrors domains/posts/sync-post-mentions.ts but deliberately narrower:
 *  - Notes are immutable, so there is no diff/delete path — we only insert.
 *  - Mentions are TEAM-ONLY: a note is agent-facing, so only admin/member
 *    principals are eligible. Visitors (role 'user') and service principals are
 *    dropped server-side, defending against a tampered client.
 *  - Alerts ride the `conversation.note_mentioned` event/hook pipeline and fan
 *    out on two channels: a `chat_mention` in-app notification and an email to
 *    the same teammates. Each channel is gated independently by the
 *    `chat_mention` row of the notification preference matrix, so muting one
 *    leaves the other alone.
 *
 * The inserted rows power the inbox "Mentions" view; the notification hook
 * (events/handlers/notification.ts) powers the notification bell and, on
 * success, calls back into `markConversationMentionsNotified` below to stamp
 * the watermark.
 */

// Per .oxlintrc.json — app files import schema via @/lib/server/db, never
// directly from @quackback/db.
import { db, conversationMessageMentions, principal, and, eq, inArray } from '@/lib/server/db'
import { dispatchConversationNoteMentioned } from '@/lib/server/events/dispatch'
import type { EventActor } from '@/lib/server/events/types'
import { truncate } from '@/lib/shared/utils/string'
import type { ConversationMessageId, ConversationId, PrincipalId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'conversation-mentions' })

export interface SyncConversationMentionsInput {
  conversationMessageId: ConversationMessageId
  conversationId: ConversationId
  /** Principal ids extracted from the note's TipTap doc. */
  mentionedIds: Set<PrincipalId>
  authorPrincipalId: PrincipalId
  authorName: string
  /** Plain-text note body — truncated for the notification preview. */
  content: string
}

const NOTE_PREVIEW_MAX = 140

export async function syncConversationMessageMentions(
  input: SyncConversationMentionsInput
): Promise<void> {
  const { conversationMessageId, conversationId, mentionedIds, authorPrincipalId, authorName } =
    input
  if (mentionedIds.size === 0) return

  // The note is already committed by the caller, so a failure here must never
  // reject into the note-send success path — but it also writes the rows that
  // power the Mentions view, so swallow loudly rather than silently.
  try {
    // Server-side eligibility: only teammates (admin/member) can be mentioned in
    // an internal note. Filter in code (not just the WHERE) as defense-in-depth.
    const rows = await db
      .select({ id: principal.id, type: principal.type, role: principal.role })
      .from(principal)
      .where(inArray(principal.id, Array.from(mentionedIds)))

    const eligibleIds: PrincipalId[] = []
    for (const r of rows) {
      if (r.type === 'user' && (r.role === 'admin' || r.role === 'member')) {
        eligibleIds.push(r.id as PrincipalId)
      }
    }
    if (eligibleIds.length === 0) return

    const inserted = (await db
      .insert(conversationMessageMentions)
      .values(eligibleIds.map((principalId) => ({ conversationMessageId, principalId })))
      .onConflictDoNothing()
      .returning({ principalId: conversationMessageMentions.principalId })) as Array<{
      principalId: PrincipalId
    }>

    // Notify everyone newly mentioned except the author (you can mention
    // yourself in a note — the row persists for the Mentions view — but never
    // ping yourself). This is THE recipient narrowing: the
    // conversation.note_mentioned resolvers trust the payload outright, so a
    // self-mention that survived here would both ring and mail its own author.
    // The bell, the mail, and the notifiedAt watermark all ride the event/hook
    // pipeline from here; the notification hook calls
    // markConversationMentionsNotified below once the bell actually landed.
    const toNotify = inserted.map((r) => r.principalId).filter((id) => id !== authorPrincipalId)
    if (toNotify.length === 0) return

    const actor: EventActor = {
      type: 'user',
      principalId: authorPrincipalId,
      displayName: authorName,
    }
    await dispatchConversationNoteMentioned(actor, {
      conversationId,
      conversationMessageId,
      mentionedPrincipalIds: toNotify,
      authorName,
      preview: truncate(input.content, NOTE_PREVIEW_MAX),
    })
  } catch (err) {
    log.warn({ err }, 'sync conversation message mentions failed')
  }
}

/**
 * Stamp `notifiedAt` for the given mention rows. Called by the
 * `conversation.note_mentioned` notification hook (events/handlers/
 * notification.ts) AFTER its batch insert succeeds — never from the emit
 * site above — so the watermark only ever claims an alert that actually
 * landed: a hook failure (and the BullMQ retry that follows) leaves the rows
 * un-watermarked, exactly like the pre-move direct-write behavior.
 */
export async function markConversationMentionsNotified(
  conversationMessageId: ConversationMessageId,
  principalIds: PrincipalId[]
): Promise<void> {
  if (principalIds.length === 0) return
  await db
    .update(conversationMessageMentions)
    .set({ notifiedAt: new Date() })
    .where(
      and(
        eq(conversationMessageMentions.conversationMessageId, conversationMessageId),
        inArray(conversationMessageMentions.principalId, principalIds)
      )
    )
}
