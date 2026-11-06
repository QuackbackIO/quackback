/**
 * Inbound comments: a comment created, edited or deleted on an issue linked to
 * tickets becomes, follows or removes a message on each of those tickets, in
 * destinations whose `commentVisibility` brings comments in: an internal note
 * the team sees (`note`), or a public reply the requester sees and is
 * notified of (`reply`). `off`, the default, brings nothing in.
 *
 * It rides the same durable path as inbound assignees. The signed delivery is
 * stored as a `receive-webhook` receipt; the receipt's worker parses it
 * (`parseCommentChange`) and queues one operation per linked ticket, in the
 * receipt's own transaction. Each operation writes the message as the
 * integration's service principal through the ticket services, so the
 * ticket's realtime, events and requester notification are the ones a
 * teammate's note or reply produces, and outbound sync recognises its own
 * principal: a mirrored message is never posted back as a comment.
 *
 * Linked means an active ticket link to the issue made on that destination.
 * A ticket paired with one of the provider's Inbox conversations is not, and
 * nor is any ticket while the issue is an Inbox thread: the channel brings
 * those comments in already.
 *
 * Skipped: the connection's own comments and any comment carrying a
 * Quackback marker, which is what we posted. One that stands for a reply of
 * ours whose record is missing (the create's response was lost) gets its
 * record back, so the reply's later edits and deletion follow it again; one
 * deleted on the platform has its record marked deleted, and the reply stays.
 *
 * `message_external_links` records each brought-in comment (`inbound`), one
 * row per linked issue, and the operation that creates it has one key per
 * ticket and comment whether a delivery or a ticket's resync asked for it, so
 * neither can bring a comment in twice.
 *
 * Ordering: the claim runs one operation per comment at a time. An edit or a
 * deletion that arrives before the comment was brought in waits for it; an
 * edit older (by the comment's `updated_at`) than the version already shown
 * is superseded, and so is a create whose comment's deletion already applied.
 */
import {
  db,
  eq,
  and,
  sql,
  isNull,
  inArray,
  channelAccounts,
  channelThreads,
  conversationMessages,
  conversations,
  integrationDestinations,
  integrationSyncOperations as operations,
  integrations,
  messageExternalLinks,
  ticketConversations,
  ticketExternalLinks,
  tickets,
} from '@/lib/server/db'
import {
  isValidTypeId,
  type ConversationMessageId,
  type IntegrationDestinationId,
  type IntegrationId,
  type TicketExternalLinkId,
  type TicketId,
} from '@quackback/ids'
import type { TiptapContent } from '@/lib/shared/db-types'
import { boundedServiceActor } from '@/lib/server/policy/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'
import { markdownToTiptapJson, tiptapJsonToText } from '@/lib/server/markdown-tiptap'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { loadAuthors } from '@/lib/server/domains/principals/principal-display'
import { getIntegration } from '../index'
import {
  destinationCommentVisibility,
  destinationReceives,
  destinationTarget,
  findInboundDestination,
  type IntegrationDestination,
} from '../destinations'
import type { InboundCommentChange } from '../inbound-types'
import { principalForExternalUser } from '../user-mappings'
import { installationIdentity, syncDestination, syncOperationKey, syncScopeFor } from './identity'
import { markSyncDispatched, queueSyncOperation, type SyncTransaction } from './ledger'
import type { SyncClaim, SyncOutcome } from './types'

type IntegrationRow = typeof integrations.$inferSelect

/** The operation kind for each comment action. */
const INBOUND_COMMENT_KINDS = {
  created: 'comment-import',
  edited: 'comment-import-update',
  deleted: 'comment-import-delete',
} as const

/** How long an edit or deletion waits for the comment it follows to be brought in. */
const PENDING_IMPORT_RETRY_MS = 30_000

/** One linked ticket a comment reaches, through its link to the issue. */
export interface InboundCommentTarget {
  ticketId: TicketId
  linkId: TicketExternalLinkId
}

/** A reply of ours, posted as this comment, whose record names it on a link. */
interface MirroredReply {
  messageId: ConversationMessageId
  linkId: TicketExternalLinkId
}

/**
 * What a receipt hands its transaction: the change, the tickets it reaches,
 * the records of our replies to restore, and those to retire (`retire`: a
 * comment of ours deleted on the platform).
 */
export interface InboundCommentPlan {
  change: InboundCommentChange
  destination: IntegrationDestination
  targets: InboundCommentTarget[]
  restore: MirroredReply[]
  retire: string[]
}

