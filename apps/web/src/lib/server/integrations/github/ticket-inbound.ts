/**
 * GitHub → Ticket inbound sync.
 *
 * Processes GitHub issue webhook events and creates / updates tickets accordingly.
 * Called from the inbound webhook orchestrator after signature verification.
 *
 * Loop prevention: every ticket service call passes `syncSourceIntegrationId`
 * which the dispatch layer spreads onto the event. The outbound targets filter
 * in targets.ts skips integrations whose ID matches that field.
 */

import type { GitHubIntegrationConfig } from './types'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import {
  parseQuackbackSystemMarker,
  buildInboundTicketThreadBody,
  findThreadLinkByExternalComment,
  loadThreadForSync,
  parseQuackbackThreadMarker,
  stripQuackbackThreadMarker,
  upsertThreadExternalLink,
  markThreadLinkDeleted,
  type GitHubIssueComment,
} from './ticket-comments'
import { parseQuackbackTicketIssueMarker } from './ticket-message'
import type { TicketId, TicketStatusId, PrincipalId, InboxId, IntegrationId } from '@quackback/ids'
import type { TicketStatusCategory } from '@/lib/server/db'

// ============================================================================
// Inbound sync logging helpers (mirrors outbound pattern in hook.ts)
// ============================================================================

async function logInboundSync(entry: {
  integrationId: string
  ticketId?: string
  externalId?: string
  eventType: string
  status: 'success' | 'failed' | 'skipped'
  errorMessage?: string
  durationMs?: number
}): Promise<void> {
  try {
    const { db, integrationSyncLog } = await import('@/lib/server/db')
    await db.insert(integrationSyncLog).values({
      integrationId: entry.integrationId as IntegrationId,
      ticketId: entry.ticketId ? (entry.ticketId as TicketId) : null,
      externalId: entry.externalId ?? null,
      eventType: entry.eventType.includes('.') ? entry.eventType : `issue.${entry.eventType}`,
      direction: 'inbound',
      status: entry.status,
      errorMessage: entry.errorMessage ?? null,
      durationMs: entry.durationMs ?? null,
    })
  } catch (err) {
    console.error('[GitHub Inbound] Failed to write sync log:', err)
  }
}

async function touchLinkSyncedAt(externalId: string, integrationId: string): Promise<void> {
  try {
    const { db, ticketExternalLinks, eq, and } = await import('@/lib/server/db')
    await db
      .update(ticketExternalLinks)
      .set({ lastSyncedAt: new Date() })
      .where(
        and(
          eq(ticketExternalLinks.integrationId, integrationId as IntegrationId),
          eq(ticketExternalLinks.externalId, externalId)
        )
      )
  } catch (err) {
    console.error('[GitHub Inbound] Failed to update lastSyncedAt:', err)
  }
}

async function updateIntegrationError(integrationId: string, error: string): Promise<void> {
  try {
    const { db, integrations, eq, sql } = await import('@/lib/server/db')
    await db
      .update(integrations)
      .set({
        lastError: error,
        lastErrorAt: new Date(),
        errorCount: sql`${integrations.errorCount} + 1`,
      })
      .where(eq(integrations.id, integrationId as IntegrationId))
  } catch (err) {
    console.error('[GitHub Inbound] Failed to update integration error:', err)
  }
}

async function clearIntegrationError(integrationId: string): Promise<void> {
  try {
    const { db, integrations, eq } = await import('@/lib/server/db')
    await db
      .update(integrations)
      .set({ lastError: null, lastErrorAt: null, errorCount: 0 })
      .where(eq(integrations.id, integrationId as IntegrationId))
  } catch (err) {
    console.error('[GitHub Inbound] Failed to clear integration error:', err)
  }
}

// ============================================================================
// GitHub webhook payload types (subset we care about)
// ============================================================================

export interface GitHubIssuePayload {
  action: string
  issue: {
    number: number
    title: string
    body: string | null
    html_url: string
    state: string
    state_reason?: string | null
    assignee?: { login: string } | null
    assignees?: Array<{ login: string }>
    labels?: Array<{ name: string }>
  }
  repository: {
    full_name: string
  }
  sender: {
    login: string
  }
}

