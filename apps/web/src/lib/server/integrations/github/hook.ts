/**
 * GitHub hook handler.
 * Creates GitHub issues from feedback posts and syncs ticket events bidirectionally.
 */

import type { HookHandler, HookResult } from '../../events/hook-types'
import type { EventData, EventTicketRef } from '../../events/types'
import { isRetryableError } from '../../events/hook-utils'
import { buildGitHubIssueBody } from './message'
import {
  appendQuackbackTicketIssueMarker,
  buildTicketIssueBody,
  buildTicketUpdateBody,
} from './ticket-message'
import {
  buildQuackbackSystemMarker,
  buildOutboundGitHubCommentBody,
  createGitHubIssueComment,
  deleteGitHubIssueComment,
  findThreadLinkByThread,
  getThreadAuthorName,
  loadThreadForSync,
  markThreadLinkDeleted,
  updateGitHubIssueComment,
  upsertThreadExternalLink,
} from './ticket-comments'
import {
  DEFAULT_GITHUB_STATUS_MAPPINGS,
  type GitHubStatusMapping,
  type GitHubSyncDirection,
} from './types'
import type { TicketStatusCategory } from '@/lib/server/db'
import type { InboxId, IntegrationId, TicketId } from '@quackback/ids'

import { logger } from '@/lib/server/logger'
const log = logger.child({ component: 'github' })
const GITHUB_API = 'https://api.github.com'

// ============================================================================
// Sync logging helper
// ============================================================================

interface SyncLogEntry {
  integrationId: string
  ticketId?: string
  externalId?: string
  eventType: string
  direction: 'outbound' | 'inbound'
  status: 'success' | 'failed' | 'skipped'
  errorMessage?: string
  durationMs?: number
}

interface TicketAttachmentForSync {
  id: string
  threadId: string
  filename: string
  mimeType: string
  sizeBytes: number
  publicUrl: string | null
}

async function logSyncAttempt(entry: SyncLogEntry): Promise<void> {
  try {
    const { db, integrationSyncLog } = await import('@/lib/server/db')
    await db.insert(integrationSyncLog).values({
      integrationId: entry.integrationId as IntegrationId,
      ticketId: entry.ticketId ? (entry.ticketId as TicketId) : null,
      externalId: entry.externalId ?? null,
      eventType: entry.eventType,
      direction: entry.direction,
      status: entry.status,
      errorMessage: entry.errorMessage ?? null,
      durationMs: entry.durationMs ?? null,
    })
  } catch (err) {
    console.error('[GitHub] Failed to write sync log:', err)
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
      .where(eq(integrations.id, integrationId as import('@quackback/ids').IntegrationId))
  } catch (err) {
    console.error('[GitHub] Failed to update integration error:', err)
  }
}

async function clearIntegrationError(integrationId: string): Promise<void> {
  try {
    const { db, integrations, eq } = await import('@/lib/server/db')
    await db
      .update(integrations)
      .set({ lastError: null, lastErrorAt: null, errorCount: 0 })
      .where(eq(integrations.id, integrationId as import('@quackback/ids').IntegrationId))
  } catch (err) {
    console.error('[GitHub] Failed to clear integration error:', err)
  }
}

async function touchExternalLinkSyncedAt(ticketId: string, integrationId: string): Promise<void> {
  try {
    const { db, ticketExternalLinks, eq, and } = await import('@/lib/server/db')
    await db
      .update(ticketExternalLinks)
      .set({ lastSyncedAt: new Date() })
      .where(
        and(
          eq(ticketExternalLinks.ticketId, ticketId as import('@quackback/ids').TicketId),
          eq(
            ticketExternalLinks.integrationId,
            integrationId as import('@quackback/ids').IntegrationId
          )
        )
      )
  } catch (err) {
    console.error('[GitHub] Failed to update lastSyncedAt:', err)
  }
}

// ============================================================================
// Types
// ============================================================================

export interface GitHubTarget {
  channelId: string // "owner/repo" stored as channelId for consistency
}

