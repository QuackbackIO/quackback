/**
 * A ticket's resync with the issues it is linked to, for trackers that mirror
 * replies and comments (`issues.comments`): the per-ticket counterpart of
 * `syncPostIntegrations`, and what a bulk backfill would otherwise be. The
 * sync ledger only moves forward, so nothing older is adopted wholesale; a
 * resync queues what live sync would have queued had it been listening:
 *
 * - out: each public reply written after the issue was linked and after its
 *   repository switched replies-as-comments on that has no comment yet, as
 *   the same `comment` operation the reply's own event queues;
 * - in: each comment on the issue written after it was linked that is not on
 *   the ticket yet, as the same `comment-import` operation a delivery queues,
 *   with the same skips (our own comments, a repository bringing none in, an
 *   issue the Inbox channel owns) and the repository's visibility.
 *
 * The operation keys are the live ones, so a resync never doubles what a
 * delivery or an event already queued, and the ledger's own start bounds
 * both directions too.
 */
import {
  db,
  eq,
  and,
  gt,
  or,
  ne,
  inArray,
  isNull,
  notExists,
  conversationMessages,
  integrations,
  messageExternalLinks,
  ticketExternalLinks,
  type Ticket,
} from '@/lib/server/db'
import type { ConversationId, TicketId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { getIntegration } from './index'
import { getIntegrationAuth } from './token-refresh'
import {
  destinationCommentVisibility,
  destinationReceives,
  destinationSends,
  listDestinations,
  type IntegrationDestination,
} from './destinations'
import { linkTarget } from './sync/identity'
import { queueTicketComment } from './sync/comments'
import { planCommentChange, queueInboundComment } from './sync/inbound-comments'

type IntegrationRow = typeof integrations.$inferSelect
type LinkRow = typeof ticketExternalLinks.$inferSelect

/** At most this many of an issue's comments are read in one resync. */
const TICKET_SYNC_COMMENT_LIMIT = 300

/** What a resync queued: replies on their way to issues, comments on their way in. */
export interface TicketSyncResult {
  outbound: number
  inbound: number
}

const PENDING = ['queued', 'running', 'retry_wait']

/**
 * Resync one ticket with every active link of a tracker that mirrors
 * comments. The caller has authorized the actor to manage the ticket's links;
 * the ticket must be visible to them. Independent links still sync when one
 * fails, and the failure is reported afterwards.
 */
export async function syncTicketIntegrations(
  ticketId: TicketId,
  actor: Actor
): Promise<TicketSyncResult> {
  const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
  const ticket = await assertTicketVisible(ticketId, actor)
  const links = await db
    .select({ link: ticketExternalLinks, integration: integrations })
    .from(ticketExternalLinks)
    .innerJoin(integrations, eq(ticketExternalLinks.integrationId, integrations.id))
    .where(
      and(
        eq(ticketExternalLinks.ticketId, ticketId),
        eq(ticketExternalLinks.status, 'active'),
        eq(integrations.status, 'active')
      )
    )
  const result: TicketSyncResult = { outbound: 0, inbound: 0 }
  let failed = false
  for (const { link, integration } of links) {
    const definition = getIntegration(integration.integrationType)
    const multiple = definition?.destination?.multiple
    if (!definition?.issues?.comments || !multiple) continue
    try {
      const destinations = await listDestinations(integration.id, multiple.kind)
      const target = linkTarget(
        link,
        integration,
        definition,
        destinations.map((d) => d.externalId)
      )
      const destination = destinations.find((d) => d.externalId === target?.channelId)
      if (!destination) continue
      result.outbound += await queueMissingReplies(ticket, link, integration, destination, actor)
      result.inbound += await queueMissingComments(link, integration, destination, actor)
    } catch {
      failed = true
    }
  }
  if (failed)
    throw new Error(
      'Some linked issues could not be synced. Open Sync history to review completed requests.'
    )
  return result
}

/**
 * Queue a comment for each public reply on the ticket's thread written after
 * both the link and the repository's opt-in, with no comment on this issue
 * yet. Replies the integration itself wrote (comments brought in) are not
 * replies to send.
 */
async function queueMissingReplies(
  ticket: Ticket,
  link: LinkRow,
  integration: IntegrationRow,
  destination: IntegrationDestination,
  actor: Actor
): Promise<number> {
  const since = destination.config.postRepliesAsCommentsSince
  if (
    !destinationSends(destination) ||
    destination.config.postRepliesAsComments !== true ||
    typeof since !== 'string' ||
    !Number.isFinite(Date.parse(since))
  )
    return 0
  const boundary = new Date(Math.max(link.createdAt.getTime(), Date.parse(since)))
  const { resolvePairConversationId } =
    await import('@/lib/server/domains/tickets/pair-thread.service')
  const pairConversationId = await resolvePairConversationId(ticket.id)
  const replies = await db
    .select({ id: conversationMessages.id, createdAt: conversationMessages.createdAt })
    .from(conversationMessages)
    .where(
      and(
        pairConversationId
          ? or(
              eq(conversationMessages.ticketId, ticket.id),
              eq(conversationMessages.conversationId, pairConversationId as ConversationId)
            )
          : eq(conversationMessages.ticketId, ticket.id),
        eq(conversationMessages.isInternal, false),
        isNull(conversationMessages.deletedAt),
        inArray(conversationMessages.senderType, ['agent', 'visitor']),
        gt(conversationMessages.createdAt, boundary),
        integration.principalId
          ? // A message the integration wrote came from the issue.
            or(
              isNull(conversationMessages.principalId),
              ne(conversationMessages.principalId, integration.principalId)
            )
          : undefined,
        notExists(
          db
            .select({ id: messageExternalLinks.id })
            .from(messageExternalLinks)
            .where(
              and(
                eq(messageExternalLinks.messageId, conversationMessages.id),
                eq(messageExternalLinks.ticketExternalLinkId, link.id)
              )
            )
        )
      )
    )
    .orderBy(conversationMessages.createdAt)
  let queued = 0
  for (const reply of replies) {
    const row = await db.transaction((tx) =>
      queueTicketComment(tx, {
        integrationId: integration.id,
        kind: 'comment',
        ticketId: ticket.id,
        messageId: reply.id,
        linkId: link.id,
        occurredAt: reply.createdAt.toISOString(),
        requestedBy: actor.principalId ?? undefined,
      })
    )
    if (row && PENDING.includes(row.state)) queued++
  }
  return queued
}

/**
 * Read the issue's comments written after it was linked and queue each one
 * not on the ticket yet, as a delivery of its creation would. Our own
 * comments only restore a missing record for a reply on this ticket.
 */
async function queueMissingComments(
  link: LinkRow,
  integration: IntegrationRow,
  destination: IntegrationDestination,
  actor: Actor
): Promise<number> {
  const comments = getIntegration(integration.integrationType)?.issues?.comments
  if (
    !comments ||
    !destinationReceives(destination) ||
    destinationCommentVisibility(destination) === 'off'
  )
    return 0
  const credentials = await getIntegrationAuth(integration.id)
  const remote = await comments.list({
    auth: {
      ...credentials.config,
      ...credentials.secrets,
      accessToken: credentials.accessToken,
      channelId: destination.externalId,
    },
    issueId: link.externalId,
    since: link.createdAt.toISOString(),
    limit: TICKET_SYNC_COMMENT_LIMIT,
  })
  const recorded = new Set(
    (
      await db
        .select({ externalId: messageExternalLinks.externalId })
        .from(messageExternalLinks)
        .where(eq(messageExternalLinks.ticketExternalLinkId, link.id))
    ).map((row) => row.externalId)
  )
  let queued = 0
  for (const comment of remote) {
    if (recorded.has(comment.externalId)) continue
    if (!(Date.parse(comment.createdAt) > link.createdAt.getTime())) continue
    const plan = await planCommentChange(integration, destination, {
      destination: {
        externalId: destination.externalId,
        ...(destination.externalKey ? { externalKey: destination.externalKey } : {}),
      },
      externalId: link.externalId,
      externalDisplayId: link.externalDisplayId ?? link.externalId,
      externalUrl: link.externalUrl,
      threadKey: comments.threadKey?.({ channelId: destination.externalId }, link.externalId),
      action: 'created',
      comment,
    })
    if (!plan) continue
    // Only this ticket's link: a resync is the ticket's, not the issue's.
    const scoped = {
      ...plan,
      targets: plan.targets.filter((t) => t.linkId === link.id),
      restore: plan.restore.filter((r) => r.linkId === link.id),
    }
    if (!scoped.targets.length && !scoped.restore.length) continue
    const rows = await db.transaction((tx) =>
      queueInboundComment(
        tx,
        integration,
        scoped,
        `resync:${link.id}`,
        actor.principalId ?? undefined
      )
    )
    queued += rows.filter((row) => PENDING.includes(row.state)).length
  }
  return queued
}