export interface GitHubIssueCommentPayload {
  action: 'created' | 'edited' | 'deleted' | string
  issue: {
    number: number
    html_url: string
    body?: string | null
  }
  comment: GitHubIssueComment & {
    id: number | string
    body: string | null
    html_url: string
  }
  repository: {
    full_name: string
  }
  sender: {
    login: string
  }
}

// ============================================================================
// Public entry point
// ============================================================================

/**
 * Route a parsed GitHub issue webhook to the correct handler.
 * Returns true if the event was handled, false if ignored.
 */
export async function handleGitHubTicketEvent(
  payload: GitHubIssuePayload,
  integration: { id: string; principalId: string | null; config: GitHubIntegrationConfig }
): Promise<boolean> {
  const config = integration.config
  const syncDirection = config.syncDirection ?? 'outbound'

  // Gate: only process when inbound sync is enabled
  if (syncDirection !== 'inbound' && syncDirection !== 'bidirectional') {
    return false
  }

  const issueNumber = String(payload.issue.number)
  const start = Date.now()

  const logSuccess = async (action: string, ticketId?: string) => {
    const durationMs = Date.now() - start
    await logInboundSync({
      integrationId: integration.id,
      ticketId,
      externalId: issueNumber,
      eventType: action,
      status: 'success',
      durationMs,
    })
    await touchLinkSyncedAt(issueNumber, integration.id)
    await clearIntegrationError(integration.id)
  }

  const logFailure = async (action: string, error: unknown) => {
    const durationMs = Date.now() - start
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await logInboundSync({
      integrationId: integration.id,
      externalId: issueNumber,
      eventType: action,
      status: 'failed',
      errorMessage,
      durationMs,
    })
    await updateIntegrationError(integration.id, errorMessage)
  }

  try {
    switch (payload.action) {
      case 'opened':
        if (!config.createTicketsFromIssues) return false
        await handleIssueOpened(payload, integration)
        await logSuccess('opened')
        return true

      case 'closed':
        await handleIssueClosed(payload, integration)
        await logSuccess('closed')
        return true

      case 'reopened':
        await handleIssueReopened(payload, integration)
        await logSuccess('reopened')
        return true

      case 'edited':
        await handleIssueEdited(payload, integration)
        await logSuccess('edited')
        return true

      case 'assigned':
        if (config.assigneeSync) {
          await handleIssueAssigned(payload, integration)
          await logSuccess('assigned')
          return true
        }
        return false

      case 'unassigned':
        if (config.assigneeSync) {
          await handleIssueUnassigned(payload, integration)
          await logSuccess('unassigned')
          return true
        }
        return false

      default:
        return false
    }
  } catch (error) {
    await logFailure(payload.action, error)
    throw error
  }
}

/**
 * Route GitHub issue_comment webhook events to linked ticket thread mutations.
 * Returns true if the event was consumed, false if ignored.
 */
