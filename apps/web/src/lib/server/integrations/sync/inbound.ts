import { and, eq, sql, integrations, postExternalLinks, ticketExternalLinks } from '@/lib/server/db'
import type { PostId, TicketId } from '@quackback/ids'
import {
  resolveStatusMapping,
  resolveTicketStatusMapping,
  type StatusMappings,
} from '../status-mapping'
import type { InboundWebhookResult } from '../inbound-types'
import { installationIdentity, syncDestination, syncOperationKey } from './identity'
import { queueSyncOperation, type SyncTransaction } from './ledger'
import type { SyncClaim, SyncOutcome } from './types'
import { hasNewerInbound } from './ordering'

export async function queueInboundStatus(
  integration: typeof integrations.$inferSelect,
  result: InboundWebhookResult,
  deliveryKey: string
) {
  const installation = installationIdentity(integration)
  const destination = syncDestination(
    { channelId: result.destinationId ?? 'unverified' },
    (integration.config ?? {}) as Record<string, unknown>
  )
  return queueSyncOperation({
    operationKey: syncOperationKey({
      installation,
      kind: 'receive-status',
      sourceType: 'event',
      sourceId: deliveryKey,
      destination,
    }),
    integrationId: integration.id,
    installation,
    provider: integration.integrationType,
    direction: 'inbound',
    kind: 'receive-status',
    sourceType: 'event',
    sourceId: deliveryKey,
    destination,
    sourceRevision:
      result.occurredAt && Number.isFinite(Date.parse(result.occurredAt))
        ? new Date(result.occurredAt).toISOString()
        : undefined,
    payload: { executor: 'inbound-status', data: { result, deliveryKey } },
  })
}

export async function applyInboundStatus(
  tx: SyncTransaction,
  claim: SyncClaim,
  integration: typeof integrations.$inferSelect,
  data: Record<string, unknown>
): Promise<void | SyncOutcome> {
  const [current] = await tx
    .select()
    .from(integrations)
    .where(eq(integrations.id, integration.id))
    .for('share')
  if (
    !current ||
    current.status !== 'active' ||
    installationIdentity(current) !== claim.operation.installation
  )
    return { state: 'cancelled', errorCode: 'installation_changed' }
  integration = current
  const result = data.result as InboundWebhookResult
  const op = claim.operation
  const config = (integration.config ?? {}) as Record<string, unknown>
  if (!config.statusSyncEnabled || !integration.principalId)
    return { state: 'cancelled', errorCode: 'installation_changed' }
  // Serialize local changes from different remote links to this source too.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${op.sourceType}:${op.sourceId}`}, 0))`
  )
  if (!op.sourceRevision) return { state: 'conflict', errorCode: 'missing_baseline' }
  if (await hasNewerInbound(tx, op)) return { state: 'superseded' }
  const links = op.sourceType === 'post' ? postExternalLinks : ticketExternalLinks
  const [link] = await tx
    .select()
    .from(links)
    .where(
      and(
        eq(links.id, data.linkId as never),
        eq(links.integrationId, integration.id),
        eq(links.status, 'active'),
        eq(links.syncScope, `${op.installation}:${op.destinationKey}`)
      )
    )
  if (!link || link.externalId !== result.externalId)
    return { state: 'cancelled', errorCode: 'source_unavailable' }
  await tx
    .update(links)
    .set({ remoteState: result.externalStatus.slice(0, 64), remoteStateAt: new Date() })
    .where(eq(links.id, link.id))
  const external = {
    integrationType: op.provider,
    externalDisplayId: link.externalDisplayId,
    externalUrl: link.externalUrl,
    externalStatus: result.externalStatus,
    transition: result.transition ?? null,
    deliveryKey: String(data.deliveryKey),
  }
  if (op.sourceType === 'post') {
    const { applySyncedPostStatus } = await import('@/lib/server/domains/posts/post-status-sync')
    await applySyncedPostStatus(
      tx,
      op.sourceId as PostId,
      resolveStatusMapping(
        result.externalStatus,
        config.statusMappings as StatusMappings | undefined
      ),
      integration.principalId,
      external
    )
  } else {
    const { applySyncedTicketStatus } =
      await import('@/lib/server/domains/tickets/ticket-status-sync')
    await applySyncedTicketStatus(
      tx,
      op.sourceId as TicketId,
      resolveTicketStatusMapping(
        result.externalStatus,
        config.ticketStatusMappings as StatusMappings | undefined
      ),
      integration.principalId,
      external
    )
  }
}

/** Each linked source has its own durable operation; a failing branch cannot starve another. */
export async function fanOutInboundStatus(
  tx: SyncTransaction,
  claim: SyncClaim,
  integration: typeof integrations.$inferSelect,
  data: Record<string, unknown>
) {
  const result = data.result as InboundWebhookResult
  const op = claim.operation
  const config = (integration.config ?? {}) as Record<string, unknown>
  if (!config.statusSyncEnabled) return
  if (!result.destinationId)
    return { state: 'conflict' as const, errorCode: 'missing_baseline' as const }
  const [postLinks, ticketLinks] = await Promise.all([
    tx
      .select()
      .from(postExternalLinks)
      .where(
        and(
          eq(postExternalLinks.integrationId, integration.id),
          eq(postExternalLinks.status, 'active'),
          eq(postExternalLinks.externalId, result.externalId),
          eq(postExternalLinks.syncScope, `${op.installation}:${op.destinationKey}`)
        )
      ),
    tx
      .select()
      .from(ticketExternalLinks)
      .where(
        and(
          eq(ticketExternalLinks.integrationId, integration.id),
          eq(ticketExternalLinks.status, 'active'),
          eq(ticketExternalLinks.externalId, result.externalId),
          eq(ticketExternalLinks.syncScope, `${op.installation}:${op.destinationKey}`)
        )
      ),
  ])
  for (const link of [...postLinks, ...ticketLinks]) {
    const sourceType = 'postId' in link ? 'post' : 'ticket'
    const sourceId = 'postId' in link ? link.postId : link.ticketId
    await queueSyncOperation(
      {
        operationKey: syncOperationKey({
          installation: op.installation,
          kind: 'status',
          sourceType,
          sourceId,
          destination: op.destination,
          remoteId: result.externalId,
          revision: String(data.deliveryKey),
        }),
        installation: op.installation,
        integrationId: integration.id,
        provider: integration.integrationType,
        direction: 'inbound',
        kind: 'status',
        sourceType,
        sourceId,
        destination: op.destination,
        remoteId: result.externalId,
        sourceRevision: op.sourceRevision ?? undefined,
        state: 'queued',
        payload: {
          executor: 'inbound-status',
          data: { result, linkId: link.id, deliveryKey: data.deliveryKey },
        },
      },
      tx
    )
  }
}
