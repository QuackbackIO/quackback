/**
 * A linked ticket's public replies as comments on its issues.
 *
 * For each issue a ticket is linked to (`ticket_external_links`: a manual
 * link, a teammate's "Create issue", a destination's automatic create) in a
 * destination that switches `postRepliesAsComments` on, a public reply is
 * posted as one comment there, and `message_external_links` records which.
 * The comment is the connection's own, so it then follows its reply: an edit
 * or a file added or removed rewrites it, and deleting the reply deletes it.
 * Comments written on the platform are never touched.
 *
 * Every write is a ledger operation (`comment`, `comment-update`,
 * `comment-delete`), visible in Sync history:
 *
 * - `comment` is one per reply and linked issue, sourced from the reply, so
 *   the ledger cancels an internal note or a removed reply structurally and a
 *   redelivered event finds the operation already there.
 * - `comment-update` is one per event, sourced from the reply.
 * - `comment-delete` is one per reply and linked issue, sourced from the
 *   ticket (the reply is gone) with the comment as its remote item.
 *
 * Nothing is mirrored for what the integration's own principal did (a reply
 * that came from the platform), nor for a ticket paired with one of the
 * provider's inbox conversations: those replies reach the issue through the
 * channel already. The worker asks every question again before it writes.
 */
import {
  fromUuid,
  type ConversationMessageId,
  type IntegrationId,
  type TicketId,
} from '@quackback/ids'
import {
  db,
  sql,
  eq,
  and,
  integrations,
  integrationDestinations,
  integrationSyncOperations as operations,
  conversationMessages,
  messageExternalLinks,
  ticketExternalLinks,
  tickets,
} from '@/lib/server/db'
import type { HookJobData } from '@/lib/server/events/hook-job'
import type { JobSqlExecutor } from '@/lib/server/jobs/job-queue'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { getIntegration } from '../index'
import { getIntegrationAuth } from '../token-refresh'
import { destinationSends } from '../destinations'
import {
  installationIdentity,
  linkTarget,
  syncDestination,
  syncHash,
  syncOperationKey,
} from './identity'
import {
  markSyncDispatched,
  queueSyncOperation,
  readSyncPayload,
  type SyncTransaction,
} from './ledger'
import { withSyncTransport } from './transport'
import { canDispatchSync } from './eligibility'
import type { SyncClaim, SyncOutcome } from './types'

type IntegrationRow = typeof integrations.$inferSelect

/** The sink the ticket-comment resolver routes to. */
export const TICKET_COMMENT_HOOK = 'ticket_comment'

/** Ticket events whose `messageId` names a public reply that still stands. */
export const TICKET_REPLY_EVENTS: readonly string[] = [
  'ticket.replied',
  'ticket.reply_updated',
  'ticket.attachment_added',
  'ticket.attachment_removed',
]

/** Every ticket event a mirrored comment follows. */
export const TICKET_COMMENT_EVENTS: readonly string[] = [
  ...TICKET_REPLY_EVENTS,
  'ticket.reply_deleted',
]

export const TICKET_COMMENT_KINDS = ['comment', 'comment-update', 'comment-delete'] as const
export type TicketCommentKind = (typeof TICKET_COMMENT_KINDS)[number]

export function isTicketCommentKind(kind: string): kind is TicketCommentKind {
  return (TICKET_COMMENT_KINDS as readonly string[]).includes(kind)
}

function commentKind(eventType: string): TicketCommentKind | null {
  if (eventType === 'ticket.replied') return 'comment'
  if (eventType === 'ticket.reply_deleted') return 'comment-delete'
  return TICKET_REPLY_EVENTS.includes(eventType) ? 'comment-update' : null
}

/** How long an edit or delete waits for the comment its reply is still being posted as. */
const PENDING_CREATE_RETRY_MS = 30_000