export async function handleGitHubIssueCommentEvent(
  payload: GitHubIssueCommentPayload,
  integration: { id: string; principalId: string | null; config: GitHubIntegrationConfig }
): Promise<boolean> {
  const config = integration.config
  const syncDirection = config.syncDirection ?? 'outbound'
  const inboundTicketSync = syncDirection === 'inbound' || syncDirection === 'bidirectional'
  if (!inboundTicketSync) {
    return false
  }

  if (!['created', 'edited', 'deleted'].includes(payload.action)) {
    return false
  }

  const issueNumber = String(payload.issue.number)
  const externalCommentId = String(payload.comment.id)
  const start = Date.now()
  const eventType = `issue_comment.${payload.action}`

  const logResult = async (
    status: 'success' | 'failed' | 'skipped',
    ticketId?: string,
    error?: unknown
  ) => {
    const errorMessage =
      status === 'failed' ? (error instanceof Error ? error.message : 'Unknown error') : undefined
    await logInboundSync({
      integrationId: integration.id,
      ticketId,
      externalId: externalCommentId,
      eventType,
      status,
      errorMessage,
      durationMs: Date.now() - start,
    })
    if (status === 'success') {
      await clearIntegrationError(integration.id)
    } else if (status === 'failed' && errorMessage) {
      await updateIntegrationError(integration.id, errorMessage)
    }
  }

  try {
    const systemMarker = parseQuackbackSystemMarker(payload.comment.body)
    if (systemMarker?.integrationId === integration.id) {
      await logResult('skipped')
      return true
    }

    const marker = parseQuackbackThreadMarker(payload.comment.body)
    if (marker) {
      if (marker.integrationId === integration.id) {
        const markedThread = await loadThreadForSync(marker.threadId)
        if (markedThread) {
          await upsertThreadExternalLink({
            ticketId: marker.ticketId,
            threadId: marker.threadId,
            integrationId: integration.id,
            externalIssueId: issueNumber,
            externalCommentId,
            externalUrl: payload.comment.html_url,
            syncDirection: 'outbound',
          })
        }
      }
      await logResult(
        'skipped',
        marker.integrationId === integration.id ? marker.ticketId : undefined
      )
      return true
    }

    const ticketId = await findLinkedTicket(issueNumber, integration.id)
    const linkedTicketId =
      ticketId ??
      (await recoverLinkedTicketFromIssueBody({
        issueNumber,
        issueUrl: payload.issue.html_url,
        issueBody: payload.issue.body ?? null,
        integrationId: integration.id,
      }))
    if (!linkedTicketId) {
      await logResult('skipped')
      return true
    }

    switch (payload.action) {
      case 'created':
        await handleIssueCommentCreated(payload, integration, linkedTicketId, issueNumber)
        await logResult('success', linkedTicketId)
        await touchLinkSyncedAt(issueNumber, integration.id)
        return true
      case 'edited':
        await handleIssueCommentEdited(payload, integration, linkedTicketId, issueNumber)
        await logResult('success', linkedTicketId)
        await touchLinkSyncedAt(issueNumber, integration.id)
        return true
      case 'deleted':
        await handleIssueCommentDeleted(payload, integration, linkedTicketId)
        await logResult('success', linkedTicketId)
        await touchLinkSyncedAt(issueNumber, integration.id)
        return true
      default:
        return false
    }
  } catch (error) {
    await logResult('failed', undefined, error)
    throw error
  }
}

// ============================================================================
// Individual handlers
// ============================================================================

type IntegrationRecord = {
  id: string
  principalId: string | null
  config: GitHubIntegrationConfig
}

function buildIssueDescriptionPatch(body: string | null): {
  descriptionJson: ReturnType<typeof markdownToTiptapJson> | null
  descriptionText: string | null
} {
  const description = extractIssueDescription(body)
  if (!description?.trim()) {
    return { descriptionJson: null, descriptionText: null }
  }
  return {
    descriptionJson: markdownToTiptapJson(description),
    descriptionText: description,
  }
}

function extractIssueDescription(body: string | null): string | null {
  if (body == null) return null
  const viewLinkIndex = body.search(/\n\[View in Quackback\]\([^)]+\)\s*$/)
  if (viewLinkIndex === -1) return body

  const beforeFooter = body.slice(0, viewLinkIndex)
  const separators = [...beforeFooter.matchAll(/^---\s*$/gm)]
  const boundary = separators[separators.length - 1]
  return boundary?.index == null ? body : body.slice(0, boundary.index).trim()
}

async function handleIssueCommentCreated(
  payload: GitHubIssueCommentPayload,
  integration: IntegrationRecord,
  ticketId: TicketId,
  issueNumber: string
): Promise<void> {
  const externalCommentId = String(payload.comment.id)
  const existingLink = await findThreadLinkByExternalComment({
    integrationId: integration.id,
    externalCommentId,
  })
  if (existingLink?.status === 'active') return

  const bodyText = buildInboundTicketThreadBody(payload.comment)
  if (!stripQuackbackThreadMarker(payload.comment.body)) return

  const { addThread } = await import('@/lib/server/domains/tickets/ticket.threads')
  const thread = await addThread({
    ticketId,
    principalId: (integration.principalId as PrincipalId | null) ?? null,
    audience: 'public',
    bodyText,
    syncSourceIntegrationId: integration.id,
  })

  await upsertThreadExternalLink({
    ticketId,
    threadId: thread.id,
    integrationId: integration.id,
    externalIssueId: issueNumber,
    externalCommentId,
    externalUrl: payload.comment.html_url,
    syncDirection: 'inbound',
  })
}

