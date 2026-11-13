/**
 * GitHub issues as tickets. A repository in `tickets` mode (see
 * `GITHUB_INBOUND_MODES`) brings each new issue in as an inbox conversation,
 * exactly as `conversations` mode does, and then opens a customer ticket
 * paired with that conversation. The pair shares one thread, so comments,
 * comment edits and deletes in both directions already ride the channel code
 * that serves the conversation. This file adds the ticket's side of the
 * issue's life:
 *
 * - opening: the issue title (cut to the ticket title bound), the issue
 *   author as requester, the repository's ticket type and team;
 * - issue closed / reopened: the ticket's status, through the repository's
 *   mapping, then the connection's, then a default;
 * - issue edited: the ticket's title;
 * - ticket closed / reopened in Quackback: the issue follows.
 *
 * Every write runs as the integration's service principal, and the status
 * moves are marked as integration sync, so the reaction at the bottom never
 * sends a change back to the GitHub it came from.
 */
import {
  db,
  eq,
  and,
  asc,
  isNull,
  conversations,
  teams,
  tickets,
  ticketStatuses,
  ticketTypes,
  type Ticket,
  type IntegrationDestinationConfig,
} from '@/lib/server/db'
import type {
  ConversationId,
  PrincipalId,
  TeamId,
  TicketId,
  TicketStatusId,
  TicketTypeId,
} from '@quackback/ids'
import type { EventData } from '@/lib/server/events/types'
import type { Actor } from '@/lib/server/policy/types'
import { boundedServiceActor } from '@/lib/server/policy/service-actor'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { ConflictError, ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import type { StatusMappings } from '@/lib/server/integrations/status-mapping'
import {
  githubInboundMode,
  type GitHubTicketScope,
} from '@/lib/server/domains/channel-accounts/github-connection'
import { parseGitHubThreadKey } from '@/lib/server/domains/channels/github-thread'
import {
  resolvePairConversationId,
  resolvePairTicketIdForConversation,
} from '@/lib/server/domains/tickets/pair-thread.service'
import { lookupChannelThreadByConversation } from './conversation.inbound-resolve'

const log = logger.child({ component: 'github-issue-tickets' })

/** The issue states GitHub reports, as the status mapping UI names them. */
export const GITHUB_ISSUE_OPEN = 'Open'
export const GITHUB_ISSUE_CLOSED = 'Closed'
export const GITHUB_ISSUE_NOT_PLANNED = 'Closed (not planned)'
export type GitHubIssueState =
  typeof GITHUB_ISSUE_OPEN | typeof GITHUB_ISSUE_CLOSED | typeof GITHUB_ISSUE_NOT_PLANNED

/** What the integration may do to the tickets it opens: create, assign, rename and move them. */
const GITHUB_TICKET_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  PERMISSIONS.TICKET_CREATE,
  PERMISSIONS.TICKET_ASSIGN,
  PERMISSIONS.TICKET_SET_STATUS,
])

function githubTicketActor(principalId: PrincipalId | null): Actor {
  return boundedServiceActor(GITHUB_TICKET_PERMISSIONS, principalId)
}

/**
 * The issue title as a ticket title: trimmed, and cut to `max`, the ticket
 * title bound (`TICKET_TITLE_MAX_LENGTH`, 300 characters, which
 * `createTicketCore` and `setTicketTitle` enforce; GitHub allows 1024).
 */
export function ticketTitleFromIssue(title: string | null | undefined, max: number): string {
  const trimmed = (title ?? '').trim() || 'Untitled issue'
  return trimmed.length > max ? `${trimmed.slice(0, max - 3)}...` : trimmed
}

/** The issue state a GitHub `issues` delivery reports, from its action and `state_reason`. */
export function githubIssueState(
  action: 'closed' | 'reopened',
  stateReason: string | null | undefined
): GitHubIssueState {
  if (action === 'reopened') return GITHUB_ISSUE_OPEN
  return stateReason === 'not_planned' ? GITHUB_ISSUE_NOT_PLANNED : GITHUB_ISSUE_CLOSED
}

