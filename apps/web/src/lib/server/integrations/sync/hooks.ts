import {
  db,
  eq,
  and,
  sql,
  integrations,
  integrationEventMappings,
  postExternalLinks,
  posts,
  postComments,
  changelogEntries,
  boards,
  tickets,
  ticketExternalLinks,
} from '@/lib/server/db'
import type { IntegrationId, PostId, TicketId, PostCommentId, ChangelogId } from '@quackback/ids'
import type { HookJobData } from '@/lib/server/events/hook-job'
import { getIntegration } from '../index'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { JobSqlExecutor } from '@/lib/server/jobs/job-queue'
import { getBaseUrl } from '@/lib/server/config'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { getIntegrationAuth } from '../token-refresh'
import { installationIdentity, syncDestination, syncHash, syncOperationKey } from './identity'
import { queueSyncOperation, markSyncDispatched, type SyncTransaction } from './ledger'
import type { SyncClaim, SyncOutcome } from './types'
import { withSyncTransport } from './transport'
import { canDispatchSync } from './eligibility'
import { refreshSyncActor } from './sources'
import { realEmail } from '@/lib/shared/anonymous-email'

export function hookSource(data: HookJobData) {
  const content = data.event.data as {
    post?: { id: string }
    postId?: string
    ticket?: { id: string }
    comment?: { id: string }
    changelog?: { id: string }
    conversation?: { id: string }
    message?: { id: string }
  }
  if (content.message?.id) return { sourceType: 'message', sourceId: content.message.id }
  if (content.conversation?.id)
    return { sourceType: 'conversation', sourceId: content.conversation.id }
  if (content.comment?.id) return { sourceType: 'comment', sourceId: content.comment.id }
  if (content.changelog?.id) return { sourceType: 'changelog', sourceId: content.changelog.id }
  if (content.post?.id) return { sourceType: 'post', sourceId: content.post.id }
  if (content.postId) return { sourceType: 'post', sourceId: content.postId }
  if (content.ticket?.id) return { sourceType: 'ticket', sourceId: content.ticket.id }
  return { sourceType: 'event', sourceId: data.event.id }
}

/** Producers queue durable intent with a connection reference, never credentials. */
export async function queueHookSync(
  data: HookJobData,
  executor?: JobSqlExecutor,
  requestedBy?: string
): Promise<{ id: string; state: string } | null> {
  if (!executor) {
    return db.transaction((tx) => queueHookSync(data, tx, requestedBy))
  }
  if (data.hookType === 'remote_status_push') {
    const { queueStatusSync } = await import('./status')
    return queueStatusSync(data, executor)
  }
  const integrationId = String(data.config.integrationId)
  const [row] = getExecuteRows<{
    connected_at: string | null
    config: Record<string, unknown>
    status: string
  }>(
    await executor.execute(sql`
    SELECT connected_at, config, status FROM integrations WHERE ${eq(integrations.id, integrationId as IntegrationId)}
  `)
  )
  const installation = installationIdentity({
    id: integrationId,
    connectedAt: row?.connected_at ?? null,
  })
  const destination = syncDestination(data.target, row?.config ?? {}, getIntegration(data.hookType))
  const source = hookSource(data)
  const kind = data.event.type === 'post.created' ? 'create' : 'notify'
  const operationKey = syncOperationKey({
    installation,
    kind,
    ...source,
    destination,
    ...(kind === 'create' ? {} : { revision: data.event.id }),
  })
  return queueSyncOperation(
    {
      operationKey,
      integrationId,
      installation,
      provider: data.hookType,
      direction: 'outbound',
      kind,
      ...source,
      destination,
      requestedBy,
      state:
        !row || row.status !== 'active'
          ? 'cancelled'
          : source.sourceType === 'event'
            ? 'conflict'
            : 'queued',
      ...(source.sourceType === 'event' ? { errorCode: 'source_unavailable' as const } : {}),
      sourceRevision:
        kind === 'notify' && Number.isFinite(Date.parse(data.event.timestamp))
          ? new Date(data.event.timestamp).toISOString()
          : undefined,
      payload: {
        executor: 'hook',
        data: {
          hookType: data.hookType,
          event: source.sourceType === 'event' ? { ...data.event, data: {} } : data.event,
          target: data.target,
        },
      },
    },
    executor
  )
}

