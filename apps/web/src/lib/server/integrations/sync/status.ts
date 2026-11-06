import { getIntegration } from '@/lib/server/integrations'
import {
  eq,
  and,
  sql,
  integrations,
  integrationDestinations,
  postExternalLinks,
  ticketExternalLinks,
} from '@/lib/server/db'
import type { IntegrationId } from '@quackback/ids'
import type { HookJobData } from '@/lib/server/events/hook-job'
import type { JobSqlExecutor } from '@/lib/server/jobs/job-queue'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { queueSyncOperation } from './ledger'
import { installationIdentity, linkTarget, reviewDestination, syncOperationKey } from './identity'
import { hookSource } from './hooks'
import { linkUpdatesAutomatically } from './issue-updates'

/**
 * Status is a remote edit too, so an outbound status change is a review
 * proposal. The exception is a ticket link in a destination that updates its
 * issues automatically through a guarded provider (`applyAutomatically`, see
 * `issue-updates.ts`): that link gets the update from the issue-update sink
 * instead, and no proposal here.
 */
export async function queueStatusSync(data: HookJobData, tx: JobSqlExecutor) {
  const integrationId = String(data.config.integrationId)
  const [integration] = getExecuteRows<{
    connected_at: string | null
    config: Record<string, unknown>
    integration_type: string
    status: string
  }>(
    await tx.execute(sql`SELECT connected_at, config, integration_type, status FROM integrations
      WHERE ${eq(integrations.id, integrationId as IntegrationId)}`)
  )
  const target = data.target as { externalId: string; linkId?: string }
  const source = hookSource(data)
  const config = integration?.config ?? {}
  const installation = installationIdentity({
    id: integrationId,
    connectedAt: integration?.connected_at ?? null,
  })
  const links = source.sourceType === 'post' ? postExternalLinks : ticketExternalLinks
  const sourceColumn =
    source.sourceType === 'post' ? postExternalLinks.postId : ticketExternalLinks.ticketId
  if (!target.linkId || !['post', 'ticket'].includes(source.sourceType))
    throw new Error('Status sync requires a source link')
  const [link] = getExecuteRows<{
    sync_scope: string | null
    external_url: string | null
    external_display_id: string | null
  }>(
    await tx.execute(sql`
    SELECT sync_scope, external_url, external_display_id FROM ${links} WHERE ${and(
      eq(links.id, target.linkId as never),
      eq(links.integrationId, integrationId as never),
      eq(links.externalId, target.externalId),
      eq(sourceColumn, source.sourceId as never),
      eq(links.status, 'active')
    )}`)
  )
  if (!link) throw new Error('Status sync link is no longer available')
  if (!link.sync_scope) return null
  if (
    source.sourceType === 'ticket' &&
    (await linkUpdatesAutomatically(
      tx,
      {
        id: integrationId as IntegrationId,
        integrationType: integration?.integration_type ?? 'unknown',
        connectedAt: integration?.connected_at ? new Date(integration.connected_at) : null,
        config,
      },
      link.sync_scope
    ))
  )
    return null
  const reviewed = { id: target.linkId, syncScope: link.sync_scope }
  const connection = {
    id: integrationId,
    connectedAt: integration?.connected_at ?? null,
    config,
    integrationType: integration?.integration_type ?? 'unknown',
  }
  const definition = getIntegration(integration?.integration_type ?? '')
  // The link may be on any repository the connection syncs, not only its default.
  const channelIds = definition?.destination?.multiple
    ? getExecuteRows<{ external_id: string }>(
        await tx.execute(
          sql`SELECT external_id FROM ${integrationDestinations} WHERE ${eq(integrationDestinations.integrationId, integrationId as IntegrationId)}`
        )
      ).map((row) => row.external_id)
    : []
  const destination = reviewDestination(reviewed, connection, definition, channelIds)
  const remoteTarget = linkTarget(reviewed, connection, definition, channelIds)
  return queueSyncOperation(
    {
      operationKey: syncOperationKey({
        installation,
        destination,
        ...source,
        kind: 'status',
        remoteId: target.externalId,
        revision: data.event.id,
      }),
      integrationId,
      installation,
      provider: integration?.integration_type ?? 'unknown',
      direction: 'outbound',
      kind: 'status',
      ...source,
      destination,
      remoteId: target.externalId,
      state: integration?.status !== 'active' ? 'cancelled' : 'conflict',
      errorCode: 'manual_update',
      result: { externalUrl: link.external_url, externalDisplayId: link.external_display_id },
      payload: {
        executor: 'refresh',
        data: {
          linkId: target.linkId,
          sourceStatusId: data.config.sourceStatusId,
          proposedStatus: data.config.remoteStatus,
          ...(remoteTarget ? { target: remoteTarget } : {}),
        },
      },
    },
    tx
  )
}