/** A ticket type a repository may stamp on its tickets: live and customer-facing. */
async function customerTicketType(id: string): Promise<TicketTypeId | null> {
  const [row] = await db
    .select({ id: ticketTypes.id })
    .from(ticketTypes)
    .where(
      and(
        eq(ticketTypes.id, id as TicketTypeId),
        eq(ticketTypes.category, 'customer'),
        isNull(ticketTypes.deletedAt)
      )
    )
    .limit(1)
  return row?.id ?? null
}

async function liveTeam(id: string): Promise<TeamId | null> {
  const [row] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, id as TeamId), isNull(teams.deletedAt)))
    .limit(1)
  return row?.id ?? null
}

/**
 * Refuse repository settings that name what does not exist: a team that is
 * gone, a ticket type that is gone or not a customer type, a status mapping
 * onto a deleted status. The repository's `validateConfig`.
 */
export async function validateGitHubRepositorySettings(
  patch: Partial<IntegrationDestinationConfig>
): Promise<void> {
  const scope = patch.ticketScope
  if (scope?.teamId && !(await liveTeam(scope.teamId)))
    throw new ValidationError('INVALID_TICKET_SCOPE', 'Choose a team that exists')
  if (scope?.ticketTypeId && !(await customerTicketType(scope.ticketTypeId)))
    throw new ValidationError('INVALID_TICKET_SCOPE', 'Choose a customer ticket type')
  const mapped = Object.values(patch.ticketStatusMappings ?? {}).filter(
    (id): id is string => typeof id === 'string'
  )
  if (mapped.length > 0) {
    const live = new Set((await liveTicketStatuses()).map((s) => s.id as string))
    if (mapped.some((id) => !live.has(id)))
      throw new ValidationError('INVALID_STATUS_MAPPING', 'Map onto a ticket status that exists')
  }
}

/**
 * Open the customer ticket for an issue's conversation and pair the two, the
 * way the create-ticket-from-a-conversation flow does (`createTicketCore`,
 * then `linkTicketToConversation`). The issue author, already the
 * conversation's visitor, is the requester; the ticket inherits the
 * conversation's assignee and takes the repository's team. A conversation
 * already paired is left alone, so a redelivered issue opens nothing twice.
 * Returns the new ticket, or null when there was one already.
 */
export async function openTicketForGitHubIssue(input: {
  conversationId: ConversationId
  issueTitle: string | null | undefined
  scope: GitHubTicketScope
  integrationPrincipalId: PrincipalId | null
}): Promise<TicketId | null> {
  if (await resolvePairTicketIdForConversation(input.conversationId)) return null
  const [conversation] = await db
    .select({
      visitorPrincipalId: conversations.visitorPrincipalId,
      assignedAgentPrincipalId: conversations.assignedAgentPrincipalId,
    })
    .from(conversations)
    .where(eq(conversations.id, input.conversationId))
    .limit(1)
  if (!conversation) return null

  const { createTicketCore } = await import('@/lib/server/domains/tickets/ticket-intake.service')
  const { assignTicket, softDeleteTicket, TICKET_TITLE_MAX_LENGTH } =
    await import('@/lib/server/domains/tickets/ticket.service')
  const { resolveCategoryDefaultType } =
    await import('@/lib/server/domains/tickets/ticket-type.service')
  const { linkTicketToConversation } =
    await import('@/lib/server/domains/tickets/ticket-conversation-link.service')

  const actor = githubTicketActor(input.integrationPrincipalId)
  // A type or team removed since the repository was set up is skipped, not
  // fatal: the issue still becomes a ticket, with the workspace's defaults.
  const ticketTypeId =
    (input.scope.ticketTypeId ? await customerTicketType(input.scope.ticketTypeId) : null) ??
    (await resolveCategoryDefaultType('customer'))?.id ??
    null
  const ticket = await createTicketCore(
    {
      type: 'customer',
      ticketTypeId,
      title: ticketTitleFromIssue(input.issueTitle, TICKET_TITLE_MAX_LENGTH),
      requesterPrincipalId: conversation.visitorPrincipalId,
      assigneePrincipalId: conversation.assignedAgentPrincipalId ?? null,
      sourceConversationId: input.conversationId,
    },
    actor
  )
  try {
    await linkTicketToConversation(ticket.id, input.conversationId, actor)
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err
    // A concurrent delivery of the same issue paired the conversation first.
    await softDeleteTicket(ticket.id, actor)
    return null
  }
  const teamId = input.scope.teamId ? await liveTeam(input.scope.teamId) : null
  if (teamId) await assignTicket(ticket.id, { assigneeTeamId: teamId }, actor)
  return ticket.id
}