export interface GitHubConfig {
  accessToken: string
  rootUrl: string
  integrationId?: string
  syncDirection?: GitHubSyncDirection
  statusMappings?: Partial<Record<TicketStatusCategory, GitHubStatusMapping>>
  assigneeSync?: boolean
  defaultInboxId?: string | null
}

/** Standard GitHub API headers */
function githubHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'quackback',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** Map HTTP error statuses to HookResult */
function handleGitHubError(
  status: number,
  errorBody: string,
  ownerRepo: string
): HookResult | null {
  if (status === 401) {
    return {
      success: false,
      error: 'Authentication failed. Please reconnect GitHub.',
      shouldRetry: false,
    }
  }
  if (status === 404) {
    return {
      success: false,
      error: `Repository "${ownerRepo}" not found or not accessible.`,
      shouldRetry: false,
    }
  }
  if (status === 422) {
    return { success: false, error: `Validation error: ${errorBody}`, shouldRetry: false }
  }
  if (status === 429) {
    return { success: false, error: 'Rate limited by GitHub API.', shouldRetry: true }
  }
  return null
}

/**
 * Look up the GitHub issue number for a ticket via ticket_external_links.
 * Returns null if no link exists (ticket wasn't synced to this integration).
 */
async function findTicketIssueNumber(
  ticketId: string,
  integrationId: string
): Promise<string | null> {
  const { db, ticketExternalLinks, eq, and } = await import('@/lib/server/db')
  const link = await db.query.ticketExternalLinks.findFirst({
    where: and(
      eq(ticketExternalLinks.ticketId, ticketId as import('@quackback/ids').TicketId),
      eq(
        ticketExternalLinks.integrationId,
        integrationId as import('@quackback/ids').IntegrationId
      ),
      eq(ticketExternalLinks.status, 'active')
    ),
    columns: { externalId: true },
  })
  return link?.externalId ?? null
}

/**
 * Look up the GitHub username for a principal via integration_user_mappings.
 */
async function findGitHubUsername(
  principalId: string,
  integrationId: string
): Promise<string | null> {
  const { db, integrationUserMappings, eq, and } = await import('@/lib/server/db')
  const mapping = await db.query.integrationUserMappings.findFirst({
    where: and(
      eq(
        integrationUserMappings.integrationId,
        integrationId as import('@quackback/ids').IntegrationId
      ),
      eq(integrationUserMappings.principalId, principalId as import('@quackback/ids').PrincipalId)
    ),
    columns: { externalUsername: true },
  })
  return mapping?.externalUsername ?? null
}

/**
 * Resolve the slug for the inbox selected on the GitHub repository connection.
 */
async function findConfiguredInboxSlug(
  config: GitHubConfig,
  ticket: EventTicketRef
): Promise<string | null> {
  const configuredInboxId =
    typeof config.defaultInboxId === 'string' ? config.defaultInboxId.trim() : ''
  if (!configuredInboxId) return null

  if (ticket.inboxId === configuredInboxId && ticket.inboxSlug) {
    return ticket.inboxSlug
  }

  const { db, inboxes, eq } = await import('@/lib/server/db')
  const inbox = await db.query.inboxes.findFirst({
    where: eq(inboxes.id, configuredInboxId as InboxId),
    columns: { slug: true },
  })

  return inbox?.slug ?? null
}

/**
 * Wraps a ticket sync handler with timing, audit logging, error tracking, and lastSyncedAt updates.
 */
async function withSyncLog(
  event: EventData,
  ownerRepo: string,
  config: GitHubConfig,
  handler: () => Promise<HookResult>
): Promise<HookResult> {
  const ticketId = (event.data as { ticket?: { id: string } }).ticket?.id
  const integrationId = config.integrationId
  if (!integrationId) return handler() // No integration ID → skip logging

  const start = Date.now()
  let result: HookResult
  try {
    result = await handler()
  } catch (error) {
    const durationMs = Date.now() - start
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await logSyncAttempt({
      integrationId,
      ticketId,
      eventType: event.type,
      direction: 'outbound',
      status: 'failed',
      errorMessage,
      durationMs,
    })
    await updateIntegrationError(integrationId, errorMessage)
    throw error
  }

  const durationMs = Date.now() - start

  if (result.success) {
    await logSyncAttempt({
      integrationId,
      ticketId,
      externalId: result.externalId,
      eventType: event.type,
      direction: 'outbound',
      status: result.skipped ? 'skipped' : 'success',
      durationMs,
    })
    if (!result.skipped) {
      if (ticketId) await touchExternalLinkSyncedAt(ticketId, integrationId)
      await clearIntegrationError(integrationId)
    }
  } else {
    await logSyncAttempt({
      integrationId,
      ticketId,
      eventType: event.type,
      direction: 'outbound',
      status: 'failed',
      errorMessage: result.error,
      durationMs,
    })
    if (result.error) await updateIntegrationError(integrationId, result.error)
  }

  return result
}

