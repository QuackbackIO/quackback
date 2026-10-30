/**
 * Linked issues kept in step with their tickets, automatically, in
 * destinations that opt in (`applyAutomatically`, off by default).
 *
 * This is the one automatic edit of remote content the framework allows, and
 * only through a provider that declares `issues.writeContract: 'guarded'`:
 * the provider reads the issue, writes nothing when it changed on the
 * platform since we last saw it (the link's `remote_state` and
 * `remote_state_at`), and otherwise writes only what differs. A refused write
 * is a review in Sync history, the same proposal the opt-out path makes.
 * After a write the link records the issue's new state and version, so our
 * own write is never mistaken for someone else's.
 *
 * What follows the ticket, one operation per event and linked issue:
 *
 * - `issue-status` (`ticket.status_changed`): the state, a closed issue's
 *   reason and the status label the destination's `pushStatusMappings` (or
 *   the default) give the ticket's status, taking off the other status labels
 *   those mappings name.
 * - `issue-priority` (`ticket.priority_changed`): `priority:<p>` on, any
 *   other `priority:*` off.
 * - `issue-assignees` (`ticket.assigned`), where `assigneeSync` is also on:
 *   the assignee's matched account (`integration_user_mappings`), or none
 *   when unassigned or unmatched.
 * - `issue-title` (`ticket.updated` with a new title): the title, and the
 *   body re-rendered while it is still the one this connection wrote.
 *
 * Every operation reads the ticket as it is when it runs, and one older than
 * a later operation for the same issue and kind is superseded, so an older
 * change never overwrites a newer one. Nothing follows a change the
 * integration's own principal made (it came from the platform), nor a
 * ticket paired with one of the provider's inbox conversations, which the
 * channel keeps in step.
 */
import { fromUuid, type IntegrationId, type TicketId } from '@quackback/ids'
import {
  db,
  sql,
  eq,
  and,
  isNull,
  integrations,
  integrationDestinations,
  integrationSyncOperations as operations,
  ticketExternalLinks,
  ticketStatuses,
  tickets,
} from '@/lib/server/db'
import type { HookJobData } from '@/lib/server/events/hook-job'
import type { JobSqlExecutor } from '@/lib/server/jobs/job-queue'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import {
  issuePushStateFor,
  ownedStatusLabels,
  priorityLabel,
  type IssuePushState,
  type IssuePushStateMappings,
} from '@/lib/shared/issue-push'
import { CONVERSATION_PRIORITIES } from '@/lib/shared/db-types'
import { getIntegration } from '../index'
import { getIntegrationAuth } from '../token-refresh'
import { destinationSends } from '../destinations'
import { externalUserForPrincipal } from '../user-mappings'
import type { IntegrationDefinition, IssueUpdateChange } from '../types'
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
import type { SyncClaim, SyncOperation, SyncOutcome } from './types'

type IntegrationRow = typeof integrations.$inferSelect

/** The sink the issue-update resolver routes to. */
export const ISSUE_UPDATE_HOOK = 'issue_update'

/** The ticket events a linked issue follows. */
export const ISSUE_UPDATE_EVENTS: readonly string[] = [
  'ticket.status_changed',
  'ticket.priority_changed',
  'ticket.assigned',
  'ticket.updated',
]

export const ISSUE_UPDATE_KINDS = [
  'issue-status',
  'issue-priority',
  'issue-assignees',
  'issue-title',
] as const
export type IssueUpdateKind = (typeof ISSUE_UPDATE_KINDS)[number]

export function isIssueUpdateKind(kind: string): kind is IssueUpdateKind {
  return (ISSUE_UPDATE_KINDS as readonly string[]).includes(kind)
}

/** What an event asks of a linked issue, or null (a `ticket.updated` that left the title alone). */
export function issueUpdateKind(event: { type: string; data?: unknown }): IssueUpdateKind | null {
  if (event.type === 'ticket.status_changed') return 'issue-status'
  if (event.type === 'ticket.priority_changed') return 'issue-priority'
  if (event.type === 'ticket.assigned') return 'issue-assignees'
  if (event.type === 'ticket.updated') {
    const keys = (event.data as { changedKeys?: unknown } | undefined)?.changedKeys
    return Array.isArray(keys) && keys.includes('title') ? 'issue-title' : null
  }
  return null
}

