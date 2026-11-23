/**
 * What an author's edit of their own published post tells the rest of the
 * system, as a team edit does: `post.updated` for webhooks and integrations,
 * and the @-mention reconcile. Split out of post.user-actions.ts.
 */
import { db, boards, principal, eq, type Post } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { dispatchPostUpdated, buildEventActor } from '@/lib/server/events/dispatch'
import { extractMentions, extractMentionExcerpts } from './extract-mentions'
import { syncPostMentions } from './sync-post-mentions'
import { buildPostUrl } from '@/lib/server/integrations/message-utils'
import { getSectionOrigins } from '@/lib/server/domains/settings/section-links'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'post-author-edit-announce' })

/**
 * After an edit of a published post: `post.updated` for webhooks and
 * integrations, and the @-mention reconcile (new mentions notified, removed
 * ones dropped). The edit is already saved, so a failure here is logged, not
 * thrown back at the author.
 */
export async function announceAuthorEdit(
  updated: Post,
  before: Post,
  actor: { principalId: PrincipalId }
): Promise<void> {
  try {
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, updated.boardId),
      columns: { id: true, slug: true },
    })
    if (!board) return
    // Named from the author's principal, as post.deleted names its deleter,
    // so webhook and integration consumers see who edited.
    const editor = await db.query.principal.findFirst({
      where: eq(principal.id, actor.principalId),
      columns: { userId: true, displayName: true },
      with: { user: { columns: { name: true, email: true } } },
    })
    const eventActor = buildEventActor({
      principalId: actor.principalId,
      userId: editor?.userId ?? undefined,
      email: editor?.user?.email ?? undefined,
      displayName: editor?.displayName ?? editor?.user?.name ?? undefined,
    })
    const changedFields: string[] = []
    if (updated.title !== before.title) changedFields.push('title')
    if (
      updated.content !== before.content ||
      JSON.stringify(updated.contentJson) !== JSON.stringify(before.contentJson)
    )
      changedFields.push('content')
    if (changedFields.length > 0) {
      dispatchPostUpdated(
        eventActor,
        { id: updated.id, title: updated.title, boardId: board.id, boardSlug: board.slug },
        changedFields
      )
    }
    const contentJson = updated.contentJson
    await syncPostMentions({
      postId: updated.id,
      postTitle: updated.title,
      postUrl: buildPostUrl(await getSectionOrigins(), board.slug, updated.id),
      boardId: updated.boardId,
      mentionedIds: contentJson ? extractMentions(contentJson) : new Set(),
      excerptByPrincipalId: contentJson ? extractMentionExcerpts(contentJson) : new Map(),
      actor: eventActor,
    })
  } catch (err) {
    log.error({ err, post_id: updated.id }, 'announce author edit failed')
  }
}
