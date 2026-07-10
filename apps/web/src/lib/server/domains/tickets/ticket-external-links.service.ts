/**
 * Ticket <-> external issue links: manual linking of a ticket to an EXISTING
 * GitHub issue (by URL or owner/repo#number). The sibling of the post domain's
 * outbound-event-driven post_external_links, but team-driven: an agent pastes
 * an issue reference, we validate it against the active GitHub integration's
 * configured repository, and store the reverse-lookup row the inbound webhook
 * handler uses to map issue state changes onto ticket statuses.
 *
 * v1 links existing issues only — there is no reusable issue-create client
 * (the outbound hook's create call is event-bus plumbing), so "create a new
 * issue from a ticket" is deliberately out of scope.
 */
import { db, eq, and, asc, integrations, ticketExternalLinks } from '@/lib/server/db'
import type { TicketId, TicketExternalLinkId } from '@quackback/ids'
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

// --------------------------------------------------------------- reference parsing

export interface GitHubIssueRef {
  owner: string
  repo: string
  number: number
}

// A full issue URL (query/hash/trailing-slash tolerated) or the
// owner/repo#number shorthand. Owner/repo segments follow GitHub's charset.
const ISSUE_URL_RE =
  /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/
const ISSUE_SHORTHAND_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/

/** Parse a GitHub issue URL or owner/repo#number shorthand; null when neither. */
export function parseGitHubIssueRef(input: string): GitHubIssueRef | null {
  const trimmed = input.trim()
  const m = ISSUE_URL_RE.exec(trimmed) ?? ISSUE_SHORTHAND_RE.exec(trimmed)
  if (!m) return null
  const number = Number.parseInt(m[3], 10)
  if (!Number.isSafeInteger(number) || number <= 0) return null
  return { owner: m[1], repo: m[2], number }
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

// ------------------------------------------------------------------------ service

/** The active GitHub integration row, or null (drives the fn/panel gate too). */
export async function getActiveGitHubIntegration() {
  return (
    (await db.query.integrations.findFirst({
      where: and(eq(integrations.integrationType, 'github'), eq(integrations.status, 'active')),
    })) ?? null
  )
}

/**
 * Link a ticket to an existing GitHub issue (team-only, TICKET_ASSIGN — same
 * gate as tracker links). Accepts a full issue URL or owner/repo#number.
 * Validates the active GitHub integration and, when the integration pins a
 * repository, that the issue belongs to it: inbound webhooks reverse-look-up
 * by bare issue number, so a foreign repo's numbers would collide. No issue
 * metadata is fetched — there is no read client; we store what the reference
 * gives. Re-linking the same issue is an idempotent no-op. Records a
 * team-only 'external_linked' note on the ticket thread.
 */
export async function linkTicketToIssue(
  ticketId: TicketId,
  issueRef: string,
  actor: Actor
): Promise<TicketExternalLinkDTO> {
  assertCan(actor, PERMISSIONS.TICKET_ASSIGN, 'link this ticket')
  await loadTicketOr404(ticketId)

  const ref = parseGitHubIssueRef(issueRef)
  if (!ref) {
    throw new ValidationError(
      'INVALID_ISSUE_REF',
      'Enter a GitHub issue URL or an owner/repo#number reference'
    )
  }

  const integration = await getActiveGitHubIntegration()
  if (!integration) {
    throw new ValidationError('NOT_CONFIGURED', 'Connect the GitHub integration first')
  }

  // channelId holds the connected "owner/repo" (see GitHubTarget in
  // integrations/github/hook.ts). Only enforce when it has that shape.
  const config = (integration.config ?? {}) as Record<string, unknown>
  const configuredRepo =
    typeof config.channelId === 'string' && config.channelId.includes('/')
      ? config.channelId
      : null
  const issueRepo = `${ref.owner}/${ref.repo}`
  if (configuredRepo && configuredRepo.toLowerCase() !== issueRepo.toLowerCase()) {
    throw new ValidationError(
      'REPO_MISMATCH',
      `Issue must belong to the connected repository (${configuredRepo})`
    )
  }

  const externalId = String(ref.number)
  const findExisting = () =>
    db.query.ticketExternalLinks.findFirst({
      where: and(
        eq(ticketExternalLinks.ticketId, ticketId),
        eq(ticketExternalLinks.integrationType, 'github'),
        eq(ticketExternalLinks.externalId, externalId)
      ),
    })
  const existing = await findExisting()
  if (existing) return toDTO(existing) // idempotent re-link

  const externalDisplayId = `${issueRepo}#${ref.number}`
  const externalUrl = `https://github.com/${issueRepo}/issues/${ref.number}`

  const created = await db.transaction(async (tx) => {
    // onConflictDoNothing guards the pre-check race: a concurrent re-link of
    // the same issue yields no row (and writes no duplicate audit note)
    // instead of surfacing a unique-constraint error.
    const [row] = await tx
      .insert(ticketExternalLinks)
      .values({
        ticketId,
        integrationId: integration.id,
        integrationType: 'github',
        externalId,
        externalDisplayId,
        externalUrl,
      })
      .onConflictDoNothing()
      .returning()
    if (!row) return null
    // Team-only audit note on the ticket thread (never customer-visible).
    await emitTicketSystemMessage(
      ticketId,
      'external_linked',
      `Linked GitHub issue ${externalDisplayId}`,
      { externalReference: externalDisplayId, externalUrl },
      tx
    )
    return row
  })
  if (!created) {
    const winner = await findExisting()
    if (winner) return toDTO(winner) // lost the race to an identical link
    throw new ValidationError('LINK_FAILED', 'Could not link the issue. Please try again.')
  }

  log.info(
    { ticket_id: ticketId, external_id: externalId, integration_id: integration.id },
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
      .where(
        and(eq(ticketExternalLinks.id, linkId), eq(ticketExternalLinks.ticketId, ticketId))
      )
      .returning()
    if (!removed) return
    const reference = removed.externalDisplayId ?? removed.externalId
    await emitTicketSystemMessage(
      ticketId,
      'external_unlinked',
      `Unlinked GitHub issue ${reference}`,
      { externalReference: reference, externalUrl: removed.externalUrl ?? undefined },
      tx
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