export const githubHook: HookHandler = {
  async run(event: EventData, target: unknown, config: unknown): Promise<HookResult> {
    const { channelId: ownerRepo } = target as GitHubTarget
    const ghConfig = config as GitHubConfig
    const { accessToken: _accessToken } = ghConfig
    const syncDirection = ghConfig.syncDirection ?? 'outbound'
    const outboundTicketSync = syncDirection === 'outbound' || syncDirection === 'bidirectional'

    if (event.type.startsWith('ticket.') && !outboundTicketSync) {
      return { success: true }
    }

    // Route to appropriate handler based on event type
    switch (event.type) {
      case 'post.created':
        return withSyncLog(event, ownerRepo, ghConfig, () =>
          handlePostCreated(event, ownerRepo, ghConfig)
        )
      case 'ticket.created':
        return withSyncLog(event, ownerRepo, ghConfig, () =>
          handleTicketCreated(event, ownerRepo, ghConfig)
        )
      case 'ticket.status_changed':
        return withSyncLog(event, ownerRepo, ghConfig, () =>
          handleTicketStatusChanged(event, ownerRepo, ghConfig)
        )
      case 'ticket.assigned':
        return withSyncLog(event, ownerRepo, ghConfig, () =>
          handleTicketAssigned(event, ownerRepo, ghConfig)
        )
      case 'ticket.updated':
        return withSyncLog(event, ownerRepo, ghConfig, () =>
          handleTicketUpdated(event, ownerRepo, ghConfig)
        )
      case 'ticket.thread_added':
        return withSyncLog(event, ownerRepo, ghConfig, () =>
          handleTicketThreadAdded(event, ownerRepo, ghConfig)
        )
      case 'ticket.thread_updated':
        return withSyncLog(event, ownerRepo, ghConfig, () =>
          handleTicketThreadUpdated(event, ownerRepo, ghConfig)
        )
      case 'ticket.thread_deleted':
        return withSyncLog(event, ownerRepo, ghConfig, () =>
          handleTicketThreadDeleted(event, ownerRepo, ghConfig)
        )
      case 'ticket.attachment_added':
        return withSyncLog(event, ownerRepo, ghConfig, () =>
          handleTicketAttachmentAdded(event, ownerRepo, ghConfig)
        )
      case 'ticket.attachment_removed':
        return withSyncLog(event, ownerRepo, ghConfig, () =>
          handleTicketAttachmentRemoved(event, ownerRepo, ghConfig)
        )
      default:
        return { success: true }
    }
  },
}

// ============================================================================
// Post Handlers (existing functionality)
// ============================================================================

async function handlePostCreated(
  event: EventData,
  ownerRepo: string,
  config: GitHubConfig
): Promise<HookResult> {
  if (event.type !== 'post.created') return { success: true }

  log.debug(`Creating issue for ${event.type} -> repo ${ownerRepo}`)
  const { title, body } = buildGitHubIssueBody(event, config.rootUrl)

  try {
    const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/issues`, {
      method: 'POST',
      headers: githubHeaders(config.accessToken),
      body: JSON.stringify({ title, body }),
    })

    if (!response.ok) {
      const errorResult = handleGitHubError(response.status, await response.text(), ownerRepo)
      if (errorResult) return errorResult
      throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
    }

    const issue = (await response.json()) as { number: number; html_url: string }
    log.debug(`Created issue #${issue.number} in ${ownerRepo}`)
    return { success: true, externalId: String(issue.number), externalUrl: issue.html_url }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      shouldRetry: isRetryableError(error),
    }
  }
}

