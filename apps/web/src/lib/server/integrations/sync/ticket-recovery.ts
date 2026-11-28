/**
 * Ticket recovery as review: an issue that names a ticket as its own (the
 * marker of an issue we opened, or a link to the ticket in Quackback) but is
 * linked to no ticket in its repository becomes a `relink` item in Sync
 * history. The issue lost its link (unlinked, its repository removed and
 * added again) or was never linked; either way only a teammate decides.
 * The item offers the verified **Link existing** recovery, which inspects
 * the issue in that repository before linking it, and **Cancel**. Nothing is
 * ever linked on a delivery's say-so.
 *
 * It rides the signed receipt like the other inbound changes: the receipt's
 * worker reads the reference (`parseTicketReference`) and records the item in
 * the receipt's transaction. One item per ticket, issue and repository, so a
 * busy issue proposes once; once resolved it is not proposed again. An issue
 * whose create is still on its way (or awaits its own review) is left alone:
 * the create links it, or offers the same recovery.
 */
import {
  db,
  eq,
  and,
  inArray,
  isNull,
  integrationSyncOperations as operations,
  integrations,
  ticketExternalLinks,
  tickets,
} from '@/lib/server/db'
import { isValidTypeId, type TicketId } from '@quackback/ids'
import { getIntegration } from '../index'
import {
  destinationReceives,
  destinationTarget,
  findInboundDestination,
  type IntegrationDestination,
} from '../destinations'
import type { InboundTicketReference } from '../inbound-types'
import {
  installationIdentity,
  syncDestination,
  syncHash,
  syncOperationKey,
  syncScopeFor,
} from './identity'
import { queueSyncOperation, type SyncTransaction } from './ledger'

type IntegrationRow = typeof integrations.$inferSelect

/** What a receipt hands its transaction: the reference and the ticket it names. */
export interface TicketRecoveryPlan {
  reference: InboundTicketReference
  destination: IntegrationDestination
  ticketId: TicketId
}

/**
 * Read a receipt for a ticket worth proposing: the item names a live ticket
 * (and, by marker, this connection), its repository receives, nothing links
 * the item there, and no create for that ticket is still settling. Null
 * otherwise.
 */
export async function planTicketRecovery(
  integration: IntegrationRow,
  data: Record<string, unknown>
): Promise<TicketRecoveryPlan | null> {
  const definition = getIntegration(integration.integrationType)
  const parse = definition?.inbound?.parseTicketReference
  const multiple = definition?.destination?.multiple
  if (!parse || !multiple || !definition?.issues?.inspect || typeof data.body !== 'string')
    return null
  const reference = parse(data.body)
  if (!reference || !isValidTypeId(reference.ticketId, 'ticket')) return null
  if (reference.integrationId && reference.integrationId !== integration.id) return null
  const destination = await findInboundDestination(
    integration.id,
    multiple.kind,
    reference.destination
  )
  if (!destination || !destinationReceives(destination)) return null
  const ticketId = reference.ticketId as TicketId
  const [ticket] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)))
    .limit(1)
  if (!ticket) return null
  const [linked] = await db
    .select({ id: ticketExternalLinks.id })
    .from(ticketExternalLinks)
    .where(
      and(
        eq(ticketExternalLinks.integrationId, integration.id),
        eq(ticketExternalLinks.status, 'active'),
        eq(ticketExternalLinks.externalId, reference.externalId),
        eq(
          ticketExternalLinks.syncScope,
          syncScopeFor(integration, destinationTarget(destination), definition)
        )
      )
    )
    .limit(1)
  if (linked) return null
  // A create still settling links its issue itself (or offers this recovery as its own review).
  const [settling] = await db
    .select({ id: operations.id })
    .from(operations)
    .where(
      and(
        eq(operations.installation, installationIdentity(integration)),
        eq(operations.kind, 'create'),
        eq(operations.sourceType, 'ticket'),
        eq(operations.sourceId, ticketId),
        eq(
          operations.destinationKey,
          syncHash(
            syncDestination(
              destinationTarget(destination),
              (integration.config ?? {}) as Record<string, unknown>,
              definition
            )
          )
        ),
        inArray(operations.state, ['queued', 'running', 'retry_wait', 'uncertain'])
      )
    )
    .limit(1)
  if (settling) return null
  return { reference, destination, ticketId }
}

/** Record the review item, once per ticket, item and destination, in the receipt's transaction. */
export async function queueTicketRecovery(
  tx: SyncTransaction,
  integration: IntegrationRow,
  plan: TicketRecoveryPlan
): Promise<{ id: string; state: string } | null> {
  const installation = installationIdentity(integration)
  const target = destinationTarget(plan.destination)
  const destination = syncDestination(
    target,
    (integration.config ?? {}) as Record<string, unknown>,
    getIntegration(integration.integrationType)
  )
  const { reference } = plan
  return queueSyncOperation(
    {
      operationKey: syncOperationKey({
        installation,
        kind: 'relink',
        sourceType: 'ticket',
        sourceId: plan.ticketId,
        destination,
        remoteId: reference.externalId,
      }),
      integrationId: integration.id,
      installation,
      provider: integration.integrationType,
      direction: 'inbound',
      kind: 'relink',
      sourceType: 'ticket',
      sourceId: plan.ticketId,
      destination,
      remoteId: reference.externalId,
      state: 'conflict',
      errorCode: 'unlinked_remote',
      result: {
        externalDisplayId: reference.externalDisplayId,
        externalUrl: reference.externalUrl,
      },
      // The target lets the review inspect the issue in its own repository.
      payload: { executor: 'relink', data: { target } },
    },
    tx
  )
}