export async function executeHookSync(
  claim: SyncClaim,
  payload: Record<string, unknown>,
  integration: typeof integrations.$inferSelect
): Promise<SyncOutcome> {
  const hookType = String(payload.hookType)
  const hook = getIntegration(hookType)?.hook
  if (!hook) return { state: 'failed', errorCode: 'provider_failed' }
  const event = payload.event as HookJobData['event']
  const target = payload.target
  const config = (integration.config ?? {}) as Record<string, unknown>
  if (
    syncHash(syncDestination(target, config, getIntegration(integration.integrationType))) !==
    claim.operation.destinationKey
  )
    return { state: 'cancelled', errorCode: 'installation_changed' }
  // Resolve mappings afresh: cached routing or revoked board permission is not authority to send.
  const mappings = await db.query.integrationEventMappings.findMany({
    where: and(
      eq(integrationEventMappings.integrationId, integration.id),
      eq(integrationEventMappings.eventType, event.type),
      eq(integrationEventMappings.enabled, true)
    ),
  })
  const eventPost = (event.data as { post?: { id: string } }).post
  const postId =
    claim.operation.sourceType === 'post'
      ? (claim.operation.sourceId as PostId)
      : (eventPost?.id as PostId | undefined)
  const post = postId
    ? await db.query.posts.findFirst({
        where: eq(posts.id, postId),
        with: { author: { with: { user: { columns: { name: true, email: true } } } } },
      })
    : null
  const channel = (target as { channelId?: unknown } | null)?.channelId
  if (
    !mappings.some((m) => {
      const action = m.actionConfig as Record<string, unknown> | null
      const filters = m.filters as { boardIds?: string[] } | null
      return (
        (action?.channelId || config.channelId) === channel &&
        (!filters?.boardIds?.length || (!!post && filters.boardIds.includes(post.boardId)))
      )
    })
  )
    return { state: 'cancelled', errorCode: 'installation_changed' }
  // Re-read mutable content instead of re-exposing a removed snapshot.
  if (post && 'post' in event.data) {
    const board = await db.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
    if (!board) return { state: 'cancelled', errorCode: 'source_unavailable' }
    event.data.post = {
      id: post.id,
      title: post.title,
      content: contentJsonToMarkdown(post.contentJson, post.content),
      boardId: post.boardId,
      boardSlug: board.slug,
      voteCount: post.voteCount,
      authorName: post.author?.displayName ?? post.author?.user?.name ?? undefined,
      authorEmail: realEmail(post.author?.user?.email) ?? undefined,
    }
  }
  if (event.type === 'comment.created' || event.type === 'comment.updated') {
    const comment = await db.query.postComments.findFirst({
      where: eq(postComments.id, event.data.comment.id as PostCommentId),
      with: { author: { with: { user: { columns: { name: true, email: true } } } } },
    })
    if (
      !comment ||
      comment.deletedAt ||
      comment.isPrivate ||
      comment.moderationState !== 'published'
    )
      return { state: 'cancelled', errorCode: 'source_unavailable' }
    event.data.comment = {
      id: comment.id,
      content: contentJsonToMarkdown(comment.contentJson, comment.content),
      isPrivate: false,
      authorName: comment.author?.displayName ?? comment.author?.user?.name ?? undefined,
      authorEmail: realEmail(comment.author?.user?.email) ?? undefined,
    }
  }
  if (event.type === 'changelog.published') {
    const entry = await db.query.changelogEntries.findFirst({
      where: eq(changelogEntries.id, event.data.changelog.id as ChangelogId),
    })
    if (!entry || entry.deletedAt || !entry.publishedAt || entry.publishedAt > new Date())
      return { state: 'cancelled', errorCode: 'source_unavailable' }
    const { changelogBodyHtml } =
      await import('@/lib/server/domains/changelog/changelog-email-body')
    event.data.changelog = {
      ...event.data.changelog,
      title: entry.title,
      contentPreview: contentJsonToMarkdown(entry.contentJson, entry.content).slice(0, 200),
      contentHtml: changelogBodyHtml(entry.content, entry.contentJson),
      publishedAt: entry.publishedAt.toISOString(),
    }
  }
  if (event.type === 'conversation.created' || event.type === 'message.created') {
    const { refreshConversationSyncEvent } = await import('./sources')
    if (!(await refreshConversationSyncEvent(event)))
      return { state: 'cancelled', errorCode: 'source_unavailable' }
  }
  await refreshSyncActor(event)
  const credentials = await getIntegrationAuth(integration.id)
  const { accessToken, secrets } = credentials
  const validateDestination = getIntegration(hookType)?.destination?.validate
  if (validateDestination && !(await validateDestination({ target, config, accessToken })))
    return { state: 'failed', errorCode: 'provider_failed' }
  if (!(await canDispatchSync(claim.operation, integration, post?.updatedAt)))
    return { state: 'cancelled', errorCode: 'source_unavailable' }
  if (!(await markSyncDispatched(claim))) return { state: 'cancelled' }
  return withSyncTransport(async () => {
    const result = await hook.run(
      event,
      target,
      {
        ...config,
        ...secrets,
        ...(accessToken ? { accessToken } : {}),
        integrationId: integration.id,
        rootUrl: getBaseUrl(),
      },
      { jobId: claim.operation.operationKey }
    )
    if (
      claim.operation.kind === 'create' &&
      getIntegration(hookType)?.linkedItems &&
      result.state === 'succeeded' &&
      !result.result?.externalId
    )
      return { state: 'uncertain', errorCode: 'outcome_unknown' }
    return result
  })
}