// ============================================================================
// Ticket Handlers (new)
// ============================================================================

async function handleTicketCreated(
  event: EventData,
  ownerRepo: string,
  config: GitHubConfig
): Promise<HookResult> {
  if (event.type !== 'ticket.created') return { success: true }

  log.debug(`Creating issue for ticket -> repo ${ownerRepo}`)
  const ticketDescriptionMarkdown = await loadTicketDescriptionMarkdown(event.data.ticket.id)
  const attachments = await listTicketPublicAttachmentsForSync(event.data.ticket.id)
  const { title, body, labels } = buildTicketIssueBody(event, config.rootUrl)
  const bodyWithAssets = withTicketMediaBlocks(body, {
    descriptionMarkdown: ticketDescriptionMarkdown,
    attachments,
  })
  const markedBody = appendQuackbackTicketIssueMarker(bodyWithAssets, {
    ticketId: event.data.ticket.id,
    integrationId: config.integrationId,
  })
  const configuredInboxSlug = await findConfiguredInboxSlug(config, event.data.ticket)
  const issueLabels = configuredInboxSlug
    ? Array.from(new Set([...labels, configuredInboxSlug]))
    : labels

  try {
    const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/issues`, {
      method: 'POST',
      headers: githubHeaders(config.accessToken),
      body: JSON.stringify({ title, body: markedBody, labels: issueLabels }),
    })

    if (!response.ok) {
      const errorResult = handleGitHubError(response.status, await response.text(), ownerRepo)
      if (errorResult) return errorResult
      throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
    }

    const issue = (await response.json()) as { number: number; html_url: string }
    log.debug(`Created issue #${issue.number} for ticket in ${ownerRepo}`)
    return {
      success: true,
      externalId: String(issue.number),
      externalDisplayId: `#${issue.number}`,
      externalUrl: issue.html_url,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      shouldRetry: isRetryableError(error),
    }
  }
}

async function handleTicketStatusChanged(
  event: EventData,
  ownerRepo: string,
  config: GitHubConfig
): Promise<HookResult> {
  if (event.type !== 'ticket.status_changed') return { success: true }
  if (!config.integrationId) return { success: true }

  const { ticket, newStatusCategory } = event.data
  const issueNumber = await findTicketIssueNumber(ticket.id, config.integrationId)
  if (!issueNumber) return { success: true } // No synced issue to update

  // Resolve status mapping
  const mappings = { ...DEFAULT_GITHUB_STATUS_MAPPINGS, ...config.statusMappings }
  const mapping = mappings[newStatusCategory as TicketStatusCategory]
  if (!mapping) return { success: true }

  log.debug(`Updating issue #${issueNumber} state -> ${mapping.state} in ${ownerRepo}`)

  try {
    const patchBody: Record<string, unknown> = { state: mapping.state }
    if (mapping.state === 'closed') {
      patchBody.state_reason = 'completed'
    }

    const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: githubHeaders(config.accessToken),
      body: JSON.stringify(patchBody),
    })

    if (!response.ok) {
      const errorResult = handleGitHubError(response.status, await response.text(), ownerRepo)
      if (errorResult) return errorResult
      throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
    }

    // If the mapping includes a label, add it (best-effort)
    if (mapping.label) {
      await addLabel(ownerRepo, issueNumber, mapping.label, config.accessToken).catch((err) =>
        log.warn({ err: err }, `Failed to add label "${mapping.label}":`)
      )
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      shouldRetry: isRetryableError(error),
    }
  }
}

