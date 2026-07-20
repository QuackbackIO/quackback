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
import { decryptSecrets } from '@/lib/server/integrations/encryption'
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
function findLink(ticketId: TicketId, integrationType: string, externalId: string) {
  return db.query.ticketExternalLinks.findFirst({
    where: and(
      eq(ticketExternalLinks.ticketId, ticketId),
      eq(ticketExternalLinks.integrationType, integrationType),
      eq(ticketExternalLinks.externalId, externalId)
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
  noteVerb: 'Linked' | 'Created'
): Promise<LinkRow | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(ticketExternalLinks)
      .values({
        ticketId,
        integrationId,
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

  const existing = await findLink(ticketId, integrationType, ref.externalId)
  if (existing) return toDTO(existing) // idempotent re-link

  const created = await insertLinkWithNote(ticketId, integration.id, integrationType, ref, 'Linked')
  if (!created) {
    const winner = await findLink(ticketId, integrationType, ref.externalId)
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
 * Create a NEW issue on the connected tracker from a ticket, and link it
 * (team-only, TICKET_ASSIGN — the same gate as link/unlink; creating an
 * external issue is the same association-management act). Capability-gated on
 * `issues.create`. Title = the ticket title; body = the first thread message
 * rendered to markdown (the provider capability down-converts) plus a
 * back-link footer. The external create is NOT idempotent — a retry after a
 * failed link lands a second issue — so the link insert happens immediately
 * after, in one transaction with the audit note.
 */
export async function createIssueForTicket(
  ticketId: TicketId,
  integrationType: string,
  actor: Actor
): Promise<TicketExternalLinkDTO> {
  assertCan(actor, PERMISSIONS.TICKET_ASSIGN, 'create an issue for this ticket')
  const ticket = await loadTicketOr404(ticketId)

  const issues = getIntegration(integrationType)?.issues
  const create = issues?.create
  if (!create) {
    throw new ValidationError('NOT_SUPPORTED', 'This integration does not support issue creation')
  }

  const integration = await getActiveTrackerIntegration(integrationType)
  if (!integration) {
    throw new ValidationError(
      'NOT_CONFIGURED',
      `Connect the ${providerName(integrationType)} integration first`
    )
  }

  // The merged bag the event-bus hooks receive: row config + decrypted
  // secrets — or the provider's own prepareAuth when credentials need more
  // than a merge (Jira's expiring OAuth token).
  const auth: Record<string, unknown> = issues.prepareAuth
    ? await issues.prepareAuth(integration)
    : {
        ...((integration.config ?? {}) as Record<string, unknown>),
        ...(integration.secrets ? decryptSecrets(integration.secrets) : {}),
      }

  // Body: the first CUSTOMER-VISIBLE thread message (the requester's report),
  // rendered to markdown via the ticket idiom — tickets have no description
  // column. Internal notes are structurally excluded: they must never reach
  // an external tracker.
  //
  // CONVERGENCE PHASE 3: the "first message" read unions BOTH parents of a
  // linked pair — post-1a/1b the opening message lands on the conversation
  // (intake writes it through the redirect), so a ticket-parent-only read
  // would find nothing and file an empty narrative. An unlinked thread
  // (back-office/tracker, standalone customer) degenerates to the ticket
  // parent alone.
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

  let ref: ParsedIssueRef
  try {
    ref = await create({ auth, title: ticket.title, bodyMarkdown })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    log.error(
      { err: error, ticket_id: ticketId, integration_type: integrationType },
      'issue create failed'
    )
    throw new ValidationError('CREATE_FAILED', message)
  }

  const created = await insertLinkWithNote(
    ticketId,
    integration.id,
    integrationType,
    ref,
    'Created'
  )
  if (!created) {
    // The issue exists on the tracker but an identical link already did too —
    // surface the existing link rather than failing the whole action.
    const existing = await findLink(ticketId, integrationType, ref.externalId)
    if (existing) return toDTO(existing)
    throw new ValidationError('LINK_FAILED', 'Issue created but could not be linked.')
  }

  log.info(
    { ticket_id: ticketId, external_id: ref.externalId, integration_id: integration.id },
    'issue created from ticket'
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