/** The operation that posts a reply to one linked issue. */
function commentKey(input: {
  installation: string
  destination: Record<string, unknown>
  messageId: string
  issueId: string
}): string {
  return syncOperationKey({
    installation: input.installation,
    destination: input.destination,
    kind: 'comment',
    sourceType: 'message',
    sourceId: input.messageId,
    remoteId: input.issueId,
  })
}

interface CommentRoute {
  link: { id: string; externalId: string; externalDisplayId: string | null; syncScope: string }
  target: { channelId: string }
}

/**
 * Where a reply on `ticketId` goes for the link `linkId`, or null when it
 * goes nowhere. Reads through `executor`, so the relay asks inside its
 * transaction and the worker asks again just before writing. Every rule:
 *
 * - the provider mirrors replies (`issues.comments`) and the link is an
 *   active link of this ticket on this connection;
 * - the link is on one of the connection's destinations, which takes new
 *   work (switched on, not inbound-only) and, except to delete a comment
 *   already posted, has `postRepliesAsComments` on;
 * - the ticket is not paired with one of the provider's inbox conversations.
 */
async function commentRoute(
  executor: JobSqlExecutor,
  integration: Pick<IntegrationRow, 'id' | 'integrationType' | 'connectedAt' | 'config'>,
  input: { linkId: string; ticketId: string; kind: TicketCommentKind }
): Promise<CommentRoute | null> {
  const definition = getIntegration(integration.integrationType)
  const multiple = definition?.destination?.multiple
  if (!definition?.issues?.comments || !multiple) return null
  const [link] = getExecuteRows<{
    external_id: string
    external_display_id: string | null
    sync_scope: string
    channel: string | null
  }>(
    await executor.execute(sql`
      SELECT ticket_external_links.external_id, ticket_external_links.external_display_id,
        ticket_external_links.sync_scope,
        (SELECT c.channel FROM ticket_conversations tc
          JOIN conversations c ON c.id = tc.conversation_id
          WHERE tc.ticket_id = ticket_external_links.ticket_id AND tc.ticket_type = 'customer'
          LIMIT 1) AS channel
      FROM ${ticketExternalLinks}
      JOIN ${tickets} ON tickets.id = ticket_external_links.ticket_id AND tickets.deleted_at IS NULL
      WHERE ${and(
        eq(ticketExternalLinks.id, input.linkId as never),
        eq(ticketExternalLinks.ticketId, input.ticketId as TicketId),
        eq(ticketExternalLinks.integrationId, integration.id as IntegrationId),
        eq(ticketExternalLinks.status, 'active')
      )}`)
  )
  if (!link || link.channel === integration.integrationType) return null
  const destinations = getExecuteRows<{
    external_id: string
    enabled: boolean
    config: Record<string, unknown>
  }>(
    await executor.execute(sql`
      SELECT external_id, enabled, config FROM ${integrationDestinations}
      WHERE ${and(
        eq(integrationDestinations.integrationId, integration.id as IntegrationId),
        eq(integrationDestinations.kind, multiple.kind)
      )}`)
  )
  const target = linkTarget(
    { syncScope: link.sync_scope },
    integration,
    definition,
    destinations.map((d) => d.external_id)
  )
  const destination = destinations.find((d) => d.external_id === target?.channelId)
  if (!target || !destination || !destinationSends(destination)) return null
  if (input.kind !== 'comment-delete' && destination.config.postRepliesAsComments !== true)
    return null
  return {
    link: {
      id: input.linkId,
      externalId: link.external_id,
      externalDisplayId: link.external_display_id,
      syncScope: link.sync_scope,
    },
    target: { channelId: destination.external_id },
  }
}

/** The comment this connection posted for a reply on a linked issue, if any. */
async function postedComment(executor: JobSqlExecutor, linkId: string, messageId: string) {
  const [row] = getExecuteRows<{
    external_id: string
    external_url: string | null
    status: string
  }>(
    await executor.execute(sql`
      SELECT external_id, external_url, status FROM ${messageExternalLinks}
      WHERE ${and(
        eq(messageExternalLinks.ticketExternalLinkId, linkId as never),
        eq(messageExternalLinks.messageId, messageId as ConversationMessageId),
        eq(messageExternalLinks.direction, 'outbound')
      )}`)
  )
  return row ?? null
}