async function handleTicketAssigned(
  event: EventData,
  ownerRepo: string,
  config: GitHubConfig
): Promise<HookResult> {
  if (event.type !== 'ticket.assigned') return { success: true }
  if (!config.integrationId || !config.assigneeSync) return { success: true }

  const { ticket, newAssigneePrincipalId } = event.data
  const issueNumber = await findTicketIssueNumber(ticket.id, config.integrationId)
  if (!issueNumber) return { success: true }

  // Resolve principal → GitHub username
  const assignees: string[] = []
  if (newAssigneePrincipalId) {
    const username = await findGitHubUsername(newAssigneePrincipalId, config.integrationId)
    if (username) assignees.push(username)
  }

  console.log(
    `[GitHub] Updating issue #${issueNumber} assignees -> [${assignees.join(', ')}] in ${ownerRepo}`
  )

  try {
    const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: githubHeaders(config.accessToken),
      body: JSON.stringify({ assignees }),
    })

    if (!response.ok) {
      const errorResult = handleGitHubError(response.status, await response.text(), ownerRepo)
      if (errorResult) return errorResult
      throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      shouldRetry: isRetryableError(error),
    }
  }
}

async function handleTicketUpdated(
  event: EventData,
  ownerRepo: string,
  config: GitHubConfig
): Promise<HookResult> {
  if (event.type !== 'ticket.updated') return { success: true }
  if (!config.integrationId) return { success: true }

  const { ticket, changedFields, diff } = event.data
  const contentFields = ['subject', 'descriptionJson', 'descriptionText']
  const hasContentChange = changedFields.some((f) => contentFields.includes(f))
  const hasPriorityChange = changedFields.includes('priority')

  if (!hasContentChange && !hasPriorityChange) {
    return skipped()
  }

  const issueNumber = await findTicketIssueNumber(ticket.id, config.integrationId)
  if (!issueNumber) return skipped()

  try {
    // Sync subject/description if changed
    if (hasContentChange) {
      log.debug(`Updating issue #${issueNumber} content in ${ownerRepo}`)
      const update = buildTicketUpdateBody(ticket, config.rootUrl)
      const ticketDescriptionMarkdown = await loadTicketDescriptionMarkdown(ticket.id)
      const attachments = await listTicketPublicAttachmentsForSync(ticket.id)
      const patchBody: Record<string, unknown> = {}
      if (update.title) patchBody.title = update.title
      if (update.body) {
        const bodyWithAssets = withTicketMediaBlocks(update.body, {
          descriptionMarkdown: ticketDescriptionMarkdown,
          attachments,
        })
        patchBody.body = appendQuackbackTicketIssueMarker(bodyWithAssets, {
          ticketId: ticket.id,
          integrationId: config.integrationId,
        })
      }

      if (Object.keys(patchBody).length === 0) {
        return hasPriorityChange ? { success: true } : skipped()
      }

      const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/issues/${issueNumber}`, {
        method: 'PATCH',
        headers: githubHeaders(config.accessToken),
        body: JSON.stringify(patchBody),
      })

      if (!response.ok) {
        const errorResult = handleGitHubError(response.status, await response.text(), ownerRepo)
        if (errorResult) return errorResult
        throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
      }
    }

    // Sync priority label if changed
    if (hasPriorityChange && diff.priority) {
      const oldPriority = diff.priority.from as string | null
      const newPriority = diff.priority.to as string | null
      console.log(
        `[GitHub] Updating issue #${issueNumber} priority ${oldPriority} -> ${newPriority} in ${ownerRepo}`
      )

      if (oldPriority) {
        await removeLabel(
          ownerRepo,
          issueNumber,
          `priority:${oldPriority}`,
          config.accessToken
        ).catch((err) =>
          log.warn({ err: err }, `Failed to remove label "priority:${oldPriority}":`)
        )
      }

      if (newPriority) {
        await addLabel(ownerRepo, issueNumber, `priority:${newPriority}`, config.accessToken).catch(
          (err) => log.warn({ err: err }, `Failed to add label "priority:${newPriority}":`)
        )
      }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      shouldRetry: isRetryableError(error),
    }
  }
}

