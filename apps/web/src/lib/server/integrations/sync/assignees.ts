/**
 * Inbound assignee sync: an issue assigned or unassigned on the provider
 * assigns or unassigns the tickets linked to it, in destinations that switch
 * `assigneeSync` on.
 *
 * It rides the same durable path as inbound status. The signed delivery is
 * stored as a `receive-webhook` receipt; the receipt's worker parses it
 * (`parseAssigneeChange`), resolves the account to a teammate
 * (`integration_user_mappings`) and queues one `assignee` operation per linked
 * ticket, in the receipt's own transaction. Each operation then applies the
 * change as the integration's service principal through `assignTicket`, so
 * the ticket's activity, events and realtime are the ones a teammate's
 * assignment produces, and outbound sync recognises its own principal.
 *
 * Linked means either of:
 * - paired: a customer ticket paired with the Inbox conversation the
 *   provider's channel opened for the issue (GitHub `tickets` mode, or a
 *   ticket made from that conversation by hand);
 * - tracked: an active ticket link to the issue made on that destination.
 *
 * Ordering: the claim already runs one operation per remote item at a time,
 * and an operation older (by the issue's `updated_at`) than one that already
 * succeeded on the same ticket is superseded, so a late `assigned` never
 * undoes a newer `unassigned`.
 */
import {
  db,
  eq,
  and,
  isNull,
  channelAccounts,
  channelThreads,
  integrationDestinations,
  integrations,
  ticketConversations,
  ticketExternalLinks,
  tickets,
} from '@/lib/server/db'
import type { IntegrationDestinationId, PrincipalId, TicketId } from '@quackback/ids'
import { boundedServiceActor } from '@/lib/server/policy/service-actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import { getIntegration } from '../index'
import {
  destinationReceives,
  destinationTarget,
  findInboundDestination,
  type IntegrationDestination,
} from '../destinations'
import type { InboundAssigneeChange } from '../inbound-types'
import { principalForExternalUser } from '../user-mappings'
import { installationIdentity, syncDestination, syncOperationKey, syncScopeFor } from './identity'
import { queueSyncOperation, type SyncTransaction } from './ledger'
import { hasNewerInbound } from './ordering'
import type { SyncClaim, SyncOutcome } from './types'

const log = logger.child({ component: 'inbound-assignee' })

type IntegrationRow = typeof integrations.$inferSelect

/** What a receipt hands its transaction: the change and the tickets it reaches. */
export interface InboundAssigneePlan {
  change: InboundAssigneeChange
  destination: IntegrationDestination
  ticketIds: TicketId[]
}

/** Whether a destination's issue assignees follow onto its tickets: switched on, and receiving. */
export function assigneeSyncOn(
  destination: Pick<IntegrationDestination, 'config' | 'enabled'>
): boolean {
  return destination.config?.assigneeSync === true && destinationReceives(destination)
}

/**
 * Read a receipt for an assignee change worth applying: the provider reports
 * one, the destination has assignee sync on and receives, the connection has
 * a principal to act as, and the account is matched to a teammate. An
 * unmatched account changes nothing. Null otherwise.
 */
export async function planInboundAssignee(
  integration: IntegrationRow,
  data: Record<string, unknown>
): Promise<InboundAssigneePlan | null> {
  const definition = getIntegration(integration.integrationType)
  const parse = definition?.inbound?.parseAssigneeChange
  const multiple = definition?.destination?.multiple
  if (!parse || !multiple || typeof data.body !== 'string' || !integration.principalId) return null
  const config = (integration.config ?? {}) as Record<string, unknown>
  const change = parse(data.body, config)
  if (!change) return null
  const destination = await findInboundDestination(
    integration.id,
    multiple.kind,
    change.destination
  )
  if (!destination || !assigneeSyncOn(destination)) return null
  const principalId = await principalForExternalUser(integration.id, change.assignee)
  if (!principalId) {
    log.debug(
      { integration_id: integration.id, login: change.assignee.login },
      'assignee is not matched to a teammate'
    )
    return null
  }
  const ticketIds = await linkedTicketIds(integration, destination, change)
  return ticketIds.length ? { change, destination, ticketIds } : null
}

/** The live tickets an issue reaches: paired with its Inbox conversation, or linked to it. */
async function linkedTicketIds(
  integration: IntegrationRow,
  destination: IntegrationDestination,
  change: InboundAssigneeChange
): Promise<TicketId[]> {
  const scope = syncScopeFor(
    integration,
    destinationTarget(destination),
    getIntegration(integration.integrationType)
  )
  const tracked = await db
    .select({ ticketId: ticketExternalLinks.ticketId })
    .from(ticketExternalLinks)
    .innerJoin(tickets, eq(tickets.id, ticketExternalLinks.ticketId))
    .where(
      and(
        eq(ticketExternalLinks.integrationId, integration.id),
        eq(ticketExternalLinks.status, 'active'),
        eq(ticketExternalLinks.externalId, change.externalId),
        eq(ticketExternalLinks.syncScope, scope),
        isNull(tickets.deletedAt)
      )
    )
  const paired = change.threadKey
    ? await db
        .select({ ticketId: ticketConversations.ticketId })
        .from(channelThreads)
        .innerJoin(channelAccounts, eq(channelAccounts.id, channelThreads.channelAccountId))
        .innerJoin(
          ticketConversations,
          eq(ticketConversations.conversationId, channelThreads.conversationId)
        )
        .innerJoin(tickets, eq(tickets.id, ticketConversations.ticketId))
        .where(
          and(
            eq(channelAccounts.channel, integration.integrationType),
            eq(channelThreads.externalThreadKey, change.threadKey),
            eq(ticketConversations.ticketType, 'customer'),
            isNull(tickets.deletedAt)
          )
        )
    : []
  return [...new Set([...tracked, ...paired].map((row) => row.ticketId))]
}