/** Whether the comment for a reply is still on its way (its create not yet finished). */
async function commentPending(executor: JobSqlExecutor, operationKey: string): Promise<boolean> {
  const [row] = getExecuteRows(
    await executor.execute(sql`
      SELECT 1 FROM ${operations} WHERE ${eq(operations.operationKey, operationKey)}
        AND state IN ('queued', 'running', 'retry_wait') LIMIT 1`)
  )
  return !!row
}

/**
 * Queue the comment write a ticket reply event asks of one linked issue
 * (`data.target.linkId`), in the relay's transaction. An edit or a delete is
 * queued only for a comment this connection posted, or is still posting.
 */
export async function queueTicketCommentSync(
  data: HookJobData,
  executor: JobSqlExecutor
): Promise<{ id: string; state: string } | null> {
  const kind = commentKind(data.event.type)
  const payload = data.event.data as { ticket?: { id?: string }; messageId?: string }
  const ticketId = payload.ticket?.id
  const messageId = payload.messageId
  const linkId = (data.target as { linkId?: unknown } | null)?.linkId
  if (!kind || !ticketId || !messageId || typeof linkId !== 'string') return null
  return queueTicketComment(executor, {
    integrationId: String(data.config.integrationId),
    kind,
    ticketId,
    messageId,
    linkId,
    actor: data.event.actor,
    revision: data.event.id,
    occurredAt: data.event.timestamp,
  })
}

/**
 * Queue one comment write for a reply on one linked issue: what a reply
 * event asks (`queueTicketCommentSync`), or what a ticket's resync asks for
 * a reply that has no comment yet (`kind` `comment`, the same operation the
 * reply's own event queues, so it is never posted twice).
 */
export async function queueTicketComment(
  executor: JobSqlExecutor,
  input: {
    integrationId: string
    kind: TicketCommentKind
    ticketId: string
    messageId: string
    linkId: string
    /** Who changed the reply; absent for a resync. */
    actor?: HookJobData['event']['actor']
    /** What makes an edit its own operation (the event's id). */
    revision?: string
    /** When the reply changed, for the ledger's forward-only rule. */
    occurredAt: string
    requestedBy?: string
  }
): Promise<{ id: string; state: string } | null> {
  const { integrationId, kind, ticketId, messageId, linkId } = input
  const [row] = getExecuteRows<{
    connected_at: string | null
    config: Record<string, unknown>
    integration_type: string
    principal_id: string | null
    status: string
  }>(
    await executor.execute(sql`
      SELECT connected_at, config, integration_type, principal_id, status FROM ${integrations}
      WHERE ${eq(integrations.id, integrationId as IntegrationId)}`)
  )
  if (!row || row.status !== 'active') return null
  // The loop rule: what the integration's own principal did came from that platform.
  const actor = input.actor
  if (
    actor?.type === 'service' &&
    row.principal_id &&
    actor.principalId === fromUuid('principal', row.principal_id)
  )
    return null
  const integration = {
    id: integrationId as IntegrationId,
    integrationType: row.integration_type,
    connectedAt: row.connected_at ? new Date(row.connected_at) : null,
    config: row.config,
  }
  const route = await commentRoute(executor, integration, { linkId, ticketId, kind })
  if (!route) return null
  const installation = installationIdentity(integration)
  const destination = syncDestination(
    route.target,
    row.config,
    getIntegration(row.integration_type)
  )
  const createKey = commentKey({
    installation,
    destination,
    messageId,
    issueId: route.link.externalId,
  })
  let remoteId: string | undefined
  if (kind !== 'comment') {
    const posted = await postedComment(executor, linkId, messageId)
    if (posted?.status === 'active') remoteId = posted.external_id
    else if (posted || !(await commentPending(executor, createKey))) return null
  }
  const operationKey =
    kind === 'comment'
      ? createKey
      : syncOperationKey({
          installation,
          destination,
          kind,
          sourceType: kind === 'comment-delete' ? 'ticket' : 'message',
          sourceId: kind === 'comment-delete' ? ticketId : messageId,
          remoteId: `${route.link.externalId}:${messageId}`,
          ...(kind === 'comment-update' ? { revision: input.revision } : {}),
        })
  return queueSyncOperation(
    {
      operationKey,
      integrationId,
      installation,
      provider: row.integration_type,
      direction: 'outbound',
      kind,
      // A deleted reply cannot be the source: the ledger would cancel it.
      sourceType: kind === 'comment-delete' ? 'ticket' : 'message',
      sourceId: kind === 'comment-delete' ? ticketId : messageId,
      sourceRevision: Number.isFinite(Date.parse(input.occurredAt))
        ? new Date(input.occurredAt).toISOString()
        : undefined,
      destination,
      remoteId,
      requestedBy: input.requestedBy,
      result: {
        externalUrl: null,
        externalDisplayId: route.link.externalDisplayId ?? route.link.externalId,
      },
      payload: {
        executor: 'ticket-comment',
        data: { target: route.target, linkId, ticketId, messageId },
      },
    },
    executor
  )
}