async function handleTicketThreadAdded(
  event: EventData,
  ownerRepo: string,
  config: GitHubConfig
): Promise<HookResult> {
  if (event.type !== 'ticket.thread_added') return { success: true }
  if (!config.integrationId) return skipped()
  if (event.data.audience !== 'public') return skipped()

  const { ticket, threadId, thread } = event.data
  const issueNumber = await findTicketIssueNumber(ticket.id, config.integrationId)
  if (!issueNumber) return skipped()

  const existingLink = await findThreadLinkByThread({
    integrationId: config.integrationId,
    threadId,
  })
  if (existingLink?.status === 'active') {
    return { success: true, externalId: existingLink.externalCommentId, skipped: true }
  }

  const fullThread = await loadThreadForSync(threadId)
  if (!fullThread || fullThread.deletedAt || fullThread.audience !== 'public') return skipped()

  try {
    const authorName = await getThreadAuthorName(fullThread.principalId)
    const renderedThreadBody = await renderThreadBodyForGitHub(fullThread)
    const attachmentBlock = buildAttachmentBlock(
      (await listThreadAttachmentsForSync(threadId)) ?? [],
      'Thread attachments'
    )
    const threadBody = `${renderedThreadBody}${attachmentBlock ? `\n\n${attachmentBlock}` : ''}`
    const body = buildOutboundGitHubCommentBody({
      ticketId: ticket.id,
      threadId,
      integrationId: config.integrationId,
      bodyText: threadBody,
      authorName,
      isFromRequester: thread?.isFromRequester,
    })
    const comment = await createGitHubIssueComment({
      ownerRepo,
      issueNumber,
      accessToken: config.accessToken,
      body,
    })

    await upsertThreadExternalLink({
      ticketId: ticket.id,
      threadId,
      integrationId: config.integrationId,
      externalIssueId: issueNumber,
      externalCommentId: comment.id,
      externalUrl: comment.htmlUrl,
      syncDirection: 'outbound',
    })

    return { success: true, externalId: comment.id, externalUrl: comment.htmlUrl ?? undefined }
  } catch (error) {
    return githubCommentError(error)
  }
}

async function handleTicketThreadUpdated(
  event: EventData,
  ownerRepo: string,
  config: GitHubConfig
): Promise<HookResult> {
  if (event.type !== 'ticket.thread_updated') return { success: true }
  if (!config.integrationId) return skipped()
  if (event.data.audience !== 'public') return skipped()

  const { ticket, threadId, thread } = event.data
  const link = await findThreadLinkByThread({ integrationId: config.integrationId, threadId })
  if (!link || link.status !== 'active') return skipped()

  const fullThread = await loadThreadForSync(threadId)
  if (!fullThread || fullThread.deletedAt || fullThread.audience !== 'public') return skipped()

  try {
    const authorName = await getThreadAuthorName(fullThread.principalId)
    const renderedThreadBody = await renderThreadBodyForGitHub(fullThread)
    const attachmentBlock = buildAttachmentBlock(
      (await listThreadAttachmentsForSync(threadId)) ?? [],
      'Thread attachments'
    )
    const threadBody = `${renderedThreadBody}${attachmentBlock ? `\n\n${attachmentBlock}` : ''}`
    const body = buildOutboundGitHubCommentBody({
      ticketId: ticket.id,
      threadId,
      integrationId: config.integrationId,
      bodyText: threadBody,
      authorName,
      isFromRequester: thread.isFromRequester,
    })
    const comment = await updateGitHubIssueComment({
      ownerRepo,
      commentId: link.externalCommentId,
      accessToken: config.accessToken,
      body,
    })

    await upsertThreadExternalLink({
      ticketId: ticket.id,
      threadId,
      integrationId: config.integrationId,
      externalIssueId: link.externalIssueId,
      externalCommentId: link.externalCommentId,
      externalUrl: comment.htmlUrl,
      syncDirection: 'outbound',
    })

    return {
      success: true,
      externalId: link.externalCommentId,
      externalUrl: comment.htmlUrl ?? undefined,
    }
  } catch (error) {
    return githubCommentError(error)
  }
}

async function handleTicketThreadDeleted(
  event: EventData,
  ownerRepo: string,
  config: GitHubConfig
): Promise<HookResult> {
  if (event.type !== 'ticket.thread_deleted') return { success: true }
  if (!config.integrationId) return skipped()
  if (event.data.audience !== 'public') return skipped()

  const link = await findThreadLinkByThread({
    integrationId: config.integrationId,
    threadId: event.data.threadId,
  })
  if (!link || link.status !== 'active') return skipped()

  try {
    await deleteGitHubIssueComment({
      ownerRepo,
      commentId: link.externalCommentId,
      accessToken: config.accessToken,
    })
    await markThreadLinkDeleted({
      integrationId: config.integrationId,
      externalCommentId: link.externalCommentId,
    })
    return { success: true, externalId: link.externalCommentId }
  } catch (error) {
    return githubCommentError(error)
  }
}

