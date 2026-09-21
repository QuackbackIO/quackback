/** Integration-only resync; every destination is represented by durable history. */
import { createId, type PostId, type PrincipalId } from '@quackback/ids'
import { db, eq, and, posts, boards, integrations, postExternalLinks } from '@/lib/server/db'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { integrationResolver } from '@/lib/server/events/resolvers/integration.resolver'
import type { PostCreatedEvent } from '@/lib/server/events/types'
import { queueHookSync } from './sync/hooks'
import { queueSyncOperation } from './sync/ledger'
import { getIntegration } from './index'
import {
  installationIdentity,
  syncHash,
  syncOperationKey,
  reviewDestination,
} from './sync/identity'

export async function syncPostIntegrations(
  postId: PostId,
  requestedBy?: PrincipalId
): Promise<{ queued: boolean; needsAttention: boolean; operationIds: string[] }> {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!post || post.deletedAt) throw new Error('Post not found')
  if (post.moderationState !== 'published') throw new Error('Only published posts can be synced')
  const board = await db.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
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
  const links = await db
    .select({ link: postExternalLinks, integration: integrations })
    .from(postExternalLinks)
    .innerJoin(integrations, eq(postExternalLinks.integrationId, integrations.id))
    .where(
      and(
        eq(postExternalLinks.postId, postId),
        eq(postExternalLinks.status, 'active'),
        eq(integrations.status, 'active')
      )
    )
  const results: Array<{ id: string; state: string } | null> = []
  // Bounded database work; independent destinations still complete after one fails.
  let failed = false
  for (const target of targets) {
    try {
      const integration = await db.query.integrations.findFirst({
        where: eq(integrations.id, String(target.config.integrationId) as never),
      })
      if (!integration || integration.status !== 'active') continue
      results.push(
        await queueHookSync(
          { hookType: target.type, event, target: target.target, config: target.config },
          undefined,
          requestedBy
        )
      )
    } catch {
      failed = true
    }
  }
  for (const { link, integration } of links) {
    if (!link.syncScope || !getIntegration(integration.integrationType)?.linkedItems) continue
    try {
      const installation = installationIdentity(integration)
      const destination = reviewDestination(
        link,
        integration,
        getIntegration(integration.integrationType)
      )
      results.push(
        await queueSyncOperation({
          operationKey: syncOperationKey({
            installation,
            kind: 'refresh',
            sourceType: 'post',
            sourceId: postId,
            destination,
            remoteId: link.externalId,
            revision: syncHash(event.data.post),
          }),
          integrationId: integration.id,
          installation,
          provider: integration.integrationType,
          direction: 'outbound',
          kind: 'refresh',
          sourceType: 'post',
          sourceId: postId,
          sourceRevision: post.updatedAt.toISOString(),
          destination,
          remoteId: link.externalId,
          requestedBy,
          state: 'conflict',
          errorCode: 'manual_update',
          result: { externalUrl: link.externalUrl, externalDisplayId: link.externalDisplayId },
          payload: { executor: 'refresh', data: { event, externalId: link.externalId } },
        })
      )
    } catch {
      failed = true
    }
  }
  if (failed)
    throw new Error(
      'Some integrations could not be queued. Open Sync history to review completed requests.'
    )
  const recorded = results.filter(
    (result): result is { id: string; state: string } => result !== null
  )
  return {
    queued: recorded.some((r) => ['queued', 'running', 'retry_wait'].includes(r.state)),
    needsAttention: recorded.some((r) =>
      ['conflict', 'uncertain', 'failed', 'auth_required'].includes(r.state)
    ),
    operationIds: recorded.map((r) => r.id),
  }
}
