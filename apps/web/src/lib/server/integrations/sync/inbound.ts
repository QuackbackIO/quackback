import {
  and,
  eq,
  sql,
  integrations,
  postExternalLinks,
  ticketExternalLinks,
  type Ticket,
} from '@/lib/server/db'
import type { PostId, TicketId } from '@quackback/ids'
import {
  resolveStatusMapping,
  resolveTicketStatusMapping,
  type StatusMappings,
} from '../status-mapping'
import type { InboundWebhookResult } from '../inbound-types'
import { installationIdentity, syncDestination, syncOperationKey, syncHash } from './identity'
import { queueSyncOperation, type SyncTransaction } from './ledger'
import type { SyncClaim, SyncOutcome } from './types'
import { hasNewerInbound } from './ordering'
import { getIntegration } from '../index'
import { getIntegrationAuth } from '../token-refresh'

/** Persist the authenticated body before any provider reads or enrichment. */
export async function queueInboundWebhook(
  integration: typeof integrations.$inferSelect,
  body: string,
  deliveryKey: string
) {
  const installation = installationIdentity(integration)
  const destination = syncDestination(
    { receipt: true },
    (integration.config ?? {}) as Record<string, unknown>,
    getIntegration(integration.integrationType)
  )
  return queueSyncOperation({
    operationKey: syncOperationKey({
      installation,
      kind: 'receive-webhook',
      sourceType: 'event',
      sourceId: deliveryKey,
      destination,
    }),
    integrationId: integration.id,
    installation,
    provider: integration.integrationType,
    direction: 'inbound',
    kind: 'receive-webhook',
    sourceType: 'event',
    sourceId: deliveryKey,
    destination,
    payload: { executor: 'inbound-webhook', data: { body, deliveryKey } },
  })
}

export async function parseInboundWebhook(
  integration: typeof integrations.$inferSelect,
  data: Record<string, unknown>
): Promise<InboundWebhookResult[]> {
  const handler = getIntegration(integration.integrationType)?.inbound
  if (!handler || typeof data.body !== 'string') throw new Error('Inbound handler unavailable')
  const auth = await getIntegrationAuth(integration.id)
  const result = await handler.parseStatusChange(data.body, auth.config, {
    ...auth.secrets,
    accessToken: auth.accessToken,
  })
  return result ? (Array.isArray(result) ? result : [result]) : []
}

export async function queueInboundStatus(
  integration: typeof integrations.$inferSelect,
  result: InboundWebhookResult,
  deliveryKey: string,
  executor?: SyncTransaction
) {
  const installation = installationIdentity(integration)
  const destination = syncDestination(
    { channelId: result.destinationId ?? 'unverified' },
    (integration.config ?? {}) as Record<string, unknown>,
    getIntegration(integration.integrationType)
  )
  return queueSyncOperation(
    {
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
    },
    executor
  )
}

export async function applyInboundStatus(
  tx: SyncTransaction,
  claim: SyncClaim,
  integration: typeof integrations.$inferSelect,
  data: Record<string, unknown>,
  updatedTickets: Ticket[] = []
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
  if (getIntegration(op.provider)?.inbound?.statusMode !== 'automatic' || !result.destinationId)
    return { state: 'conflict', errorCode: 'missing_baseline' }
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
      external,
      updatedTickets
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
  const automatic =
    getIntegration(op.provider)?.inbound?.statusMode === 'automatic' && !!result.destinationId
  // Missing signed scope is sufficient only for a manual review of an existing
  // link in the current destination. It must never authorize a local update.
  const destination = result.destinationId
    ? op.destination
    : syncDestination(
        { channelId: config.channelId },
        config,
        getIntegration(integration.integrationType)
      )
  const linkScope = `${op.installation}:${syncHash(destination)}`
  const [postLinks, ticketLinks] = await Promise.all([
    tx
      .select()
      .from(postExternalLinks)
      .where(
        and(
          eq(postExternalLinks.integrationId, integration.id),
          eq(postExternalLinks.status, 'active'),
          eq(postExternalLinks.externalId, result.externalId),
          eq(postExternalLinks.syncScope, linkScope)
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
          eq(ticketExternalLinks.syncScope, linkScope)
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
          destination,
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
        destination,
        remoteId: result.externalId,
        sourceRevision: op.sourceRevision ?? undefined,
        state: automatic ? 'queued' : 'conflict',
        errorCode: automatic ? undefined : 'missing_baseline',
        result: {
          externalUrl: link.externalUrl,
          externalDisplayId: link.externalDisplayId || result.externalId,
        },
        payload: {
          executor: 'inbound-status',
          data: { result, linkId: link.id, deliveryKey: data.deliveryKey },
        },
      },
      tx
    )
  }
}
