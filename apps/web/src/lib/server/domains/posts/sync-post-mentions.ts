/**
 * Reconcile post_mentions rows for a single post and dispatch
 * post.mentioned events for genuinely new mentions.
 *
 * Called from createPost / updatePost after extracting mention IDs from the
 * TipTap document. Acts as a defensive choke point:
 *
 *  - Validate proposed targets server-side (drop anonymous/service/deleted).
 *  - Insert rows for newly-mentioned eligible principals.
 *  - Dispatch post.mentioned for each (skipping self-mentions).
 *  - Delete rows for principals no longer mentioned in the document.
 *  - Skip dispatch for principals already-notified (idempotent re-edit).
 *  - After dispatch, mark notifiedAt = now() so future edits don't re-fire.
 */

// Per eslint.config.js — app files must import schema via @/lib/server/db,
// NOT directly from @quackback/db.
import { db, postMentions, principal, eq, and, inArray } from '@/lib/server/db'
import { dispatchPostMentioned, type EventActor } from '../../events/dispatch'
import type { PostId, PrincipalId } from '@quackback/ids'

export interface SyncPostMentionsInput {
  postId: PostId
  postTitle: string
  postUrl: string
  mentionedIds: Set<PrincipalId>
  /** Per-principal excerpt (paragraph text containing the mention) for email body. */
  excerptByPrincipalId: Map<PrincipalId, string>
  actor: EventActor
}

export async function syncPostMentions(input: SyncPostMentionsInput): Promise<void> {
  const { postId, postTitle, postUrl, mentionedIds, actor } = input
  const actorPrincipalId = actor.principalId as PrincipalId | undefined

  // Server-side eligibility validation (defense against tampered clients).
  const eligibleIds: Set<PrincipalId> = new Set()
  if (mentionedIds.size > 0) {
    const rows = await db
      .select({ id: principal.id, type: principal.type, role: principal.role })
      .from(principal)
      .where(inArray(principal.id, Array.from(mentionedIds)))
    for (const r of rows) {
      if (r.type === 'user' && ['admin', 'member', 'user'].includes(r.role ?? '')) {
        eligibleIds.add(r.id as PrincipalId)
      }
    }
  }

  // Load existing rows for this post.
  const existing = await db
    .select({
      principalId: postMentions.principalId,
      notifiedAt: postMentions.notifiedAt,
    })
    .from(postMentions)
    .where(eq(postMentions.postId, postId))

  const existingByPrincipal = new Map(existing.map((r) => [r.principalId as PrincipalId, r]))

  const toInsert: PrincipalId[] = []
  const toDelete: PrincipalId[] = []

  for (const id of eligibleIds) {
    if (!existingByPrincipal.has(id)) toInsert.push(id)
  }
  for (const id of existingByPrincipal.keys()) {
    if (!eligibleIds.has(id)) toDelete.push(id)
  }

  let inserted: Array<{ principalId: PrincipalId }> = []
  if (toInsert.length > 0) {
    inserted = (await db
      .insert(postMentions)
      .values(toInsert.map((principalId) => ({ postId, principalId })))
      .onConflictDoNothing()
      .returning({ principalId: postMentions.principalId })) as Array<{
      principalId: PrincipalId
    }>
  }

  if (toDelete.length > 0) {
    await db
      .delete(postMentions)
      .where(and(eq(postMentions.postId, postId), inArray(postMentions.principalId, toDelete)))
  }

  for (const { principalId } of inserted) {
    if (actorPrincipalId !== undefined && principalId === actorPrincipalId) {
      // Self-mention: mark notified, skip dispatch.
      await db
        .update(postMentions)
        .set({ notifiedAt: new Date() })
        .where(and(eq(postMentions.postId, postId), eq(postMentions.principalId, principalId)))
      continue
    }
    await dispatchPostMentioned(actor, {
      postId,
      postTitle,
      postUrl,
      mentionedPrincipalId: principalId,
      mentioningPrincipalId: actorPrincipalId as PrincipalId,
      excerpt: input.excerptByPrincipalId.get(principalId) ?? '',
    })
    await db
      .update(postMentions)
      .set({ notifiedAt: new Date() })
      .where(and(eq(postMentions.postId, postId), eq(postMentions.principalId, principalId)))
  }
}