/** Whether a provider keeps the guarded write contract automatic issue updates need. */
export function updatesIssuesGuarded(
  definition: Pick<IntegrationDefinition, 'issues' | 'destination'> | undefined
): boolean {
  return (
    !!definition?.issues?.update &&
    definition.issues.writeContract === 'guarded' &&
    !!definition.destination?.multiple
  )
}

/** Whether a destination updates its issues automatically: opted in, switched on and sending. */
export function issueAutoUpdateOn(destination: {
  enabled: boolean
  config: Record<string, unknown> | null
}): boolean {
  return (
    destination.config?.applyAutomatically === true &&
    destinationSends({ enabled: destination.enabled, config: destination.config ?? {} })
  )
}

interface DestinationRow {
  external_id: string
  enabled: boolean
  config: Record<string, unknown>
}

type Connection = Pick<IntegrationRow, 'id' | 'integrationType' | 'connectedAt' | 'config'>

/** The destination a link was made on, among the connection's destinations of its kind. */
async function linkDestination(
  executor: JobSqlExecutor,
  integration: Connection,
  syncScope: string
): Promise<DestinationRow | null> {
  const definition = getIntegration(integration.integrationType)
  const multiple = definition?.destination?.multiple
  if (!multiple) return null
  const destinations = getExecuteRows<DestinationRow>(
    await executor.execute(sql`
      SELECT external_id, enabled, config FROM ${integrationDestinations}
      WHERE ${and(
        eq(integrationDestinations.integrationId, integration.id as IntegrationId),
        eq(integrationDestinations.kind, multiple.kind)
      )}`)
  )
  const target = linkTarget(
    { syncScope },
    integration,
    definition,
    destinations.map((d) => d.external_id)
  )
  return destinations.find((d) => d.external_id === target?.channelId) ?? null
}

/**
 * Whether the link with this scope sits in a destination that updates its
 * issues automatically, through a guarded provider. The status-review path
 * (`sync/status.ts`) asks, so such a link gets the update, not a proposal.
 */
export async function linkUpdatesAutomatically(
  executor: JobSqlExecutor,
  integration: Connection,
  syncScope: string
): Promise<boolean> {
  if (!updatesIssuesGuarded(getIntegration(integration.integrationType))) return false
  const destination = await linkDestination(executor, integration, syncScope)
  return !!destination && issueAutoUpdateOn(destination)
}

interface UpdateRoute {
  link: {
    id: string
    externalId: string
    externalDisplayId: string | null
    externalUrl: string | null
    remoteState: string | null
    remoteStateAt: Date | null
    createdAt: Date
  }
  target: { channelId: string }
  config: Record<string, unknown>
}

/**
 * Where an update of `kind` for `ticketId` goes through the link `linkId`, or
 * null when it goes nowhere. Reads through `executor`, so the relay asks
 * inside its transaction and the worker asks again before writing. Every rule:
 *
 * - the provider keeps the guarded write contract;
 * - the link is an active link of this live ticket on this connection;
 * - the ticket is not paired with one of the provider's inbox conversations;
 * - the link's destination updates its issues automatically (opted in,
 *   switched on, not inbound-only), and for assignees also has
 *   `assigneeSync` on.
 */
