import { fromUuid, type IntegrationId, type TicketId } from '@quackback/ids'
import {
  db,
  sql,
  eq,
  and,
  integrations,
  integrationDestinations,
  integrationEventMappings,
  ticketExternalLinks,
  tickets,
  type EventMappingFilters,
} from '@/lib/server/db'
import type { HookJobData } from '@/lib/server/events/hook-job'
import type { JobSqlExecutor } from '@/lib/server/jobs/job-queue'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { getIntegration } from '../index'
import { getIntegrationAuth } from '../token-refresh'
import { destinationSends, outboundAllowed } from '../destinations'
import { ticketMatchesFilters } from '../ticket-issues'
import { installationIdentity, syncDestination, syncHash, syncOperationKey } from './identity'
import { markSyncDispatched, queueSyncOperation, readSyncPayload } from './ledger'
import { withSyncTransport } from './transport'
import type { SyncClaim, SyncOutcome } from './types'
import { canDispatchSync } from './eligibility'

type IntegrationRow = typeof integrations.$inferSelect

/** The one create identity per ticket, connection and destination, whoever asks for it. */
export function ticketCreateKey(input: {
  installation: string
  destination: Record<string, unknown>
  ticketId: string
}): string {
  return syncOperationKey({
    installation: input.installation,
    destination: input.destination,
    sourceType: 'ticket',
    sourceId: input.ticketId,
    kind: 'create',
  })
}

/**
 * Whether a destination's own ticket opt-in covers this ticket now. Reads
 * through `executor` so the relay can ask inside its transaction and the
 * worker can ask again just before sending. Every rule, in order:
 *
 * - an enabled `eventType` mapping routed to `target` whose team and
 *   ticket-type filters the ticket's current team and type pass;
 * - the ticket was opened at or after that mapping was made (the opt-in is
 *   forward-only, as sync itself is);
 * - the destination takes new work: switched on and not inbound-only;
 * - the ticket did not come in through this provider (an issue opened it);
 * - no issue in that destination is linked to it already.
 */