/** The scope a link to an item in this destination carries (`ticket_external_links.sync_scope`). */
function destinationScope(integration: IntegrationRow, destination: IntegrationDestination) {
  return syncScopeFor(
    integration,
    destinationTarget(destination),
    getIntegration(integration.integrationType)
  )
}

/**
 * The live tickets a comment on an item reaches: actively linked to it on
 * this destination and not paired with one of the provider's Inbox
 * conversations. None while the item is itself an Inbox thread.
 */
async function inboundCommentTargets(
  integration: Pick<IntegrationRow, 'id' | 'integrationType'>,
  scope: string,
  item: { externalId: string; threadKey?: string }
): Promise<InboundCommentTarget[]> {
  if (item.threadKey) {
    const [thread] = await db
      .select({ id: channelThreads.id })
      .from(channelThreads)
      .innerJoin(channelAccounts, eq(channelAccounts.id, channelThreads.channelAccountId))
      .where(
        and(
          eq(channelAccounts.channel, integration.integrationType),
          eq(channelThreads.externalThreadKey, item.threadKey)
        )
      )
      .limit(1)
    if (thread) return []
  }
  return db
    .select({ ticketId: ticketExternalLinks.ticketId, linkId: ticketExternalLinks.id })
    .from(ticketExternalLinks)
    .innerJoin(tickets, eq(tickets.id, ticketExternalLinks.ticketId))
    .where(
      and(
        eq(ticketExternalLinks.integrationId, integration.id as IntegrationId),
        eq(ticketExternalLinks.status, 'active'),
        eq(ticketExternalLinks.externalId, item.externalId),
        eq(ticketExternalLinks.syncScope, scope),
        isNull(tickets.deletedAt),
        sql`NOT EXISTS (SELECT 1 FROM ${ticketConversations}
          JOIN ${conversations} ON ${conversations.id} = ${ticketConversations.conversationId}
          WHERE ${ticketConversations.ticketId} = ${tickets.id}
            AND ${ticketConversations.ticketType} = 'customer'
            AND ${conversations.channel} = ${integration.integrationType})`
      )
    )
}

/**
 * The links a reply of ours stands on for an item: the reply's ticket (or
 * the ticket paired with its conversation), linked to that item on this
 * destination. Empty when the marker names no message we have.
 */
async function mirroredReplyLinks(
  integration: IntegrationRow,
  scope: string,
  issueId: string,
  messageId: string
): Promise<MirroredReply[]> {
  if (!isValidTypeId(messageId, 'conversation_msg')) return []
  const message = await db.query.conversationMessages.findFirst({
    where: eq(conversationMessages.id, messageId as ConversationMessageId),
    columns: { id: true, ticketId: true, conversationId: true },
  })
  if (!message) return []
  let ticketId = message.ticketId
  if (!ticketId && message.conversationId) {
    const { resolvePairTicketIdForConversation } =
      await import('@/lib/server/domains/tickets/pair-thread.service')
    ticketId = await resolvePairTicketIdForConversation(message.conversationId)
  }
  if (!ticketId) return []
  const links = await db
    .select({ id: ticketExternalLinks.id })
    .from(ticketExternalLinks)
    .where(
      and(
        eq(ticketExternalLinks.ticketId, ticketId),
        eq(ticketExternalLinks.integrationId, integration.id),
        eq(ticketExternalLinks.status, 'active'),
        eq(ticketExternalLinks.externalId, issueId),
        eq(ticketExternalLinks.syncScope, scope)
      )
    )
  return links.map((link) => ({ messageId: message.id, linkId: link.id }))
}

/**
 * Read a receipt for a comment change worth acting on: the provider reports
 * one, the destination receives, and the connection has a principal to act
 * as. Our own comments only restore a missing record; anyone else's reach
 * the linked tickets while the destination brings comments in. Null when
 * there is nothing to do.
 */
export async function planInboundComment(
  integration: IntegrationRow,
  data: Record<string, unknown>
): Promise<InboundCommentPlan | null> {
  const definition = getIntegration(integration.integrationType)
  const parse = definition?.inbound?.parseCommentChange
  const multiple = definition?.destination?.multiple
  if (!parse || !multiple || typeof data.body !== 'string' || !integration.principalId) return null
  const change = parse(data.body, (integration.config ?? {}) as Record<string, unknown>)
  if (!change) return null
  const destination = await findInboundDestination(
    integration.id,
    multiple.kind,
    change.destination
  )
  return destination ? planCommentChange(integration, destination, change) : null
}