async function updateRoute(
  executor: JobSqlExecutor,
  integration: Connection,
  input: { linkId: string; ticketId: string; kind: IssueUpdateKind }
): Promise<UpdateRoute | null> {
  if (!updatesIssuesGuarded(getIntegration(integration.integrationType))) return null
  const [link] = getExecuteRows<{
    external_id: string
    external_display_id: string | null
    external_url: string | null
    sync_scope: string
    remote_state: string | null
    remote_state_at: string | Date | null
    created_at: string | Date
    channel: string | null
  }>(
    await executor.execute(sql`
      SELECT ticket_external_links.external_id, ticket_external_links.external_display_id,
        ticket_external_links.external_url, ticket_external_links.sync_scope,
        ticket_external_links.remote_state, ticket_external_links.remote_state_at,
        ticket_external_links.created_at,
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
  const destination = await linkDestination(executor, integration, link.sync_scope)
  if (!destination || !issueAutoUpdateOn(destination)) return null
  if (input.kind === 'issue-assignees' && destination.config.assigneeSync !== true) return null
  return {
    link: {
      id: input.linkId,
      externalId: link.external_id,
      externalDisplayId: link.external_display_id,
      externalUrl: link.external_url,
      remoteState: link.remote_state,
      remoteStateAt: link.remote_state_at ? new Date(link.remote_state_at) : null,
      createdAt: new Date(link.created_at),
    },
    target: { channelId: destination.external_id },
    config: destination.config,
  }
}

/** A status's issue as a line of text, for a review's proposal. */
function describePushState(statusName: string, push: IssuePushState): string {
  const state =
    push.state === 'closed'
      ? `closed (${push.stateReason === 'not_planned' ? 'not planned' : 'completed'})`
      : 'open'
  return `${statusName}: ${state}${push.label ? `, label ${push.label}` : ''}`
}

/**
 * What the event proposes, as a review would show it should the guard
 * refuse the write. Null when there is nothing to propose (a status the
 * destination leaves alone).
 */
async function proposedChange(
  executor: JobSqlExecutor,
  integrationId: IntegrationId,
  kind: IssueUpdateKind,
  ticketId: string,
  event: HookJobData['event'],
  route: UpdateRoute
): Promise<string | null> {
  const data = event.data as unknown as Record<string, unknown>
  if (kind === 'issue-priority') {
    const label = priorityLabel(String(data.newPriority ?? 'none'))
    return label ? `Label ${label}` : 'No priority label'
  }
  if (kind === 'issue-title') return `Title: ${String(data.title ?? '')}`
  if (kind === 'issue-assignees') {
    const principalId =
      typeof data.assignedPrincipalId === 'string' ? data.assignedPrincipalId : null
    const account = principalId
      ? await externalUserForPrincipal(integrationId, principalId as never)
      : null
    return account ? `Assignee: ${account.externalLogin}` : 'No assignee'
  }
  const [status] = getExecuteRows<{
    id: string
    name: string
    category: 'open' | 'pending' | 'closed'
    public_stage: 'received' | 'in_progress' | 'awaiting_requester' | 'resolved' | null
  }>(
    await executor.execute(sql`
      SELECT s.id, s.name, s.category, s.public_stage FROM ${ticketStatuses} s
      JOIN ${tickets} ON tickets.status_id = s.id
      WHERE ${eq(tickets.id, ticketId as TicketId)}`)
  )
  if (!status) return null
  const push = issuePushStateFor(
    route.config.pushStatusMappings as IssuePushStateMappings | undefined,
    {
      id: fromUuid('ticket_status', status.id),
      category: status.category,
      publicStage: status.public_stage,
    }
  )
  return push ? describePushState(status.name, push) : null
}

/**
 * Queue the update a ticket event asks of one linked issue
 * (`data.target.linkId`), in the relay's transaction.
 */
export async function queueIssueUpdateSync(
  data: HookJobData,
  executor: JobSqlExecutor
): Promise<{ id: string; state: string } | null> {
  const kind = issueUpdateKind(data.event)
  const ticketId = (data.event.data as { ticket?: { id?: string } }).ticket?.id
  const linkId = (data.target as { linkId?: unknown } | null)?.linkId
  if (!kind || !ticketId || typeof linkId !== 'string') return null
  const integrationId = String(data.config.integrationId) as IntegrationId
  const [row] = getExecuteRows<{
    connected_at: string | null
    config: Record<string, unknown>
    integration_type: string
    principal_id: string | null
    status: string
  }>(
    await executor.execute(sql`
      SELECT connected_at, config, integration_type, principal_id, status FROM ${integrations}
      WHERE ${eq(integrations.id, integrationId)}`)
  )
  if (!row || row.status !== 'active') return null
  // The loop rule: what the integration's own principal did came from that platform.
  const actor = data.event.actor
  if (
    actor?.type === 'service' &&
    row.principal_id &&
    actor.principalId === fromUuid('principal', row.principal_id)
  )
    return null
  const integration = {
    id: integrationId,
    integrationType: row.integration_type,
    connectedAt: row.connected_at ? new Date(row.connected_at) : null,
    config: row.config,
  }
  const route = await updateRoute(executor, integration, { linkId, ticketId, kind })
  if (!route) return null
  const proposal = await proposedChange(executor, integrationId, kind, ticketId, data.event, route)
  if (proposal === null) return null
  const installation = installationIdentity(integration)
  const destination = syncDestination(
    route.target,
    row.config,
    getIntegration(row.integration_type)
  )
  return queueSyncOperation(
    {
      operationKey: syncOperationKey({
        installation,
        destination,
        kind,
        sourceType: 'ticket',
        sourceId: ticketId,
        remoteId: route.link.externalId,
        revision: data.event.id,
      }),
      integrationId,
      installation,
      provider: row.integration_type,
      direction: 'outbound',
      kind,
      sourceType: 'ticket',
      sourceId: ticketId,
      sourceRevision: Number.isFinite(Date.parse(data.event.timestamp))
        ? new Date(data.event.timestamp).toISOString()
        : undefined,
      destination,
      remoteId: route.link.externalId,
      result: {
        externalUrl: route.link.externalUrl,
        externalDisplayId: route.link.externalDisplayId ?? route.link.externalId,
      },
      payload: {
        executor: 'remote-update',
        data: { target: route.target, linkId, ticketId, proposedChange: proposal },
      },
    },
    executor
  )
}

/**
 * Whether a later operation of the same kind for the same ticket and issue
 * exists (and was not cancelled): it reads the ticket afresh, so this one
 * has nothing left to say, and running it after could only go backwards.
 */
async function hasNewerUpdate(op: SyncOperation): Promise<boolean> {
  if (!op.sourceRevision) return false
  const [newer] = await db
    .select({ id: operations.id })
    .from(operations)
    .where(
      and(
        eq(operations.installation, op.installation),
        eq(operations.destinationKey, op.destinationKey),
        eq(operations.kind, op.kind),
        eq(operations.sourceType, op.sourceType),
        eq(operations.sourceId, op.sourceId),
        sql`${operations.remoteId} IS NOT DISTINCT FROM ${op.remoteId}`,
        sql`${operations.state} <> 'cancelled'`,
        sql`${operations.sourceRevision} > ${op.sourceRevision}`
      )
    )
    .limit(1)
  return !!newer
}

/** The change an operation asks of its issue, read from the ticket as it is now; null for none. */
async function currentChange(
  kind: IssueUpdateKind,
  ticketId: TicketId,
  integration: IntegrationRow,
  route: UpdateRoute
): Promise<IssueUpdateChange | null> {
  const [ticket] = await db
    .select({
      statusId: tickets.statusId,
      priority: tickets.priority,
      assigneePrincipalId: tickets.assigneePrincipalId,
      title: tickets.title,
    })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)))
    .limit(1)
  if (!ticket) return null
  if (kind === 'issue-status') {
    const statuses = await db
      .select({
        id: ticketStatuses.id,
        category: ticketStatuses.category,
        publicStage: ticketStatuses.publicStage,
      })
      .from(ticketStatuses)
    const mappings = route.config.pushStatusMappings as IssuePushStateMappings | undefined
    const status = statuses.find((s) => s.id === ticket.statusId)
    const push = status ? issuePushStateFor(mappings, status) : null
    if (!push) return null
    return {
      state: { state: push.state, ...(push.stateReason ? { stateReason: push.stateReason } : {}) },
      labels: {
        add: push.label ? [push.label] : [],
        remove: ownedStatusLabels(mappings, statuses),
      },
    }
  }
  if (kind === 'issue-priority') {
    const label = priorityLabel(ticket.priority)
    return {
      labels: {
        add: label ? [label] : [],
        remove: CONVERSATION_PRIORITIES.map(priorityLabel).filter((l): l is string => !!l),
      },
    }
  }
  if (kind === 'issue-assignees') {
    const account = ticket.assigneePrincipalId
      ? await externalUserForPrincipal(integration.id, ticket.assigneePrincipalId)
      : null
    return { assignees: account ? [account.externalLogin] : [] }
  }
  const format = getIntegration(integration.integrationType)?.issues?.formatTicketIssue
  if (!format) return { title: ticket.title }
  const { buildTicketIssueData } = await import('@/lib/server/domains/tickets/ticket-issue-source')
  const content = format((await buildTicketIssueData(ticketId)).ticket, {
    integrationId: integration.id,
  })
  return { title: ticket.title, body: content.bodyMarkdown }
}

/** Bring one linked issue in step with its ticket, through the provider's guarded write. */
export async function executeIssueUpdate(
  claim: SyncClaim,
  integration: IntegrationRow
): Promise<SyncOutcome> {
  const op = claim.operation
  const definition = getIntegration(integration.integrationType)
  const update = definition?.issues?.update
  if (!update || !updatesIssuesGuarded(definition) || !isIssueUpdateKind(op.kind))
    return { state: 'cancelled', errorCode: 'installation_changed' }
  const data = readSyncPayload(op).data as {
    target: { channelId: string }
    linkId: string
    ticketId: string
  }
  const config = (integration.config ?? {}) as Record<string, unknown>
  if (syncHash(syncDestination(data.target, config, definition)) !== op.destinationKey)
    return { state: 'cancelled', errorCode: 'installation_changed' }
  // Unlinked, its repository switched off or opted out, or paired with an inbox conversation since.
  const route = await updateRoute(db, integration, { ...data, kind: op.kind })
  if (!route || route.target.channelId !== data.target.channelId)
    return { state: 'cancelled', errorCode: 'source_unavailable' }
  if (await hasNewerUpdate(op)) return { state: 'superseded' }
  const remote = {
    externalId: route.link.externalId,
    externalUrl: route.link.externalUrl,
    externalDisplayId: route.link.externalDisplayId ?? route.link.externalId,
  }
  const change = await currentChange(op.kind, data.ticketId as TicketId, integration, route)
  if (!change) return { state: 'succeeded', result: { ...remote, changed: [] } }

  const credentials = await getIntegrationAuth(integration.id)
  const auth = {
    ...credentials.config,
    ...credentials.secrets,
    accessToken: credentials.accessToken,
    channelId: data.target.channelId,
  }
  let dispatched = false
  const outcome = await withSyncTransport(async () => {
    const result = await update({
      auth,
      issueId: route.link.externalId,
      ticketId: data.ticketId,
      integrationId: integration.id,
      baseline: {
        state: route.link.remoteState,
        at: route.link.remoteStateAt ?? route.link.createdAt,
      },
      change,
      beforeWrite: async () =>
        (dispatched =
          (await canDispatchSync(op, integration)) && (await markSyncDispatched(claim))),
    })
    if (result.outcome === 'cancelled') return { state: 'cancelled' }
    // Changed on the platform since we last saw it: a review, nothing written.
    if (result.outcome === 'conflict') return { state: 'conflict', errorCode: 'manual_update' }
    return {
      state: 'succeeded',
      result: {
        ...remote,
        changed: result.changed,
        remoteState: result.state,
        remoteVersion: result.version,
      },
    }
  })
  // Nothing was written before the guard passed: a failed read is retried, not a review.
  return !dispatched && outcome.state === 'uncertain'
    ? { state: 'retry_wait', errorCode: 'unavailable' }
    : outcome
}

/**
 * Record what the issue is now on its link, in the operation's completion
 * transaction: the next update compares against our own write, not before it.
 */
export async function persistIssueUpdate(
  tx: SyncTransaction,
  claim: SyncClaim,
  result: Record<string, unknown>
): Promise<void> {
  const op = claim.operation
  if (typeof result.remoteState !== 'string' || typeof result.remoteVersion !== 'string') return
  const at = new Date(result.remoteVersion)
  if (!op.payload || Number.isNaN(at.getTime())) return
  const data = readSyncPayload(op).data as { linkId?: string }
  if (typeof data.linkId !== 'string') return
  await tx
    .update(ticketExternalLinks)
    .set({ remoteState: result.remoteState.slice(0, 64), remoteStateAt: at })
    .where(
      and(
        eq(ticketExternalLinks.id, data.linkId as never),
        eq(ticketExternalLinks.status, 'active'),
        sql`(${ticketExternalLinks.remoteStateAt} IS NULL OR ${ticketExternalLinks.remoteStateAt} <= ${at.toISOString()}::timestamptz)`
      )
    )
}

/**
 * A teammate settled an update's review (kept the platform's version, or
 * cancelled it): they have seen the issue as it stands, so automatic updates
 * resume from now rather than refusing every later change for the same
 * activity. The state is forgotten, to be compared afresh from the next read.
 */
export async function acknowledgeIssueReview(
  tx: SyncTransaction,
  op: SyncOperation
): Promise<void> {
  if (op.state !== 'conflict' || !isIssueUpdateKind(op.kind) || !op.payload) return
  const data = readSyncPayload(op).data as { linkId?: string }
  if (typeof data.linkId !== 'string') return
  await tx
    .update(ticketExternalLinks)
    .set({ remoteState: null, remoteStateAt: new Date() })
    .where(
      and(
        eq(ticketExternalLinks.id, data.linkId as never),
        eq(ticketExternalLinks.integrationId, op.integrationId as IntegrationId)
      )
    )
}