async function handleTicketAttachmentAdded(
  event: EventData,
  ownerRepo: string,
  config: GitHubConfig
): Promise<HookResult> {
  if (event.type !== 'ticket.attachment_added') return { success: true }
  if (!config.integrationId) return skipped()

  const { ticket, attachment } = event.data
  const issueNumber = await findTicketIssueNumber(ticket.id, config.integrationId)
  if (!issueNumber) return skipped()

  try {
    const lines: string[] = ['_Quackback attachment added_', '', formatAttachmentEntry(attachment)]
    if (attachment.publicUrl && isImageAttachment(attachment.mimeType)) {
      lines.push('', `![${attachment.filename}](${attachment.publicUrl})`)
    }
    lines.push(
      '',
      buildQuackbackSystemMarker({
        integrationId: config.integrationId,
        event: `ticket.attachment_added:${attachment.id}`,
      })
    )

    const comment = await createGitHubIssueComment({
      ownerRepo,
      issueNumber,
      accessToken: config.accessToken,
      body: lines.join('\n'),
    })

    return { success: true, externalId: comment.id, externalUrl: comment.htmlUrl ?? undefined }
  } catch (error) {
    return githubCommentError(error)
  }
}

async function handleTicketAttachmentRemoved(
  event: EventData,
  ownerRepo: string,
  config: GitHubConfig
): Promise<HookResult> {
  if (event.type !== 'ticket.attachment_removed') return { success: true }
  if (!config.integrationId) return skipped()

  const { ticket, attachment } = event.data
  const issueNumber = await findTicketIssueNumber(ticket.id, config.integrationId)
  if (!issueNumber) return skipped()

  try {
    const body = [
      '_Quackback attachment removed_',
      '',
      `Removed file: **${attachment.filename}**`,
      '',
      buildQuackbackSystemMarker({
        integrationId: config.integrationId,
        event: `ticket.attachment_removed:${attachment.id}`,
      }),
    ].join('\n')

    const comment = await createGitHubIssueComment({
      ownerRepo,
      issueNumber,
      accessToken: config.accessToken,
      body,
    })

    return { success: true, externalId: comment.id, externalUrl: comment.htmlUrl ?? undefined }
  } catch (error) {
    return githubCommentError(error)
  }
}

// ============================================================================
// Helpers
// ============================================================================

function skipped(): HookResult {
  return { success: true, skipped: true }
}

function githubCommentError(error: unknown): HookResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
    shouldRetry: isRetryableError(error),
  }
}

async function renderThreadBodyForGitHub(thread: {
  bodyJson?: unknown
  bodyText?: string | null
}): Promise<string> {
  const fallback = (thread.bodyText ?? '').trim()
  if (!thread.bodyJson) return fallback

  try {
    const { tiptapJsonToMarkdown } = await import('@/lib/server/markdown-tiptap')
    const markdown = tiptapJsonToMarkdown(thread.bodyJson).trim()
    return markdown || fallback
  } catch {
    return fallback
  }
}

async function loadTicketDescriptionMarkdown(ticketId: string): Promise<string | null> {
  try {
    const { db, tickets, eq } = await import('@/lib/server/db')
    const row = await db.query.tickets.findFirst({
      where: eq(tickets.id, ticketId as TicketId),
      columns: { descriptionJson: true, descriptionText: true },
    })
    if (!row?.descriptionJson) return row?.descriptionText?.trim() || null

    const { tiptapJsonToMarkdown } = await import('@/lib/server/markdown-tiptap')
    const markdown = tiptapJsonToMarkdown(row.descriptionJson).trim()
    return markdown || row.descriptionText?.trim() || null
  } catch {
    return null
  }
}

