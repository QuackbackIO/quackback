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
import { db, eq, and, asc, integrations, ticketExternalLinks } from '@/lib/server/db'
import type { TicketId, TicketExternalLinkId } from '@quackback/ids'
import { getIntegration } from '@/lib/server/integrations'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'
import { ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import { loadTicketOr404 } from './ticket.service'
import { emitTicketSystemMessage } from './ticket-message.service'

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

/** A connected tracker the panel can offer manual linking for. */
export interface LinkableTrackerDTO {
  integrationType: string
  name: string
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
 * Connected trackers that support manual issue linking — active integration
 * row AND a registry `issues.parseRef` capability. Drives the ticket panel's
 * per-tracker sections and its link affordance.
 */
export async function listLinkableTrackers(): Promise<LinkableTrackerDTO[]> {
  const rows = await db.query.integrations.findMany({
    where: eq(integrations.status, 'active'),
  })
  return rows
    .filter((row) => getIntegration(row.integrationType)?.issues?.parseRef)
    .map((row) => ({
      integrationType: row.integrationType,
      name: providerName(row.integrationType),
    }))
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

  const findExisting = () =>
    db.query.ticketExternalLinks.findFirst({
      where: and(
        eq(ticketExternalLinks.ticketId, ticketId),
        eq(ticketExternalLinks.integrationType, integrationType),
        eq(ticketExternalLinks.externalId, ref.externalId)
      ),
    })
  const existing = await findExisting()
  if (existing) return toDTO(existing) // idempotent re-link

  const created = await db.transaction(async (tx) => {
    // onConflictDoNothing guards the pre-check race: a concurrent re-link of
    // the same issue yields no row (and writes no duplicate audit note)
    // instead of surfacing a unique-constraint error.
    const [row] = await tx
      .insert(ticketExternalLinks)
      .values({
        ticketId,
        integrationId: integration.id,
        integrationType,
        externalId: ref.externalId,
        externalDisplayId: ref.externalDisplayId,
        externalUrl: ref.externalUrl,
      })
      .onConflictDoNothing()
      .returning()
    if (!row) return null
    // Team-only audit note on the ticket thread (never customer-visible).
    await emitTicketSystemMessage(
      ticketId,
      'external_linked',
      `Linked ${providerName(integrationType)} issue ${ref.externalDisplayId}`,
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
  if (!created) {
    const winner = await findExisting()
    if (winner) return toDTO(winner) // lost the race to an identical link
    throw new ValidationError('LINK_FAILED', 'Could not link the issue. Please try again.')
  }

  log.info(
    { ticket_id: ticketId, external_id: ref.externalId, integration_id: integration.id },
    'ticket linked to external issue'
  )
  return toDTO(created)
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