export async function ticketIssueAllowed(
  executor: JobSqlExecutor,
  input: {
    integration: Pick<IntegrationRow, 'id' | 'integrationType' | 'connectedAt' | 'config'>
    target: { channelId: unknown }
    ticketId: string
    eventType: string
  }
): Promise<boolean> {
  const { integration, target } = input
  const config = (integration.config ?? {}) as Record<string, unknown>
  const definition = getIntegration(integration.integrationType)
  const [ticket] = getExecuteRows<{
    created_at: string
    assignee_team_id: string | null
    ticket_type_id: string | null
    channel: string | null
  }>(
    await executor.execute(sql`
      SELECT tickets.created_at, tickets.assignee_team_id, tickets.ticket_type_id,
        (SELECT c.channel FROM ticket_conversations tc
          JOIN conversations c ON c.id = tc.conversation_id
          WHERE tc.ticket_id = tickets.id AND tc.ticket_type = 'customer' LIMIT 1) AS channel
      FROM ${tickets}
      WHERE ${eq(tickets.id, input.ticketId as TicketId)} AND tickets.deleted_at IS NULL`)
  )
  if (!ticket || ticket.channel === integration.integrationType) return false

  const facts = {
    teamId: ticket.assignee_team_id ? fromUuid('team', ticket.assignee_team_id) : null,
    ticketTypeId: ticket.ticket_type_id ? fromUuid('ticket_type', ticket.ticket_type_id) : null,
  }
  const mappings = getExecuteRows<{
    action_config: Record<string, unknown> | null
    filters: EventMappingFilters | null
    created_at: string
  }>(
    await executor.execute(sql`
      SELECT action_config, filters, created_at FROM ${integrationEventMappings}
      WHERE ${and(
        eq(integrationEventMappings.integrationId, integration.id as IntegrationId),
        eq(integrationEventMappings.eventType, input.eventType),
        eq(integrationEventMappings.enabled, true)
      )}`)
  )
  const openedAt = new Date(ticket.created_at).getTime()
  if (
    !mappings.some(
      (m) =>
        (m.action_config?.channelId || config.channelId) === target.channelId &&
        ticketMatchesFilters(m.filters, facts) &&
        openedAt >= new Date(m.created_at).getTime()
    )
  )
    return false

  const multiple = definition?.destination?.multiple
  if (multiple) {
    const rows = getExecuteRows<{
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
    const name = typeof target.channelId === 'string' ? target.channelId.toLowerCase() : null
    const destination = rows.find((row) => row.external_id.toLowerCase() === name)
    if (rows.length && !(destination && destinationSends(destination))) return false
  }

  const scope = `${installationIdentity(integration)}:${syncHash(syncDestination(target, config, definition))}`
  const [linked] = getExecuteRows(
    await executor.execute(sql`
      SELECT 1 FROM ${ticketExternalLinks} WHERE ${and(
        eq(ticketExternalLinks.ticketId, input.ticketId as TicketId),
        eq(ticketExternalLinks.integrationId, integration.id as IntegrationId),
        eq(ticketExternalLinks.syncScope, scope),
        eq(ticketExternalLinks.status, 'active')
      )} LIMIT 1`)
  )
  return !linked
}

/**
 * Queue the issue a destination's ticket opt-in asks for, under the same
 * create identity as a teammate's "Create issue" for that ticket and
 * destination, so each destination gets one issue per ticket however many
 * events ask. Nothing is queued for a change the integration made itself (a
 * ticket opened from one of its issues, a team its sync set), nor when the
 * opt-in does not cover the ticket; an earlier cancelled attempt the ticket
 * now qualifies for is resumed by the ledger.
 */
export async function queueTicketIssueSync(
  data: HookJobData,
  executor: JobSqlExecutor
): Promise<{ id: string; state: string } | null> {
  const integrationId = String(data.config.integrationId)
  const ticketId = (data.event.data as { ticket?: { id?: string } }).ticket?.id
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
  if (!row || row.status !== 'active' || !ticketId) return null
  const actor = data.event.actor
  // The loop rule: what the integration's own principal did came from that platform.
  if (
    actor.type === 'service' &&
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
  const target = data.target as { channelId: unknown }
  if (
    !(await ticketIssueAllowed(executor, {
      integration,
      target,
      ticketId,
      eventType: data.event.type,
    }))
  )
    return null
  const installation = installationIdentity(integration)
  const destination = syncDestination(target, row.config, getIntegration(row.integration_type))
  return queueSyncOperation(
    {
      operationKey: ticketCreateKey({ installation, destination, ticketId }),
      integrationId,
      installation,
      provider: row.integration_type,
      direction: 'outbound',
      kind: 'create',
      sourceType: 'ticket',
      sourceId: ticketId,
      destination,
      payload: { executor: 'ticket-create', data: { target, eventType: data.event.type } },
    },
    executor
  )
}

export async function executeTicketCreate(
  claim: SyncClaim,
  integration: IntegrationRow
): Promise<SyncOutcome> {
  const issues = getIntegration(integration.integrationType)?.issues
  if (!issues?.create) return { state: 'cancelled', errorCode: 'installation_changed' }
  const config = (integration.config ?? {}) as Record<string, unknown>
  const data = readSyncPayload(claim.operation).data
  // The repository chosen at request time; requests queued before targets
  // were recorded went to the connection's own repository.
  const target = (data.target as { channelId: unknown } | undefined) ?? {
    channelId: config.channelId,
  }
  if (
    syncHash(syncDestination(target, config, getIntegration(integration.integrationType))) !==
    claim.operation.destinationKey
  )
    return { state: 'cancelled', errorCode: 'installation_changed' }
  // An automatic create asks again against the current ticket, opt-in and
  // destination. One that no longer qualifies is set aside as unavailable,
  // which a later qualifying change or a teammate's create resumes, rather
  // than closing that ticket's create in the destination for good.
  if (typeof data.eventType === 'string') {
    const allowed = await ticketIssueAllowed(db, {
      integration,
      target,
      ticketId: claim.operation.sourceId,
      eventType: data.eventType,
    })
    if (!allowed) return { state: 'cancelled', errorCode: 'source_unavailable' }
  } else if (!(await outboundAllowed(integration, target.channelId)))
    return { state: 'cancelled', errorCode: 'installation_changed' }
  const { buildTicketIssueData } = await import('@/lib/server/domains/tickets/ticket-issue-source')
  const ticket = await buildTicketIssueData(claim.operation.sourceId as TicketId)
  const content = issues.formatTicketIssue?.(ticket.ticket, { integrationId: integration.id }) ?? {
    title: ticket.title,
    bodyMarkdown: ticket.bodyMarkdown,
  }
  const credentials = await getIntegrationAuth(integration.id)
  const auth = {
    ...credentials.config,
    ...credentials.secrets,
    accessToken: credentials.accessToken,
    channelId: target.channelId,
  }
  if (!(await canDispatchSync(claim.operation, integration)) || !(await markSyncDispatched(claim)))
    return { state: 'cancelled' }
  return withSyncTransport(async () => ({
    state: 'succeeded',
    result: { ...(await issues.create!({ auth, ...content })) },
  }))
}
