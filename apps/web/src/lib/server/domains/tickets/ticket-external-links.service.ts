import {
  installationIdentity,
  syncDestination,
  syncHash,
} from '@/lib/server/integrations/sync/identity'
import { syncSourceForActor } from '@/lib/server/integrations/sync/eligibility'
/**
 * Ticket <-> external issue links: manual linking of a ticket to an EXISTING
 * tracker issue (GitHub, Jira, Azure DevOps — any provider whose registry
 * definition implements `issues.parseRef`). The sibling of the post domain's
 * outbound-event-driven post_external_links, but team-driven: an agent pastes
 * an issue reference, the provider capability parses/validates it, and we
 * store the reverse-lookup row the inbound webhook handler uses to map issue
 * state changes onto ticket statuses.
 *
 * Linking is capability-gated, never provider-id-gated: a tracker without
 * `issues.parseRef` (e.g. Linear, whose inbound externalId is an internal
 * UUID a pasted URL cannot supply) simply offers no manual linking.
 */
import {
  db,
  eq,
  and,
  or,
  asc,
  ne,
  isNull,
  integrations,
  conversationMessages,
  ticketExternalLinks,
} from '@/lib/server/db'
import type { TicketId, TicketExternalLinkId, IntegrationId } from '@quackback/ids'
import { getIntegration } from '@/lib/server/integrations'
import type { ParsedIssueRef } from '@/lib/server/integrations/types'
import { getBaseUrl } from '@/lib/server/config'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { truncate } from '@/lib/shared/utils/string'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'
import { ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import { loadTicketOr404 } from './ticket.service'
import { emitTicketSystemMessage } from './ticket-message.service'
import { resolvePairConversationId } from './pair-thread.service'

const log = logger.child({ component: 'ticket-external-links' })

function assertCan(actor: Actor, permission: PermissionKey, action: string): void {
  if (!can(actor, permission)) throw new ForbiddenError('FORBIDDEN', `You cannot ${action}`)
}

/** Provider display name for note copy, falling back to the raw type. */
function providerName(integrationType: string): string {
  return getIntegration(integrationType)?.catalog.name ?? integrationType
}

// ------------------------------------------------------------------------- DTOs

export interface TicketExternalLinkDTO {
  id: TicketExternalLinkId
  integrationType: string
  externalId: string
  externalDisplayId: string | null
  externalUrl: string | null
  createdAt: Date
}

type LinkRow = typeof ticketExternalLinks.$inferSelect

function toDTO(row: LinkRow): TicketExternalLinkDTO {
  return {
    id: row.id,
    integrationType: row.integrationType,
    externalId: row.externalId,
    externalDisplayId: row.externalDisplayId,
    externalUrl: row.externalUrl,
    createdAt: row.createdAt,
  }
}

/** A connected tracker the panel can offer manual linking / creation for. */
export interface LinkableTrackerDTO {
  integrationType: string
  name: string
  /** issues.parseRef present — "Link existing issue" is offered. */
  canLink: boolean
  /** issues.create present — "Create new issue" is offered. */
  canCreate: boolean
}

// ------------------------------------------------------------------------ service

/** The active integration row for a tracker type, or null. */
export async function getActiveTrackerIntegration(integrationType: string) {
  return (
    (await db.query.integrations.findFirst({
      where: and(
        eq(integrations.integrationType, integrationType),
        eq(integrations.status, 'active')
      ),
    })) ?? null
  )
}

/**
 * Connected trackers that support manual issue linking or creation — active
 * integration row AND a registry `issues` capability member. Drives the
 * ticket panel's per-tracker sections and their affordances.
 */
export async function listLinkableTrackers(): Promise<LinkableTrackerDTO[]> {
  const rows = await db.query.integrations.findMany({
    where: eq(integrations.status, 'active'),
  })
  return rows
    .map((row) => {
      const issues = getIntegration(row.integrationType)?.issues
      return {
        integrationType: row.integrationType,
        name: providerName(row.integrationType),
        canLink: Boolean(issues?.parseRef),
        canCreate: Boolean(issues?.create),
      }
    })
    .filter((t) => t.canLink || t.canCreate)
}

/** The link row for a (ticket, provider, externalId) triple, or undefined. */
function findLink(
  ticketId: TicketId,
  integrationType: string,
  externalId: string,
  syncScope: string
) {
  return db.query.ticketExternalLinks.findFirst({
    where: and(
      eq(ticketExternalLinks.ticketId, ticketId),
      eq(ticketExternalLinks.integrationType, integrationType),
      eq(ticketExternalLinks.externalId, externalId),
      eq(ticketExternalLinks.syncScope, syncScope)
    ),
  })
}

/** Insert the link row + team-only audit note in one transaction. Returns the
 *  row, or null when the (ticket, provider, externalId) link already exists
 *  (onConflictDoNothing guards the concurrent-duplicate race). */
async function insertLinkWithNote(
  ticketId: TicketId,
  integrationId: IntegrationId,
  integrationType: string,
  ref: ParsedIssueRef,
  noteVerb: 'Linked' | 'Created',
  expectedScope: string
): Promise<LinkRow | null> {
  return db.transaction(async (tx) => {
    const [integration] = await tx
      .select()
      .from(integrations)
      .where(eq(integrations.id, integrationId))
      .for('share')
    if (!integration || integration.status !== 'active') throw new Error('Integration unavailable')
    const { installationIdentity, syncDestination, syncHash, syncOperationKey } =
      await import('@/lib/server/integrations/sync/identity')
    const { queueSyncOperation } = await import('@/lib/server/integrations/sync/ledger')
    const config = (integration.config ?? {}) as Record<string, unknown>
    const installation = installationIdentity(integration)
    const destination = syncDestination(
      { channelId: config.channelId },
      config,
      getIntegration(integration.integrationType)
    )
    if (`${installation}:${syncHash(destination)}` !== expectedScope)
      throw new ValidationError(
        'CONNECTION_CHANGED',
        'The destination changed. Check the reference and try again.'
      )
    const [row] = await tx
      .insert(ticketExternalLinks)
      .values({
        ticketId,
        integrationId,
        integrationType,
        externalId: ref.externalId,
        syncScope: `${installation}:${syncHash(destination)}`,
        externalDisplayId: ref.externalDisplayId,
        externalUrl: ref.externalUrl,
      })
      .onConflictDoNothing()
      .returning()
    if (!row) return null
    await queueSyncOperation(
      {
        operationKey: syncOperationKey({
          installation,
          destination,
          kind: 'link',
          sourceType: 'ticket',
          sourceId: ticketId,
          remoteId: ref.externalId,
        }),
        installation,
        integrationId,
        provider: integrationType,
        direction: 'outbound',
        kind: 'link',
        sourceType: 'ticket',
        sourceId: ticketId,
        destination,
        remoteId: ref.externalId,
        state: 'succeeded',
        result: { ...ref },
        payload: { executor: 'ticket-create', data: {} },
      },
      tx
    )
    // Team-only audit note on the ticket thread (never customer-visible).
    await emitTicketSystemMessage(
      ticketId,
      'external_linked',
      `${noteVerb} ${providerName(integrationType)} issue ${ref.externalDisplayId}`,
      {
        metadata: {
          externalReference: ref.externalDisplayId,
          externalUrl: ref.externalUrl ?? undefined,
        },
        exec: tx,
      }
    )
    return row
  })
}

/**
 * Link a ticket to an existing tracker issue (team-only, TICKET_ASSIGN — same
 * gate as tracker links). The provider capability parses the pasted reference
 * (URL or provider shorthand) and enforces its own config validation (e.g.
 * GitHub's connected-repository pin). No issue metadata is fetched — there is
 * no read client; we store what the reference gives. Re-linking the same
 * issue is an idempotent no-op. Records a team-only 'external_linked' note on
 * the ticket thread.
 */
export async function linkTicketToIssue(
  ticketId: TicketId,
  issueRef: string,
  actor: Actor,
  integrationType = 'github'
): Promise<TicketExternalLinkDTO> {
  assertCan(actor, PERMISSIONS.TICKET_ASSIGN, 'link this ticket')
  await loadTicketOr404(ticketId)
  if (!(await syncSourceForActor({ sourceType: 'ticket', sourceId: ticketId }, actor)))
    throw new ForbiddenError('FORBIDDEN', 'Ticket unavailable')

  const parseRef = getIntegration(integrationType)?.issues?.parseRef
  if (!parseRef) {
    throw new ValidationError('NOT_SUPPORTED', 'This integration does not support issue linking')
  }

  const integration = await getActiveTrackerIntegration(integrationType)
  if (!integration) {
    throw new ValidationError(
      'NOT_CONFIGURED',
      `Connect the ${providerName(integrationType)} integration first`
    )
  }

  const config = (integration.config ?? {}) as Record<string, unknown>
  const ref = parseRef(issueRef, config)
  if (!ref) {
    throw new ValidationError(
      'INVALID_ISSUE_REF',
      `Enter a ${providerName(integrationType)} issue URL or reference`
    )
  }

  const syncScope = `${installationIdentity(integration)}:${syncHash(syncDestination({ channelId: config.channelId }, config, getIntegration(integration.integrationType)))}`
  const existing = await findLink(ticketId, integrationType, ref.externalId, syncScope)
  if (existing) return toDTO(existing) // idempotent re-link

  const created = await insertLinkWithNote(
    ticketId,
    integration.id,
    integrationType,
    ref,
    'Linked',
    syncScope
  )
  if (!created) {
    const winner = await findLink(ticketId, integrationType, ref.externalId, syncScope)
    if (winner) return toDTO(winner) // lost the race to an identical link
    throw new ValidationError('LINK_FAILED', 'Could not link the issue. Please try again.')
  }

  log.info(
    { ticket_id: ticketId, external_id: ref.externalId, integration_id: integration.id },
    'ticket linked to external issue'
  )
  return toDTO(created)
}

/** Queue one durable creation per ticket, connection and destination. */
export async function createIssueForTicket(
  ticketId: TicketId,
  integrationType: string,
  actor: Actor
): Promise<{ operationId: string; state: string }> {
  assertCan(actor, PERMISSIONS.TICKET_ASSIGN, 'create an issue for this ticket')
  if (
    !actor.principalId ||
    !(await syncSourceForActor({ sourceType: 'ticket', sourceId: ticketId }, actor))
  )
    throw new ForbiddenError('FORBIDDEN', 'Ticket unavailable')
  if (!getIntegration(integrationType)?.issues?.create)
    throw new ValidationError('NOT_SUPPORTED', 'This integration does not support issue creation')
  const integration = await getActiveTrackerIntegration(integrationType)
  if (!integration)
    throw new ValidationError(
      'NOT_CONFIGURED',
      `Connect the ${providerName(integrationType)} integration first`
    )
  const { queueSyncOperation } = await import('@/lib/server/integrations/sync/ledger')
  const { installationIdentity, syncDestination, syncOperationKey } =
    await import('@/lib/server/integrations/sync/identity')
  const config = (integration.config ?? {}) as Record<string, unknown>
  const installation = installationIdentity(integration)
  const destination = syncDestination(
    { channelId: config.channelId },
    config,
    getIntegration(integration.integrationType)
  )
  const operation = await queueSyncOperation({
    operationKey: syncOperationKey({
      installation,
      destination,
      sourceType: 'ticket',
      sourceId: ticketId,
      kind: 'create',
    }),
    integrationId: integration.id,
    installation,
    provider: integrationType,
    direction: 'outbound',
    kind: 'create',
    sourceType: 'ticket',
    sourceId: ticketId,
    requestedBy: actor.principalId,
    destination,
    payload: { executor: 'ticket-create', data: {} },
  })
  if (!operation)
    throw new ValidationError(
      'SYNC_NOT_STARTED',
      'This ticket predates integration sync. You can link an existing issue instead.'
    )
  return { operationId: operation.id, state: operation.state }
}

/** Read current customer-visible content at dispatch time, excluding removed messages and internal notes. */
export async function buildTicketIssueData(ticketId: TicketId) {
  const ticket = await loadTicketOr404(ticketId)
  const pairConversationId = await resolvePairConversationId(ticketId)
  const [firstMessage] = await db
    .select({
      content: conversationMessages.content,
      contentJson: conversationMessages.contentJson,
    })
    .from(conversationMessages)
    .where(
      and(
        pairConversationId
          ? or(
              eq(conversationMessages.ticketId, ticketId),
              eq(conversationMessages.conversationId, pairConversationId)
            )
          : eq(conversationMessages.ticketId, ticketId),
        ne(conversationMessages.senderType, 'system'),
        eq(conversationMessages.isInternal, false),
        isNull(conversationMessages.deletedAt)
      )
    )
    .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id))
    .limit(1)
  const narrative = firstMessage
    ? truncate(contentJsonToMarkdown(firstMessage.contentJson, firstMessage.content), 2000)
    : ''
  const bodyMarkdown = [
    narrative,
    `---`,
    `Created from Quackback ticket #${ticket.number}: ${getBaseUrl()}/admin/inbox?i=${ticketId}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  return { title: ticket.title, bodyMarkdown }
}

/**
 * Remove an external-issue link (team-only, TICKET_ASSIGN). No-op if the link
 * is absent. Records a team-only 'external_unlinked' note when it removes one.
 */
export async function unlinkTicketIssue(
  ticketId: TicketId,
  linkId: TicketExternalLinkId,
  actor: Actor
): Promise<void> {
  assertCan(actor, PERMISSIONS.TICKET_ASSIGN, 'unlink this ticket')
  if (!(await syncSourceForActor({ sourceType: 'ticket', sourceId: ticketId }, actor)))
    throw new ForbiddenError('FORBIDDEN', 'Ticket unavailable')

  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(ticketExternalLinks)
      .where(and(eq(ticketExternalLinks.id, linkId), eq(ticketExternalLinks.ticketId, ticketId)))
      .returning()
    if (!removed) return
    const reference = removed.externalDisplayId ?? removed.externalId
    await emitTicketSystemMessage(
      ticketId,
      'external_unlinked',
      `Unlinked ${providerName(removed.integrationType)} issue ${reference}`,
      {
        metadata: { externalReference: reference, externalUrl: removed.externalUrl ?? undefined },
        exec: tx,
      }
    )
    log.info({ ticket_id: ticketId, link_id: linkId }, 'ticket external link removed')
  })
}

/** A ticket's active external links, oldest first. */
export async function listTicketExternalLinks(
  ticketId: TicketId
): Promise<TicketExternalLinkDTO[]> {
  const rows = await db
    .select()
    .from(ticketExternalLinks)
    .where(
      and(eq(ticketExternalLinks.ticketId, ticketId), eq(ticketExternalLinks.status, 'active'))
    )
    .orderBy(asc(ticketExternalLinks.createdAt))
  return rows.map(toDTO)
}