async function listTicketPublicAttachmentsForSync(
  ticketId: string
): Promise<TicketAttachmentForSync[]> {
  const { db, ticketAttachments, ticketThreads, eq, and } = await import('@/lib/server/db')
  return db
    .select({
      id: ticketAttachments.id,
      threadId: ticketAttachments.threadId,
      filename: ticketAttachments.filename,
      mimeType: ticketAttachments.mimeType,
      sizeBytes: ticketAttachments.sizeBytes,
      publicUrl: ticketAttachments.publicUrl,
    })
    .from(ticketAttachments)
    .innerJoin(ticketThreads, eq(ticketThreads.id, ticketAttachments.threadId))
    .where(
      and(eq(ticketThreads.ticketId, ticketId as TicketId), eq(ticketThreads.audience, 'public'))
    )
}

async function listThreadAttachmentsForSync(threadId: string): Promise<TicketAttachmentForSync[]> {
  const { db, ticketAttachments, eq } = await import('@/lib/server/db')
  return db
    .select({
      id: ticketAttachments.id,
      threadId: ticketAttachments.threadId,
      filename: ticketAttachments.filename,
      mimeType: ticketAttachments.mimeType,
      sizeBytes: ticketAttachments.sizeBytes,
      publicUrl: ticketAttachments.publicUrl,
    })
    .from(ticketAttachments)
    .where(eq(ticketAttachments.threadId, threadId as import('@quackback/ids').TicketThreadId))
}

function withTicketMediaBlocks(
  baseBody: string,
  opts: {
    descriptionMarkdown: string | null
    attachments: TicketAttachmentForSync[]
  }
): string {
  const sections = baseBody.split('\n\n---\n\n')
  const meta = sections.length > 1 ? sections[1] : ''
  const description = opts.descriptionMarkdown?.trim() || sections[0]?.trim() || ''
  const attachmentBlock = buildAttachmentBlock(opts.attachments, 'Attachments')

  const bodySections: string[] = [description || sections[0] || '']
  if (attachmentBlock) {
    bodySections.push(attachmentBlock)
  }
  if (meta) {
    bodySections.push(`---\n\n${meta}`)
  }

  return bodySections.filter(Boolean).join('\n\n')
}

function buildAttachmentBlock(attachments: TicketAttachmentForSync[], heading: string): string {
  if (!attachments.length) return ''

  const lines: string[] = [`### ${heading}`]
  for (const attachment of attachments) {
    lines.push(formatAttachmentEntry(attachment))
    if (attachment.publicUrl && isImageAttachment(attachment.mimeType)) {
      lines.push('', `![${attachment.filename}](${attachment.publicUrl})`)
    }
  }
  return lines.join('\n')
}

function formatAttachmentEntry(attachment: {
  filename: string
  publicUrl: string | null
  mimeType: string
  sizeBytes: number
}): string {
  const sizeLabel = formatBytes(attachment.sizeBytes)
  const fileLabel = attachment.publicUrl
    ? `[${attachment.filename}](${attachment.publicUrl})`
    : `**${attachment.filename}**`
  return `- ${fileLabel} (${attachment.mimeType}, ${sizeLabel})`
}

function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = sizeBytes
  let unitIdx = 0
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024
    unitIdx += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIdx]}`
}

function isImageAttachment(mimeType: string | null | undefined): boolean {
  return typeof mimeType === 'string' && mimeType.startsWith('image/')
}

/**
 * Add a label to a GitHub issue. Creates the label if it doesn't exist.
 * Best-effort — errors are not fatal.
 */
async function addLabel(
  ownerRepo: string,
  issueNumber: string,
  label: string,
  accessToken: string
): Promise<void> {
  await fetch(`${GITHUB_API}/repos/${ownerRepo}/issues/${issueNumber}/labels`, {
    method: 'POST',
    headers: githubHeaders(accessToken),
    body: JSON.stringify({ labels: [label] }),
  })
}

/**
 * Remove a label from a GitHub issue.
 * Best-effort — errors are not fatal (e.g. label may not exist).
 */
async function removeLabel(
  ownerRepo: string,
  issueNumber: string,
  label: string,
  accessToken: string
): Promise<void> {
  await fetch(
    `${GITHUB_API}/repos/${ownerRepo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
    {
      method: 'DELETE',
      headers: githubHeaders(accessToken),
    }
  )
}