async function liveTicketStatuses() {
  return db
    .select({
      id: ticketStatuses.id,
      category: ticketStatuses.category,
      publicStage: ticketStatuses.publicStage,
      isDefault: ticketStatuses.isDefault,
    })
    .from(ticketStatuses)
    .where(isNull(ticketStatuses.deletedAt))
    .orderBy(asc(ticketStatuses.position), asc(ticketStatuses.createdAt))
}

/**
 * The ticket status an issue state moves its paired ticket to. The
 * repository's mapping wins, then the connection's (`ticketStatusMappings`,
 * the ticket status mapping on the integration page); a not-planned close
 * falls back to a mapping made for plain `Closed`. A state mapped to null is
 * ignored (null). Without a mapping, the closest stock status:
 *
 * - `Open` → the default status when it is open, else the first open one;
 * - `Closed` (completed) → the first closed status customers see as
 *   resolved (stock: "Resolved"), the fork's "solved";
 * - `Closed (not planned)` → the first closed status hidden from customers
 *   (stock: "Won't do"), the fork's "closed".
 *
 * Either close takes the first closed status when the preferred kind does
 * not exist. A mapping onto a deleted status is skipped.
 */
export async function ticketStatusForIssueState(
  state: GitHubIssueState,
  mappings: Array<StatusMappings | undefined>
): Promise<TicketStatusId | null> {
  const statuses = await liveTicketStatuses()
  const live = new Set(statuses.map((s) => s.id as string))
  const names = state === GITHUB_ISSUE_NOT_PLANNED ? [state, GITHUB_ISSUE_CLOSED] : [state]
  for (const name of names)
    for (const layer of mappings) {
      const mapped = layer?.[name]
      if (mapped === null) return null
      if (mapped && live.has(mapped)) return mapped as TicketStatusId
    }
  const closed = statuses.filter((s) => s.category === 'closed')
  const chosen =
    state === GITHUB_ISSUE_OPEN
      ? (statuses.find((s) => s.isDefault && s.category === 'open') ??
        statuses.find((s) => s.category === 'open'))
      : ((state === GITHUB_ISSUE_NOT_PLANNED
          ? closed.find((s) => s.publicStage === null)
          : closed.find((s) => s.publicStage === 'resolved')) ?? closed[0])
  return (chosen?.id as TicketStatusId | undefined) ?? null
}

/**
 * Move the ticket paired with an issue's conversation to the status the
 * issue's new state maps to, through the same synced-status path tracker
 * links use (`applySyncedTicketStatus`): the ticket's thread notes the issue
 * change, and the move is the integration's, marked as integration sync.
 * Nothing happens for a conversation without a paired ticket, or a
 * connection without a service principal to act as.
 */
export async function applyGitHubIssueStateToTicket(input: {
  conversationId: ConversationId
  state: GitHubIssueState
  integration: { principalId?: PrincipalId | null; config: unknown }
  repositoryConfig: { ticketStatusMappings?: unknown }
  issue: { reference: string; url: string | null }
  deliveryKey: string
}): Promise<void> {
  const principalId = input.integration.principalId ?? null
  const ticketId = await resolvePairTicketIdForConversation(input.conversationId)
  if (!ticketId || !principalId) return
  const connection = (input.integration.config ?? {}) as Record<string, unknown>
  const statusId = await ticketStatusForIssueState(input.state, [
    input.repositoryConfig.ticketStatusMappings as StatusMappings | undefined,
    connection.ticketStatusMappings as StatusMappings | undefined,
  ])
  const { applySyncedTicketStatus } =
    await import('@/lib/server/domains/tickets/ticket-status-sync')
  const { publishTicketUpdated } =
    await import('@/lib/server/domains/tickets/ticket-intake.service')
  const updated: Ticket[] = []
  await db.transaction((tx) =>
    applySyncedTicketStatus(
      tx,
      ticketId,
      statusId,
      principalId,
      {
        integrationType: 'github',
        externalDisplayId: input.issue.reference,
        externalUrl: input.issue.url,
        externalStatus: input.state,
        transition: input.state === GITHUB_ISSUE_OPEN ? 'reopened' : 'closed',
        deliveryKey: input.deliveryKey,
      },
      updated
    )
  )
  // Realtime is the best-effort tail once the move has committed.
  for (const ticket of updated)
    await publishTicketUpdated(ticket).catch((err) =>
      log.warn({ err, ticket_id: ticket.id }, 'could not publish the synced ticket')
    )
}