async function handleIssueCommentEdited(
  payload: GitHubIssueCommentPayload,
  integration: IntegrationRecord,
  ticketId: TicketId,
  issueNumber: string
): Promise<void> {
  const externalCommentId = String(payload.comment.id)
  const link = await findThreadLinkByExternalComment({
    integrationId: integration.id,
    externalCommentId,
  })

  if (!link || link.status !== 'active') {
    await handleIssueCommentCreated(payload, integration, ticketId, issueNumber)
    return
  }

  const bodyText = buildInboundTicketThreadBody(payload.comment)
  if (!stripQuackbackThreadMarker(payload.comment.body)) return

  const thread = await loadThreadForSync(link.threadId)
  if (!thread || thread.deletedAt) {
    await handleIssueCommentCreated(payload, integration, ticketId, issueNumber)
    return
  }

  const { editThread } = await import('@/lib/server/domains/tickets/ticket.threads')
  await editThread({
    threadId: link.threadId,
    actorPrincipalId:
      (thread.principalId as PrincipalId | null) ?? (integration.principalId as PrincipalId | null),
    bodyText,
    syncSourceIntegrationId: integration.id,
  })

  await upsertThreadExternalLink({
    ticketId,
    threadId: link.threadId,
    integrationId: integration.id,
    externalIssueId: issueNumber,
    externalCommentId,
    externalUrl: payload.comment.html_url,
    syncDirection: 'inbound',
  })
}

async function handleIssueCommentDeleted(
  payload: GitHubIssueCommentPayload,
  integration: IntegrationRecord,
  ticketId: TicketId
): Promise<void> {
  const externalCommentId = String(payload.comment.id)
  const link = await findThreadLinkByExternalComment({
    integrationId: integration.id,
    externalCommentId,
  })
  if (!link || link.status !== 'active') return

  const { softDeleteThread } = await import('@/lib/server/domains/tickets/ticket.threads')
  await softDeleteThread(
    link.threadId,
    (integration.principalId as PrincipalId | null) ?? null,
    integration.id
  )
  await markThreadLinkDeleted({ integrationId: integration.id, externalCommentId })
  void ticketId
}

async function handleIssueOpened(
  payload: GitHubIssuePayload,
  integration: IntegrationRecord
): Promise<void> {
  const issueNumber = String(payload.issue.number)
  const alreadyLinkedTicketId = await findLinkedTicket(issueNumber, integration.id)
  if (alreadyLinkedTicketId) {
    return
  }

  const recoveredTicketId = await recoverLinkedTicketFromIssueBody({
    issueNumber,
    issueUrl: payload.issue.html_url,
    issueBody: payload.issue.body ?? null,
    integrationId: integration.id,
  })
  if (recoveredTicketId) {
    return
  }

  const { createTicket } = await import('@/lib/server/domains/tickets/ticket.service')
  const { db, ticketExternalLinks } = await import('@/lib/server/db')

  const issue = payload.issue
  console.log(
    `[GitHub Inbound] Creating ticket from issue #${issue.number} in ${payload.repository.full_name}`
  )

  const ticket = await createTicket({
    subject: truncateSubject(issue.title),
    ...buildIssueDescriptionPatch(issue.body),
    channel: 'api',
    inboxId: integration.config.defaultInboxId
      ? (integration.config.defaultInboxId as InboxId)
      : null,
    createdByPrincipalId: (integration.principalId as PrincipalId) ?? null,
    syncSourceIntegrationId: integration.id,
  })

  // Link the ticket to the GitHub issue
  await db
    .insert(ticketExternalLinks)
    .values({
      ticketId: ticket.id as TicketId,
      integrationId: integration.id as IntegrationId,
      integrationType: 'github',
      externalId: String(issue.number),
      externalDisplayId: `#${issue.number}`,
      externalUrl: issue.html_url,
      syncDirection: 'inbound',
    })
    .onConflictDoNothing()

  console.log(`[GitHub Inbound] Created ticket ${ticket.id} from issue #${issue.number}`)
}