export async function persistSyncLink(
  tx: SyncTransaction,
  claim: SyncClaim,
  result: Record<string, unknown>
): Promise<void> {
  if (typeof result.externalId !== 'string') return
  const op = claim.operation
  // Notification receipts remain in sync history; only tracked items get lifecycle links.
  if (op.kind !== 'create' || !getIntegration(op.provider)?.linkedItems) return
  const remoteUrl = typeof result.externalUrl === 'string' ? result.externalUrl : null
  const displayId = typeof result.externalDisplayId === 'string' ? result.externalDisplayId : null
  if (op.sourceType === 'post') {
    // A missing/deleted source is not a successful association. Keep remote evidence for review.
    const post = await tx.query.posts.findFirst({ where: eq(posts.id, op.sourceId as PostId) })
    if (!post || post.deletedAt) throw new Error('Source disappeared before linking')
    await tx
      .insert(postExternalLinks)
      .values({
        postId: post.id,
        integrationId: op.integrationId as IntegrationId,
        integrationType: op.provider,
        externalId: result.externalId,
        syncScope: `${op.installation}:${op.destinationKey}`,
        externalDisplayId: displayId,
        externalUrl: remoteUrl,
        origin: 'event',
      })
      .onConflictDoNothing()
  } else if (op.sourceType === 'ticket' && op.kind === 'create') {
    const ticket = await tx.query.tickets.findFirst({
      where: eq(tickets.id, op.sourceId as TicketId),
    })
    if (!ticket || ticket.deletedAt) throw new Error('Source disappeared before linking')
    const [link] = await tx
      .insert(ticketExternalLinks)
      .values({
        ticketId: ticket.id,
        integrationId: op.integrationId as IntegrationId,
        integrationType: op.provider,
        externalId: result.externalId,
        externalDisplayId: displayId,
        externalUrl: remoteUrl,
        syncScope: `${op.installation}:${op.destinationKey}`,
        origin: 'push',
      })
      .onConflictDoNothing()
      .returning()
    if (link) {
      const { emitTicketSystemMessage } =
        await import('@/lib/server/domains/tickets/ticket-message.service')
      await emitTicketSystemMessage(
        ticket.id,
        'external_linked',
        `Linked ${getIntegration(op.provider)?.catalog.name ?? op.provider} issue ${displayId ?? result.externalId}`,
        {
          exec: tx,
          dedupeKey: op.operationKey,
          metadata: {
            externalReference: displayId ?? result.externalId,
            externalUrl: remoteUrl ?? undefined,
          },
        }
      )
    }
  }
}
