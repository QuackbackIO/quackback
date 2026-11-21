/**
 * Tell the people a comment @-mentions, once the comment is visible.
 *
 * Called from dispatchCommentCreatedEvent, the one place a comment becomes
 * visible (at create when it is not held, and on approval), so a held comment
 * tells nobody until it is approved. Each mention is a `comment.mentioned`
 * event; its notification target honours the "Mentioned in a comment"
 * preference and checks the person can see the post.
 *
 *  - Only a comment a teammate, an API key or an integration wrote tells
 *    anyone. Customers get no mention picker, so a mention node in a
 *    customer's or anonymous visitor's comment is a crafted request and
 *    notifies nobody. The writer is who sent the text: a teammate or an API
 *    key that files a comment for a customer still tells the people it
 *    mentions. A comment released by approval has no other writer on record
 *    than its author.
 *  - Only people (user principals with a role) are told; the author never is.
 *  - A private comment is team-only, so only teammates are told about it.
 *  - Ids in the document come from the client: anything that is not a
 *    principal id is dropped before it reaches a query.
 */
import type { JSONContent } from '@tiptap/core'
import { isValidTypeId, type PostCommentId, type PrincipalId } from '@quackback/ids'
import { db, inArray, principal } from '@/lib/server/db'
import { isTeamMember } from '@/lib/shared/roles'
import { dispatchCommentMentioned, type EventActor } from '@/lib/server/events/dispatch'
import { buildPostUrl } from '@/lib/server/integrations/message-utils'
import { getSectionOrigins } from '@/lib/server/domains/settings/section-links'
import {
  extractMentionExcerpts,
  extractMentions,
} from '@/lib/server/domains/posts/extract-mentions'
import { mentionerMayMention } from '@/lib/server/domains/posts/sync-post-mentions'
import type { PublishedPostRef } from './comment.announce'

const MENTIONABLE_ROLES = new Set(['admin', 'member', 'user'])

export async function dispatchCommentMentions(
  actor: EventActor,
  author: PrincipalId,
  comment: { id: PostCommentId; isPrivate: boolean; contentJson?: unknown },
  post: PublishedPostRef,
  /** Who sent the text, when not the author (a comment filed for a customer). */
  writer: PrincipalId = author
): Promise<void> {
  const doc = (comment.contentJson ?? null) as JSONContent | null
  const ids = [...extractMentions(doc)].filter(
    (id) => id !== author && isValidTypeId(id, 'principal')
  )
  if (ids.length === 0) return

  const [mentioner] = await db
    .select({ type: principal.type, role: principal.role })
    .from(principal)
    .where(inArray(principal.id, [writer]))
  if (!mentioner || !mentionerMayMention(mentioner)) return

  const rows = await db
    .select({ id: principal.id, type: principal.type, role: principal.role })
    .from(principal)
    .where(inArray(principal.id, ids))
  const told = rows.filter(
    (row) =>
      row.type === 'user' &&
      MENTIONABLE_ROLES.has(row.role) &&
      (!comment.isPrivate || isTeamMember(row.role))
  )
  if (told.length === 0) return

  const excerpts = extractMentionExcerpts(doc)
  const postUrl = buildPostUrl(await getSectionOrigins(), post.boardSlug, post.id)
  for (const row of told) {
    await dispatchCommentMentioned(actor, {
      postId: post.id,
      postTitle: post.title,
      postUrl,
      boardId: post.boardId,
      commentId: comment.id,
      isPrivate: comment.isPrivate,
      mentionedPrincipalId: row.id as PrincipalId,
      mentioningPrincipalId: author,
      excerpt: excerpts.get(row.id as PrincipalId) ?? '',
    })
  }
}
