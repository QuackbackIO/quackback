/** Refresh an existing Linear issue from the canonical Quackback post. */

import type { IntegrationId, PostId } from '@quackback/ids'
import type { PostCreatedEvent } from '@/lib/server/events/types'
import {
  and,
  boards,
  db,
  eq,
  integrations,
  postExternalLinks,
  posts,
  principal as principalTable,
} from '@/lib/server/db'
import { getBaseUrl } from '@/lib/server/config'
import { getValidAccessToken } from '@/lib/server/integrations/token-refresh'
import { buildLinearIssueBody } from './message'
import { updateLinearIssue } from './issues'

/**
 * Update the active Linear issue linked to a post. Returns false when the post
 * has no Linear link yet, allowing the caller to use the normal create queue.
 */
export async function refreshLinkedLinearPost(postId: PostId): Promise<boolean> {
  const [post, link] = await Promise.all([
    db.query.posts.findFirst({ where: eq(posts.id, postId) }),
    db
      .select({
        externalId: postExternalLinks.externalId,
        integrationId: postExternalLinks.integrationId,
      })
      .from(postExternalLinks)
      .innerJoin(integrations, eq(postExternalLinks.integrationId, integrations.id))
      .where(
        and(
          eq(postExternalLinks.postId, postId),
          eq(postExternalLinks.integrationType, 'linear'),
          eq(postExternalLinks.status, 'active'),
          eq(integrations.status, 'active')
        )
      )
      .limit(1)
      .then((rows) => rows[0]),
  ])

  if (!post || !link?.integrationId) return false

  const [board, author] = await Promise.all([
    db.query.boards.findFirst({ where: eq(boards.id, post.boardId) }),
    db.query.principal.findFirst({
      where: eq(principalTable.id, post.principalId),
      with: { user: { columns: { name: true, email: true } } },
    }),
  ])
  if (!board) return false

  const event: PostCreatedEvent = {
    id: globalThis.crypto.randomUUID(),
    type: 'post.created',
    timestamp: new Date().toISOString(),
    actor: { type: 'service', service: 'linear-media-sync' },
    data: {
      post: {
        id: post.id,
        title: post.title,
        content: post.content,
        boardId: post.boardId,
        boardSlug: board.slug,
        authorEmail: author?.user?.email ?? undefined,
        authorName: author?.displayName ?? author?.user?.name ?? undefined,
        voteCount: post.voteCount,
      },
    },
  }
  const body = buildLinearIssueBody(event, getBaseUrl())
  const accessToken = await getValidAccessToken(link.integrationId as IntegrationId)
  if (!accessToken) throw new Error('Linear is not connected')

  try {
    await updateLinearIssue(accessToken, link.externalId, body)
    await db
      .update(integrations)
      .set({ lastOutboundAt: new Date(), lastError: null, lastErrorAt: null })
      .where(eq(integrations.id, link.integrationId as IntegrationId))
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Linear sync failed'
    await db
      .update(integrations)
      .set({ lastError: message.slice(0, 500), lastErrorAt: new Date() })
      .where(eq(integrations.id, link.integrationId as IntegrationId))
    throw error
  }
}