/**
 * What one comment change on an item in `destination` asks, wherever it was
 * read (a delivery, or a ticket's resync): nothing unless the destination
 * receives; for our own comments, the records to restore; for anyone else's,
 * the linked tickets, while the destination brings comments in.
 */
export async function planCommentChange(
  integration: IntegrationRow,
  destination: IntegrationDestination,
  change: InboundCommentChange
): Promise<InboundCommentPlan | null> {
  if (!destinationReceives(destination)) return null
  const scope = destinationScope(integration, destination)
  const comment = change.comment
  if (change.action === 'deleted') {
    // A comment of ours deleted on the platform: the reply it stood for
    // stays, but stops following it, so the reply's later edits post nothing.
    const posted = await db
      .select({ id: messageExternalLinks.id })
      .from(messageExternalLinks)
      .where(
        and(
          eq(messageExternalLinks.integrationId, integration.id),
          eq(messageExternalLinks.externalId, comment.externalId),
          eq(messageExternalLinks.direction, 'outbound'),
          eq(messageExternalLinks.status, 'active')
        )
      )
    if (posted.length)
      return { change, destination, targets: [], restore: [], retire: posted.map((r) => r.id) }
  }
  if (comment.byConnection || comment.marked) {
    const mirrorOf = comment.mirrorOf
    const restore =
      change.action !== 'deleted' && mirrorOf?.integrationId === integration.id
        ? await mirroredReplyLinks(integration, scope, change.externalId, mirrorOf.messageId)
        : []
    return restore.length ? { change, destination, targets: [], restore, retire: [] } : null
  }
  if (destinationCommentVisibility(destination) === 'off') return null
  const targets = await inboundCommentTargets(integration, scope, change)
  return targets.length ? { change, destination, targets, restore: [], retire: [] } : null
}

/**
 * Queue one operation per ticket the plan reaches, and restore or retire the
 * records of our own replies it names, in the receipt's transaction (or a
 * resync's). Returns the operations queued.
 */
export async function queueInboundComment(
  tx: SyncTransaction,
  integration: IntegrationRow,
  plan: InboundCommentPlan,
  deliveryKey: string,
  requestedBy?: string
): Promise<Array<{ id: string; state: string }>> {
  const { change, destination } = plan
  const comment = change.comment
  if (plan.retire.length)
    await tx
      .update(messageExternalLinks)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(inArray(messageExternalLinks.id, plan.retire as never[]))
  if (plan.restore.length)
    await tx
      .insert(messageExternalLinks)
      .values(
        plan.restore.map((reply) => ({
          messageId: reply.messageId,
          ticketExternalLinkId: reply.linkId,
          integrationId: integration.id,
          syncScope: destinationScope(integration, destination),
          externalId: comment.externalId,
          externalUrl: comment.externalUrl,
          direction: 'outbound' as const,
          status: 'active' as const,
          remoteVersion: comment.updatedAt,
        }))
      )
      .onConflictDoNothing()
  const installation = installationIdentity(integration)
  const identity = syncDestination(
    destinationTarget(destination),
    (integration.config ?? {}) as Record<string, unknown>,
    getIntegration(integration.integrationType)
  )
  const kind = INBOUND_COMMENT_KINDS[change.action]
  // A deletion carries no time of its own (the comment's `updated_at` is its
  // last edit), so it is never too old to apply.
  const at = change.action === 'created' ? comment.createdAt : comment.updatedAt
  const sourceRevision =
    change.action !== 'deleted' && Number.isFinite(Date.parse(at))
      ? new Date(at).toISOString()
      : undefined
  const queued: Array<{ id: string; state: string }> = []
  for (const target of plan.targets) {
    const row = await queueSyncOperation(
      {
        operationKey: syncOperationKey({
          installation,
          kind,
          sourceType: 'ticket',
          sourceId: target.ticketId,
          destination: identity,
          remoteId: comment.externalId,
          // Every edit is its own operation; a create or deletion is one per comment.
          ...(change.action === 'edited' ? { revision: comment.updatedAt } : {}),
        }),
        integrationId: integration.id,
        installation,
        provider: integration.integrationType,
        direction: 'inbound',
        kind,
        sourceType: 'ticket',
        sourceId: target.ticketId,
        destination: identity,
        remoteId: comment.externalId,
        sourceRevision,
        requestedBy,
        result: {
          externalDisplayId: change.externalDisplayId,
          externalUrl: comment.externalUrl ?? change.externalUrl,
        },
        payload: {
          executor: 'inbound-comment',
          data: { change, destinationId: destination.id, linkId: target.linkId, deliveryKey },
        },
      },
      tx
    )
    if (row) queued.push(row)
  }
  return queued
}