async function handleIssueClosed(
  payload: GitHubIssuePayload,
  integration: IntegrationRecord
): Promise<void> {
  const ticketId = await findLinkedTicket(String(payload.issue.number), integration.id)
  if (!ticketId) return

  // Resolve target status: completed → solved, not_planned → closed
  const category = payload.issue.state_reason === 'not_planned' ? 'closed' : 'solved'
  const statusId = await findStatusByCategory(category)
  if (!statusId) {
    console.warn(`[GitHub Inbound] No ticket status with category "${category}", skipping`)
    return
  }

  const { transitionStatus } = await import('@/lib/server/domains/tickets/ticket.service')
  const { getTicket } = await import('@/lib/server/domains/tickets/ticket.service')

  const ticket = await getTicket(ticketId)
  if (!ticket) return

  console.log(
    `[GitHub Inbound] Closing ticket ${ticketId} (issue #${payload.issue.number} → ${category})`
  )

  await transitionStatus(ticketId, {
    expectedUpdatedAt: ticket.updatedAt,
    actorPrincipalId: (integration.principalId as PrincipalId) ?? null,
    statusId,
    syncSourceIntegrationId: integration.id,
  })
}

async function handleIssueReopened(
  payload: GitHubIssuePayload,
  integration: IntegrationRecord
): Promise<void> {
  const ticketId = await findLinkedTicket(String(payload.issue.number), integration.id)
  if (!ticketId) return

  const statusId = await findStatusByCategory('open')
  if (!statusId) {
    console.warn('[GitHub Inbound] No ticket status with category "open", skipping')
    return
  }

  const { transitionStatus, getTicket } =
    await import('@/lib/server/domains/tickets/ticket.service')

  const ticket = await getTicket(ticketId)
  if (!ticket) return

  console.log(`[GitHub Inbound] Reopening ticket ${ticketId} (issue #${payload.issue.number})`)

  await transitionStatus(ticketId, {
    expectedUpdatedAt: ticket.updatedAt,
    actorPrincipalId: (integration.principalId as PrincipalId) ?? null,
    statusId,
    syncSourceIntegrationId: integration.id,
  })
}

async function handleIssueEdited(
  payload: GitHubIssuePayload,
  integration: IntegrationRecord
): Promise<void> {
  const ticketId = await findLinkedTicket(String(payload.issue.number), integration.id)
  if (!ticketId) return

  const { updateTicket, getTicket } = await import('@/lib/server/domains/tickets/ticket.service')

  const ticket = await getTicket(ticketId)
  if (!ticket) return

  console.log(`[GitHub Inbound] Updating ticket ${ticketId} from issue #${payload.issue.number}`)

  await updateTicket(ticketId, {
    expectedUpdatedAt: ticket.updatedAt,
    actorPrincipalId: (integration.principalId as PrincipalId) ?? null,
    subject: truncateSubject(payload.issue.title),
    ...buildIssueDescriptionPatch(payload.issue.body),
    syncSourceIntegrationId: integration.id,
  })
}

async function handleIssueAssigned(
  payload: GitHubIssuePayload,
  integration: IntegrationRecord
): Promise<void> {
  const ticketId = await findLinkedTicket(String(payload.issue.number), integration.id)
  if (!ticketId) return

  // Resolve GitHub username → Quackback principal
  const assigneeLogin = payload.issue.assignee?.login
  if (!assigneeLogin) return

  const principalId = await findPrincipalByGitHubUsername(assigneeLogin, integration.id)
  if (!principalId) {
    console.log(
      `[GitHub Inbound] No user mapping for GitHub user "${assigneeLogin}", skipping assign`
    )
    return
  }

  const { assignTicket, getTicket } = await import('@/lib/server/domains/tickets/ticket.service')

  const ticket = await getTicket(ticketId)
  if (!ticket) return

  console.log(
    `[GitHub Inbound] Assigning ticket ${ticketId} to ${principalId} (GitHub: ${assigneeLogin})`
  )

  await assignTicket(ticketId, {
    expectedUpdatedAt: ticket.updatedAt,
    actorPrincipalId: (integration.principalId as PrincipalId) ?? null,
    assigneePrincipalId: principalId,
    syncSourceIntegrationId: integration.id,
  })
}

