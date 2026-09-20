/** Retry only integration destinations; publication, AI and notifications are never replayed. */
import { createId, type PostId } from '@quackback/ids'
import {
  and,
  boards,
  db,
  eq,
  integrations,
  postExternalLinks,
  posts,
  principal,
} from '@/lib/server/db'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { realEmail } from '@/lib/shared/anonymous-email'
import { getBaseUrl } from '@/lib/server/config'
import { integrationResolver } from '@/lib/server/events/resolvers/integration.resolver'
import { retryIntegrationDelivery } from '@/lib/server/events/process'
import type { PostCreatedEvent } from '@/lib/server/events/types'
import { getIntegration } from './index'
import { decryptSecrets } from './encryption'
import { getValidAccessToken } from './token-refresh'

export async function syncPostIntegrations(
  postId: PostId
): Promise<{ queued: boolean; updated: boolean }> {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!post || post.deletedAt) throw new Error('Post not found')
  if (post.moderationState !== 'published') throw new Error('Only published posts can be synced')
  const [board, author, links] = await Promise.all([
    db.query.boards.findFirst({ where: eq(boards.id, post.boardId) }),
    db.query.principal.findFirst({
      where: eq(principal.id, post.principalId),
      with: { user: true },
    }),
    db
      .select({ externalId: postExternalLinks.externalId, integration: integrations })
      .from(postExternalLinks)
      .innerJoin(integrations, eq(postExternalLinks.integrationId, integrations.id))
      .where(
        and(
          eq(postExternalLinks.postId, postId),
          eq(postExternalLinks.status, 'active'),
          eq(integrations.status, 'active')
        )
      ),
  ])
  if (!board) throw new Error('Board not found')
  const eventId = createId('event')
  const event: PostCreatedEvent = {
    id: eventId,
    type: 'post.created',
    timestamp: new Date().toISOString(),
    actor: { type: 'service', service: 'integration-post-sync' },
    data: {
      post: {
        id: post.id,
        title: post.title,
        content: contentJsonToMarkdown(post.contentJson, post.content),
        boardId: post.boardId,
        boardSlug: board.slug,
        voteCount: post.voteCount,
        authorEmail: realEmail(author?.user?.email) ?? undefined,
        authorName: author?.displayName ?? author?.user?.name ?? undefined,
      },
    },
  }
  const targets = await integrationResolver.resolve({
    eventId,
    seq: 0n,
    type: event.type,
    entityType: 'post',
    entityId: postId,
    actorType: 'service',
    payload: event.data,
    context: { depth: 0, source: 'integration-post-sync' },
    schemaVersion: 1,
    occurredAt: new Date(event.timestamp),
  })
  const linkedIntegrations = new Set(links.map((link) => link.integration.id as string))
  // Resolve every eligible destination independently of links belonging to other providers.
  const work: Array<Promise<'queued' | 'updated' | 'unchanged'>> = targets
    .filter((target) => !linkedIntegrations.has(String(target.config.integrationId)))
    .map(async (target) =>
      (await retryIntegrationDelivery({
        hookType: target.type,
        event,
        target: target.target,
        config: target.config,
      }))
        ? 'queued'
        : 'unchanged'
    )

  for (const { externalId, integration } of links) {
    const capability = getIntegration(integration.integrationType)?.issues
    if (!capability?.refreshPost) continue
    work.push(
      (async () => {
        try {
          const auth = capability.prepareAuth
            ? await capability.prepareAuth(integration)
            : {
                ...(integration.config as Record<string, unknown>),
                ...(integration.secrets
                  ? decryptSecrets<Record<string, unknown>>(integration.secrets)
                  : {}),
              }
          // OAuth providers share token refresh; other credentials remain in the auth bag.
          if (auth.accessToken) auth.accessToken = await getValidAccessToken(integration.id)
          await capability.refreshPost!({ auth, externalId, event, rootUrl: getBaseUrl() })
          await db
            .update(integrations)
            .set({ lastOutboundAt: new Date(), lastError: null, lastErrorAt: null })
            .where(eq(integrations.id, integration.id))
          return 'updated' as const
        } catch {
          // Provider/database errors may contain tokens or serialized job payloads.
          const message = 'Failed to refresh linked issue. Please try again.'
          await db
            .update(integrations)
            .set({ lastError: message, lastErrorAt: new Date() })
            .where(eq(integrations.id, integration.id))
            .catch(() => undefined)
          throw new Error(message)
        }
      })()
    )
  }
  // Finish all destinations even if one fails; a subsequent retry safely resumes just that work.
  const results = await Promise.allSettled(work)
  const errors = results.filter((result) => result.status === 'rejected')
  // Never serialize raw errors: an enqueue failure can include SQL parameters
  // containing the destination's OAuth credentials and the entire post payload.
  if (errors.length) throw new Error('Some integrations could not be synced. Please try again.')
  return {
    queued: results.some((result) => result.status === 'fulfilled' && result.value === 'queued'),
    updated: results.some((result) => result.status === 'fulfilled' && result.value === 'updated'),
  }
}