/** Queue one `assignee` operation per ticket the plan reaches, in the receipt's transaction. */
export async function queueInboundAssignee(
  tx: SyncTransaction,
  integration: IntegrationRow,
  plan: InboundAssigneePlan,
  deliveryKey: string
): Promise<void> {
  const installation = installationIdentity(integration)
  const target = destinationTarget(plan.destination)
  const destination = syncDestination(
    target,
    (integration.config ?? {}) as Record<string, unknown>,
    getIntegration(integration.integrationType)
  )
  const occurredAt = plan.change.occurredAt
  const sourceRevision =
    occurredAt && Number.isFinite(Date.parse(occurredAt))
      ? new Date(occurredAt).toISOString()
      : undefined
  for (const ticketId of plan.ticketIds)
    await queueSyncOperation(
      {
        operationKey: syncOperationKey({
          installation,
          kind: 'assignee',
          sourceType: 'ticket',
          sourceId: ticketId,
          destination,
          remoteId: plan.change.externalId,
          revision: deliveryKey,
        }),
        integrationId: integration.id,
        installation,
        provider: integration.integrationType,
        direction: 'inbound',
        kind: 'assignee',
        sourceType: 'ticket',
        sourceId: ticketId,
        destination,
        remoteId: plan.change.externalId,
        sourceRevision,
        result: {
          externalDisplayId: plan.change.externalDisplayId,
          externalUrl: plan.change.externalUrl,
        },
        payload: {
          executor: 'inbound-assignee',
          data: { change: plan.change, destinationId: plan.destination.id, target, deliveryKey },
        },
      },
      tx
    )
}

/** What the integration may do to a ticket's assignee, as its own principal. */
const ASSIGNEE_PERMISSIONS = new Set([PERMISSIONS.TICKET_ASSIGN])

/**
 * Apply one ticket's assignee change. Settings and the match are read again,
 * since either may have changed since the receipt. `assigned` makes the
 * matched teammate the assignee; `unassigned` clears the assignee only while
 * it is that teammate, and keeps the team. Anything else changes nothing.
 */
export async function applyInboundAssignee(
  claim: SyncClaim,
  integration: IntegrationRow,
  data: Record<string, unknown>
): Promise<SyncOutcome> {
  const op = claim.operation
  const change = data.change as InboundAssigneeChange
  const remote = { externalDisplayId: change.externalDisplayId, externalUrl: change.externalUrl }
  if (!integration.principalId) return { state: 'cancelled', errorCode: 'installation_changed' }
  if (await hasNewerInbound(db, op)) return { state: 'superseded' }
  const destination = await db.query.integrationDestinations.findFirst({
    where: eq(integrationDestinations.id, data.destinationId as IntegrationDestinationId),
  })
  if (!destination || !assigneeSyncOn(destination))
    return { state: 'cancelled', errorCode: 'installation_changed' }
  const principalId = await principalForExternalUser(integration.id, change.assignee)
  const [ticket] = await db
    .select({ assigneePrincipalId: tickets.assigneePrincipalId })
    .from(tickets)
    .where(and(eq(tickets.id, op.sourceId as TicketId), isNull(tickets.deletedAt)))
    .limit(1)
  if (!ticket) return { state: 'cancelled', errorCode: 'source_unavailable' }
  const next: PrincipalId | null | undefined = !principalId
    ? undefined
    : change.action === 'assigned'
      ? ticket.assigneePrincipalId === principalId
        ? undefined
        : principalId
      : ticket.assigneePrincipalId === principalId
        ? null
        : undefined
  if (next === undefined) return { state: 'succeeded', result: { ...remote, changed: false } }

  const { assignTicket } = await import('@/lib/server/domains/tickets/ticket.service')
  try {
    await assignTicket(
      op.sourceId as TicketId,
      { assigneePrincipalId: next },
      boundedServiceActor(ASSIGNEE_PERMISSIONS, integration.principalId)
    )
  } catch (error) {
    // The teammate is no longer one (their role changed since the match).
    if (error instanceof ValidationError)
      return { state: 'cancelled', errorCode: 'source_unavailable' }
    throw error
  }
  return { state: 'succeeded', result: { ...remote, changed: true } }
}