async function handleIssueUnassigned(
  payload: GitHubIssuePayload,
  integration: IntegrationRecord
): Promise<void> {
  const ticketId = await findLinkedTicket(String(payload.issue.number), integration.id)
  if (!ticketId) return

  const { assignTicket, getTicket } = await import('@/lib/server/domains/tickets/ticket.service')

  const ticket = await getTicket(ticketId)
  if (!ticket) return

  // Only unassign if ticket currently has an assignee
  if (!ticket.assigneePrincipalId) return

  console.log(`[GitHub Inbound] Unassigning ticket ${ticketId}`)

  await assignTicket(ticketId, {
    expectedUpdatedAt: ticket.updatedAt,
    actorPrincipalId: (integration.principalId as PrincipalId) ?? null,
    assigneePrincipalId: null,
    syncSourceIntegrationId: integration.id,
  })
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Look up the ticket linked to a GitHub issue number for a specific integration.
 */
export async function findLinkedTicket(
  issueNumber: string,
  integrationId: string
): Promise<TicketId | null> {
  const { db, ticketExternalLinks, eq, and } = await import('@/lib/server/db')
  const link = await db.query.ticketExternalLinks.findFirst({
    where: and(
      eq(ticketExternalLinks.integrationId, integrationId as IntegrationId),
      eq(ticketExternalLinks.externalId, issueNumber),
      eq(ticketExternalLinks.status, 'active')
    ),
    columns: { ticketId: true },
  })
  if (!link) {
    console.log(
      `[GitHub Inbound] No linked ticket for issue #${issueNumber} (integration ${integrationId})`
    )
    return null
  }
  return link.ticketId as TicketId
}

async function recoverLinkedTicketFromIssueBody(args: {
  issueNumber: string
  issueUrl: string
  issueBody: string | null
  integrationId: string
}): Promise<TicketId | null> {
  const ticketId = extractTicketIdFromGitHubIssueBody(args.issueBody)
  if (!ticketId) return null

  const { db, ticketExternalLinks, tickets, eq, and, isNull } = await import('@/lib/server/db')
  const ticket = await db.query.tickets.findFirst({
    where: and(eq(tickets.id, ticketId as TicketId), isNull(tickets.deletedAt)),
    columns: { id: true },
  })
  if (!ticket) return null

  await db
    .insert(ticketExternalLinks)
    .values({
      ticketId: ticketId as TicketId,
      integrationId: args.integrationId as IntegrationId,
      integrationType: 'github',
      externalId: args.issueNumber,
      externalDisplayId: `#${args.issueNumber}`,
      externalUrl: args.issueUrl,
      syncDirection: 'outbound',
      lastSyncedAt: new Date(),
    })
    .onConflictDoNothing()

  return ticketId as TicketId
}

function extractTicketIdFromGitHubIssueBody(body: string | null): string | null {
  if (!body) return null
  const marker = parseQuackbackTicketIssueMarker(body)
  if (marker?.ticketId) return marker.ticketId

  return (
    body.match(/\/(?:admin\/)?tickets\/(ticket_[A-Za-z0-9]+)/)?.[1] ??
    body.match(/\bticketId=(ticket_[A-Za-z0-9]+)/)?.[1] ??
    null
  )
}

/**
 * Find the first ticket status matching a given category.
 */
async function findStatusByCategory(category: string): Promise<TicketStatusId | null> {
  const { db, ticketStatuses, eq, and, isNull } = await import('@/lib/server/db')
  const status = await db.query.ticketStatuses.findFirst({
    where: and(
      eq(ticketStatuses.category, category as TicketStatusCategory),
      isNull(ticketStatuses.deletedAt)
    ),
    columns: { id: true },
  })
  return (status?.id as TicketStatusId) ?? null
}

/**
 * Resolve a GitHub username to a Quackback PrincipalId via integration user mappings.
 */
async function findPrincipalByGitHubUsername(
  username: string,
  integrationId: string
): Promise<PrincipalId | null> {
  const { db, integrationUserMappings, eq, and } = await import('@/lib/server/db')
  const mapping = await db.query.integrationUserMappings.findFirst({
    where: and(
      eq(integrationUserMappings.integrationId, integrationId as IntegrationId),
      eq(integrationUserMappings.externalUsername, username)
    ),
    columns: { principalId: true },
  })
  return (mapping?.principalId as PrincipalId) ?? null
}

/**
 * Truncate issue title to fit ticket subject constraint (500 chars).
 */
function truncateSubject(title: string): string {
  const trimmed = title?.trim() || 'Untitled issue'
  return trimmed.length > 500 ? trimmed.slice(0, 497) + '...' : trimmed
}
