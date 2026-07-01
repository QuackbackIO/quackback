/**
 * Persist @-mentions inside an internal chat note and alert the mentioned
 * teammates in-app.
 *
 * Mirrors domains/posts/sync-post-mentions.ts but deliberately narrower:
 *  - Notes are immutable, so there is no diff/delete path — we only insert.
 *  - Mentions are TEAM-ONLY: a note is agent-facing, so only admin/member
 *    principals are eligible. Visitors (role 'user') and service principals are
 *    dropped server-side, defending against a tampered client.
 *  - Alerts are in-app only (a `chat_mention` notification); no email/event
 *    fan-out, matching the rest of the chat-notify surface.
 *
 * The inserted rows power the inbox "Mentions" view; the notifications power the
 * notification bell.
 */

// Per eslint.config.js — app files import schema via @/lib/server/db, never
// directly from @quackback/db.
import { db, conversationMessageMentions, principal, and, eq, inArray } from '@/lib/server/db'
import { createNotificationsBatch } from '@/lib/server/domains/notifications/notification.service'
import { truncate } from '@/lib/shared/utils/string'
import type { ConversationMessageId, ConversationId, PrincipalId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'chat-mentions' })

export interface SyncChatMentionsInput {
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

export async function syncConversationMessageMentions(input: SyncChatMentionsInput): Promise<void> {
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
    // ping yourself).
    const toNotify = inserted.map((r) => r.principalId).filter((id) => id !== authorPrincipalId)
    if (toNotify.length === 0) return

    await createNotificationsBatch(
      toNotify.map((principalId) => ({
        principalId,
        type: 'chat_mention' as const,
        title: `${authorName} mentioned you in a chat`,
        body: truncate(input.content, NOTE_PREVIEW_MAX),
        metadata: { conversationId },
      }))
    )

    // Stamp notifiedAt only AFTER delivery — if the batch above throws, the
    // catch leaves these rows un-watermarked, so the field never claims an
    // alert that didn't happen.
    await db
      .update(conversationMessageMentions)
      .set({ notifiedAt: new Date() })
      .where(
        and(
          eq(conversationMessageMentions.conversationMessageId, conversationMessageId),
          inArray(conversationMessageMentions.principalId, toNotify)
        )
      )
  } catch (err) {
    log.warn({ err }, 'sync chat message mentions failed')
  }
}