/** Post, rewrite or delete the comment an operation stands for. */
export async function executeTicketCommentSync(
  claim: SyncClaim,
  integration: IntegrationRow
): Promise<SyncOutcome> {
  const kind = claim.operation.kind
  const definition = getIntegration(integration.integrationType)
  const comments = definition?.issues?.comments
  if (!comments || !isTicketCommentKind(kind))
    return { state: 'cancelled', errorCode: 'installation_changed' }
  const data = readSyncPayload(claim.operation).data as {
    target: { channelId: string }
    linkId: string
    ticketId: string
    messageId: string
  }
  const config = (integration.config ?? {}) as Record<string, unknown>
  if (syncHash(syncDestination(data.target, config, definition)) !== claim.operation.destinationKey)
    return { state: 'cancelled', errorCode: 'installation_changed' }
  // Unlinked, its repository switched off or opted out, or paired with an inbox conversation since.
  const route = await commentRoute(db, integration, { ...data, kind })
  if (!route || route.target.channelId !== data.target.channelId)
    return { state: 'cancelled', errorCode: 'source_unavailable' }

  const posted = await postedComment(db, data.linkId, data.messageId)
  const reference = route.link.externalDisplayId ?? route.link.externalId
  if (kind === 'comment' && posted)
    return {
      state: 'succeeded',
      result: {
        externalId: posted.external_id,
        externalUrl: posted.external_url,
        externalDisplayId: reference,
      },
    }
  if (kind === 'comment-delete' && posted?.status === 'deleted')
    return { state: 'succeeded', result: { externalId: posted.external_id } }
  if (kind !== 'comment' && posted?.status !== 'active') {
    // The comment is still being posted: come back once it exists.
    const createKey = commentKey({
      installation: claim.operation.installation,
      destination: syncDestination(data.target, config, definition),
      messageId: data.messageId,
      issueId: route.link.externalId,
    })
    return (await commentPending(db, createKey))
      ? { state: 'retry_wait', errorCode: 'unavailable', retryAfterMs: PENDING_CREATE_RETRY_MS }
      : { state: 'cancelled', errorCode: 'source_unavailable' }
  }

  let body: string | null = null
  if (kind !== 'comment-delete') {
    const { buildTicketReplySource } =
      await import('@/lib/server/domains/tickets/ticket-reply-source')
    const reply = await buildTicketReplySource(
      data.ticketId as TicketId,
      data.messageId as ConversationMessageId
    )
    // A reply the platform sent us is not sent back.
    if (!reply || (reply.principalId && reply.principalId === integration.principalId))
      return { state: 'cancelled', errorCode: 'source_unavailable' }
    body = comments.format(reply, { integrationId: integration.id })
  }

  const credentials = await getIntegrationAuth(integration.id)
  const auth = {
    ...credentials.config,
    ...credentials.secrets,
    accessToken: credentials.accessToken,
    channelId: data.target.channelId,
  }
  if (!(await canDispatchSync(claim.operation, integration)) || !(await markSyncDispatched(claim)))
    return { state: 'cancelled' }
  const outcome = await withSyncTransport(async () => {
    if (kind === 'comment') {
      const comment = await comments.create({ auth, issueId: route.link.externalId, body: body! })
      return {
        state: 'succeeded',
        result: {
          externalId: comment.externalId,
          externalUrl: comment.externalUrl,
          externalDisplayId: reference,
          version: comment.version,
        },
      }
    }
    const commentId = posted!.external_id
    if (kind === 'comment-update') {
      const comment = await comments.update({ auth, commentId, body: body! })
      // Deleted on the platform: the reply stays, and its record says the comment is gone.
      if (!comment)
        return {
          state: 'succeeded',
          result: { externalId: commentId, externalDisplayId: reference, gone: true },
        }
      return {
        state: 'succeeded',
        result: {
          externalId: commentId,
          externalUrl: comment.externalUrl ?? posted!.external_url,
          externalDisplayId: reference,
          version: comment.version,
        },
      }
    }
    await comments.delete({ auth, commentId })
    return { state: 'succeeded', result: { externalId: commentId, externalDisplayId: reference } }
  })
  // Rewriting or deleting a comment we own is safe to repeat, so an unknown
  // outcome there waits for a retry instead of a review. A create is not.
  return kind !== 'comment' && outcome.state === 'uncertain'
    ? { state: 'retry_wait', errorCode: 'unavailable' }
    : outcome
}