/** Rename the ticket paired with an issue's conversation after the issue's title. */
export async function renameTicketForGitHubIssue(input: {
  conversationId: ConversationId
  issueTitle: string | null | undefined
  integrationPrincipalId: PrincipalId | null
}): Promise<void> {
  const ticketId = await resolvePairTicketIdForConversation(input.conversationId)
  if (!ticketId) return
  const { setTicketTitle, TICKET_TITLE_MAX_LENGTH } =
    await import('@/lib/server/domains/tickets/ticket.service')
  await setTicketTitle(
    ticketId,
    ticketTitleFromIssue(input.issueTitle, TICKET_TITLE_MAX_LENGTH),
    githubTicketActor(input.integrationPrincipalId)
  )
}

/**
 * Event reaction on `ticket.status_changed`: a ticket opened from an issue of
 * a `tickets`-mode repository that is closed or reopened in Quackback closes
 * or reopens the issue, through the channel's own lifecycle delivery (the
 * PATCH a conversation close sends). Skipped when the move came from GitHub
 * (integration sync, or the integration's own principal), and when the
 * requester moved it: their comment reopening the ticket leaves the issue's
 * state to the repository's maintainers. A reaction that runs late acts
 * only while the ticket still stands where the event left it (closed, or
 * not), so a quick close and reopen never leaves the issue behind. Best
 * effort, like the other pair reactions: a failure is logged, and a 401 is recorded on the connection by
 * the delivery itself.
 */
export async function syncGitHubIssueFromTicketEvent(event: EventData): Promise<void> {
  try {
    if (event.type !== 'ticket.status_changed') return
    const { previousStatus, newStatus, requesterPrincipalId } = event.data
    const closing = newStatus === 'closed' && previousStatus !== 'closed'
    const reopening = previousStatus === 'closed' && newStatus !== 'closed'
    if (!closing && !reopening) return
    const actorId = event.actor.principalId ?? null
    if (event.actor.type === 'service' && event.actor.displayName === 'integration-sync') return
    if (actorId && actorId === requesterPrincipalId) return

    const ticketId = event.data.ticket.id as TicketId
    const [current] = await db
      .select({ category: ticketStatuses.category })
      .from(tickets)
      .innerJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
      .where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)))
      .limit(1)
    if (!current || (current.category === 'closed') !== closing) return

    const conversationId = await resolvePairConversationId(ticketId)
    if (!conversationId) return
    const thread = await lookupChannelThreadByConversation(conversationId)
    const parsed = thread ? parseGitHubThreadKey(thread.externalThreadKey) : null
    if (!parsed) return

    const { getActiveGitHubIntegration } =
      await import('@/lib/server/domains/channel-accounts/github-connection')
    const integration = await getActiveGitHubIntegration()
    if (!integration || (actorId && actorId === integration.principalId)) return
    const { findDestination } = await import('@/lib/server/integrations/destinations')
    const repository = await findDestination(integration.id, 'repo', {
      externalId: parsed.ownerRepo,
    })
    if (!repository || githubInboundMode(repository.config) !== 'tickets') return

    const { deliverGitHubLifecycleComment } =
      await import('@/lib/server/domains/channels/github-deliver')
    await deliverGitHubLifecycleComment(closing ? 'closed' : 'reopened', {
      conversationId,
      closerPrincipalId: (actorId as PrincipalId | null) ?? null,
    })
  } catch (err) {
    log.warn({ err, event_type: event.type }, 'could not move the GitHub issue with its ticket')
  }
}