/** What the integration may do to a ticket's thread, as its own principal. */
const COMMENT_PERMISSIONS = new Set([
  PERMISSIONS.TICKET_NOTE,
  PERMISSIONS.TICKET_REPLY,
  // A public reply on a ticket paired with a conversation lands there.
  PERMISSIONS.CONVERSATION_REPLY,
])
/** Removing the message a deleted comment became, which is not a teammate's own to remove. */
const DELETE_PERMISSIONS = new Set([PERMISSIONS.CONVERSATION_MANAGE])

/**
 * The message a comment becomes: an attribution line naming the provider and
 * the comment's author (the teammate too, when the account is matched to
 * one), linking to the comment, then the comment itself.
 */
async function commentMessage(
  integration: IntegrationRow,
  change: InboundCommentChange
): Promise<{ content: string; contentJson: TiptapContent }> {
  const comment = change.comment
  const provider = getIntegration(integration.integrationType)?.catalog.name ?? 'Remote'
  const principalId = await principalForExternalUser(integration.id, comment.author)
  const teammate = principalId
    ? ((await loadAuthors([principalId])).get(principalId)?.displayName ?? null)
    : null
  const author = teammate ? `${teammate} (@${comment.author.login})` : `@${comment.author.login}`
  const marks: NonNullable<TiptapContent['marks']> = [{ type: 'italic' }]
  if (comment.externalUrl) marks.push({ type: 'link', attrs: { href: comment.externalUrl } })
  const body = markdownToTiptapJson(comment.body.trim())
  const contentJson = sanitizeTiptapContent({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `${provider} comment from ${author}`, marks }],
      },
      ...(body.content ?? []),
    ],
  })
  return { content: tiptapJsonToText(contentJson).trim(), contentJson }
}

/** Whether an operation for the same ticket and comment is still on its way. */
async function importPending(op: SyncClaim['operation'], kind: string): Promise<boolean> {
  const [row] = await db
    .select({ id: operations.id })
    .from(operations)
    .where(
      and(
        eq(operations.installation, op.installation),
        eq(operations.direction, 'inbound'),
        eq(operations.kind, kind),
        eq(operations.sourceType, 'ticket'),
        eq(operations.sourceId, op.sourceId),
        eq(operations.remoteId, op.remoteId ?? ''),
        inArray(operations.state, ['queued', 'running', 'retry_wait'])
      )
    )
    .limit(1)
  return !!row
}

/** Whether the comment's deletion already applied to this ticket. */
async function importDeleted(op: SyncClaim['operation']): Promise<boolean> {
  const [row] = await db
    .select({ id: operations.id })
    .from(operations)
    .where(
      and(
        eq(operations.installation, op.installation),
        eq(operations.direction, 'inbound'),
        eq(operations.kind, INBOUND_COMMENT_KINDS.deleted),
        eq(operations.sourceType, 'ticket'),
        eq(operations.sourceId, op.sourceId),
        eq(operations.remoteId, op.remoteId ?? ''),
        eq(operations.state, 'succeeded')
      )
    )
    .limit(1)
  return !!row
}

/**
 * Apply one ticket's comment change. The destination's settings and the
 * link are read again, since either may have changed since the receipt.
 * `created` writes the note or reply and records it; `edited` rewrites it;
 * `deleted` removes it. A comment never brought in changes nothing.
 */