/**
 * Record what a comment write did, in the operation's completion
 * transaction: the reply's comment on that issue, its new version, or that
 * it is gone (deleted with its reply, or found deleted on the platform when
 * rewritten). A link or reply removed for good meanwhile leaves nothing to
 * record against.
 */
export async function persistTicketComment(
  tx: SyncTransaction,
  claim: SyncClaim,
  result: Record<string, unknown>
): Promise<void> {
  const op = claim.operation
  if (typeof result.externalId !== 'string' || !op.payload) return
  const data = readSyncPayload(op).data as { linkId?: string; messageId?: string }
  if (typeof data.linkId !== 'string' || typeof data.messageId !== 'string') return
  const where = and(
    eq(messageExternalLinks.ticketExternalLinkId, data.linkId as never),
    eq(messageExternalLinks.messageId, data.messageId as ConversationMessageId),
    eq(messageExternalLinks.direction, 'outbound')
  )
  const version = typeof result.version === 'string' ? result.version : null
  if (op.kind === 'comment-update' && result.gone !== true) {
    await tx
      .update(messageExternalLinks)
      .set({ remoteVersion: version, updatedAt: new Date() })
      .where(where)
    return
  }
  if (op.kind === 'comment-update' || op.kind === 'comment-delete') {
    await tx
      .update(messageExternalLinks)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(where)
    return
  }
  const link = await tx.query.ticketExternalLinks.findFirst({
    where: eq(ticketExternalLinks.id, data.linkId as never),
    columns: { id: true },
  })
  const message = await tx.query.conversationMessages.findFirst({
    where: eq(conversationMessages.id, data.messageId as ConversationMessageId),
    columns: { id: true },
  })
  if (!link || !message) return
  await tx
    .insert(messageExternalLinks)
    .values({
      messageId: data.messageId as ConversationMessageId,
      ticketExternalLinkId: data.linkId as never,
      integrationId: op.integrationId as IntegrationId,
      syncScope: `${op.installation}:${op.destinationKey}`,
      externalId: result.externalId,
      externalUrl: typeof result.externalUrl === 'string' ? result.externalUrl : null,
      direction: 'outbound',
      status: 'active',
      remoteVersion: version,
    })
    .onConflictDoNothing()
}