export async function applyInboundComment(
  claim: SyncClaim,
  integration: IntegrationRow,
  data: Record<string, unknown>
): Promise<SyncOutcome> {
  const op = claim.operation
  const change = data.change as InboundCommentChange
  const comment = change.comment
  const remote = {
    externalDisplayId: change.externalDisplayId,
    externalUrl: comment.externalUrl ?? change.externalUrl,
  }
  const principalId = integration.principalId
  if (!principalId) return { state: 'cancelled', errorCode: 'installation_changed' }
  const destination = await db.query.integrationDestinations.findFirst({
    where: eq(integrationDestinations.id, data.destinationId as IntegrationDestinationId),
  })
  if (!destination || !destinationReceives(destination)) {
    return { state: 'cancelled', errorCode: 'installation_changed' }
  }
  const visibility = destinationCommentVisibility(destination)
  if (visibility === 'off') return { state: 'cancelled', errorCode: 'installation_changed' }
  // Unlinked, paired with an Inbox conversation, or the ticket removed since.
  const targets = await inboundCommentTargets(
    integration,
    destinationScope(integration, destination),
    change
  )
  const linkId = data.linkId as TicketExternalLinkId
  if (!targets.some((t) => t.linkId === linkId && t.ticketId === op.sourceId))
    return { state: 'cancelled', errorCode: 'source_unavailable' }

  const recordWhere = and(
    eq(messageExternalLinks.ticketExternalLinkId, linkId),
    eq(messageExternalLinks.externalId, comment.externalId)
  )
  const [record] = await db.select().from(messageExternalLinks).where(recordWhere).limit(1)
  // A comment of ours recorded on this link is a reply's, not one to bring in.
  if (record && record.direction !== 'inbound')
    return { state: 'cancelled', errorCode: 'source_unavailable' }

  if (change.action === 'created') {
    if (record)
      return {
        state: 'succeeded',
        result: { ...remote, messageId: record.messageId, changed: false },
      }
    if (await importDeleted(op)) return { state: 'superseded' }
    const message = await commentMessage(integration, change)
    // The note or reply is written once: an interrupted write is reviewed, never repeated.
    if (!(await markSyncDispatched(claim))) return { state: 'cancelled' }
    const actor = boundedServiceActor(COMMENT_PERMISSIONS, principalId)
    const input = { ticketId: op.sourceId as TicketId, ...message }
    const services = await import('@/lib/server/domains/tickets/ticket-message.service')
    const { message: written } =
      visibility === 'reply'
        ? await services.sendTicketMessage(actor, input)
        : await services.addTicketNote(actor, input)
    await db
      .insert(messageExternalLinks)
      .values({
        messageId: written.id as ConversationMessageId,
        ticketExternalLinkId: linkId,
        integrationId: integration.id,
        syncScope: `${op.installation}:${op.destinationKey}`,
        externalId: comment.externalId,
        externalUrl: comment.externalUrl,
        direction: 'inbound',
        status: 'active',
        remoteVersion: comment.updatedAt,
      })
      .onConflictDoNothing()
    return { state: 'succeeded', result: { ...remote, messageId: written.id, changed: true } }
  }

  if (!record) {
    // Still being brought in: follow it once it is. Never brought in: nothing to follow.
    return (await importPending(op, INBOUND_COMMENT_KINDS.created))
      ? { state: 'retry_wait', errorCode: 'unavailable', retryAfterMs: PENDING_IMPORT_RETRY_MS }
      : { state: 'succeeded', result: { ...remote, changed: false } }
  }
  if (record.status === 'deleted')
    return { state: 'succeeded', result: { ...remote, changed: false } }

  if (change.action === 'edited') {
    if (record.remoteVersion && Date.parse(record.remoteVersion) >= Date.parse(comment.updatedAt))
      return { state: 'superseded' }
    const message = await commentMessage(integration, change)
    const { editMirroredMessage } =
      await import('@/lib/server/domains/conversation/conversation.edit')
    try {
      await editMirroredMessage(
        record.messageId,
        message.content,
        message.contentJson,
        boundedServiceActor(COMMENT_PERMISSIONS, principalId)
      )
    } catch (error) {
      // The message was removed in Quackback: the comment's edit has nowhere to go.
      if (error instanceof NotFoundError)
        return { state: 'succeeded', result: { ...remote, changed: false } }
      throw error
    }
    await db
      .update(messageExternalLinks)
      .set({ remoteVersion: comment.updatedAt, updatedAt: new Date() })
      .where(recordWhere)
    return {
      state: 'succeeded',
      result: { ...remote, messageId: record.messageId, changed: true },
    }
  }

  const { deleteConversationMessage } =
    await import('@/lib/server/domains/conversation/conversation.service')
  try {
    await deleteConversationMessage(
      record.messageId,
      boundedServiceActor(DELETE_PERMISSIONS, principalId)
    )
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error
  }
  await db
    .update(messageExternalLinks)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(recordWhere)
  return { state: 'succeeded', result: { ...remote, messageId: record.messageId, changed: true } }
}
