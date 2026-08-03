#!/usr/bin/env bun
/**
 * Backfill two-way GitHub issue comment sync for linked tickets.
 *
 * Usage:
 *   bun apps/web/scripts/backfill-github-ticket-comments.ts --dry-run
 *   bun apps/web/scripts/backfill-github-ticket-comments.ts --integration-id=integration_...
 *   bun apps/web/scripts/backfill-github-ticket-comments.ts --ticket-id=ticket_...
 *   bun apps/web/scripts/backfill-github-ticket-comments.ts --direction=github-to-quackback
 *   bun apps/web/scripts/backfill-github-ticket-comments.ts --direction=quackback-to-github
 *   bun apps/web/scripts/backfill-github-ticket-comments.ts --since=2026-06-01T00:00:00Z
 *
 * Environment:
 *   DATABASE_URL — Required. PostgreSQL connection string.
 */

try {
  const { config } = await import('dotenv')
  config({ path: '.env', quiet: true })
} catch {
  // dotenv not available; rely on environment variables.
}

import {
  db,
  eq,
  and,
  integrations,
  ticketExternalLinks,
  ticketThreadExternalLinks,
  ticketThreads,
} from '@/lib/server/db'
import type { IntegrationId, PrincipalId, TicketId, TicketThreadId } from '@quackback/ids'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import type { GitHubIntegrationConfig } from '@/lib/server/integrations/github/types'
import {
  buildInboundTicketThreadBody,
  buildOutboundGitHubCommentBody,
  createGitHubIssueComment,
  deleteGitHubIssueComment,
  findThreadLinkByExternalComment,
  findThreadLinkByThread,
  getThreadAuthorName,
  listGitHubIssueComments,
  loadThreadForSync,
  markThreadLinkDeleted,
  parseQuackbackThreadMarker,
  upsertThreadExternalLink,
  type GitHubIssueComment,
} from '@/lib/server/integrations/github/ticket-comments'
import {
  addThread,
  editThread,
  listPublicThreadsForTicket,
} from '@/lib/server/domains/tickets/ticket.threads'

type Direction = 'both' | 'github-to-quackback' | 'quackback-to-github'

interface Flags {
  dryRun: boolean
  integrationId: string | null
  ticketId: string | null
  direction: Direction
  since: string | null
}

interface Counters {
  created: number
  updated: number
  deleted: number
  linked: number
  skipped: number
}

interface GitHubIntegrationRow {
  id: IntegrationId
  principalId: PrincipalId | null
  config: GitHubIntegrationConfig
  accessToken: string
}

interface TicketIssueLink {
  ticketId: TicketId
  externalId: string
  externalUrl: string | null
}

function printUsage(): void {
  console.log(`Backfill GitHub ticket comment sync.

Usage:
  bun apps/web/scripts/backfill-github-ticket-comments.ts [flags]

Flags:
  --dry-run                 Preview without writing.
  --integration-id=ID       Limit to one GitHub integration.
  --ticket-id=ID            Limit to one linked ticket.
  --direction=DIR           both | github-to-quackback | quackback-to-github (default both).
  --since=ISO_TIMESTAMP     Only fetch GitHub comments updated since this timestamp.
  --help                    Show this message.

Notes:
  Deletes are only reconciled when --since is omitted, because GitHub's list endpoint
  cannot report deleted comments inside a since window.
`)
}

function parseFlags(argv: string[]): Flags {
  const direction = readArg(argv, '--direction') ?? 'both'
  if (!['both', 'github-to-quackback', 'quackback-to-github'].includes(direction)) {
    throw new Error('--direction must be both, github-to-quackback, or quackback-to-github')
  }
  const since = readArg(argv, '--since')
  if (since && Number.isNaN(Date.parse(since))) {
    throw new Error('--since must be an ISO timestamp')
  }
  return {
    dryRun: argv.includes('--dry-run'),
    integrationId: readArg(argv, '--integration-id'),
    ticketId: readArg(argv, '--ticket-id'),
    direction: direction as Direction,
    since: since ? new Date(since).toISOString() : null,
  }
}

function readArg(argv: string[], name: string): string | null {
  const prefix = `${name}=`
  const value = argv.find((arg) => arg.startsWith(prefix))
  return value ? value.slice(prefix.length) : null
}

async function loadIntegrations(flags: Flags): Promise<GitHubIntegrationRow[]> {
  const conditions = [eq(integrations.integrationType, 'github'), eq(integrations.status, 'active')]
  if (flags.integrationId) {
    conditions.push(eq(integrations.id, flags.integrationId as IntegrationId))
  }

  const rows = await db.query.integrations.findMany({
    where: and(...conditions),
  })

  return rows.flatMap((row) => {
    const config = (row.config ?? {}) as GitHubIntegrationConfig
    const ownerRepo = config.channelId
    if (!ownerRepo) {
      console.warn(`[github-comments-backfill] skip integration ${row.id}: missing channelId`)
      return []
    }
    if (!row.secrets) {
      console.warn(`[github-comments-backfill] skip integration ${row.id}: missing secrets`)
      return []
    }
    const secrets = decryptSecrets<{ accessToken?: string }>(row.secrets)
    if (!secrets.accessToken) {
      console.warn(`[github-comments-backfill] skip integration ${row.id}: missing access token`)
      return []
    }
    return [
      {
        id: row.id as IntegrationId,
        principalId: (row.principalId as PrincipalId | null) ?? null,
        config,
        accessToken: secrets.accessToken,
      },
    ]
  })
}

async function loadIssueLinks(
  integration: GitHubIntegrationRow,
  flags: Flags
): Promise<TicketIssueLink[]> {
  const conditions = [
    eq(ticketExternalLinks.integrationId, integration.id),
    eq(ticketExternalLinks.status, 'active'),
  ]
  if (flags.ticketId) {
    conditions.push(eq(ticketExternalLinks.ticketId, flags.ticketId as TicketId))
  }
  return db
    .select({
      ticketId: ticketExternalLinks.ticketId,
      externalId: ticketExternalLinks.externalId,
      externalUrl: ticketExternalLinks.externalUrl,
    })
    .from(ticketExternalLinks)
    .where(and(...conditions))
}

async function backfillGitHubToQuackback(
  integration: GitHubIntegrationRow,
  issueLink: TicketIssueLink,
  flags: Flags,
  counters: Counters
): Promise<void> {
  const comments = await listGitHubIssueComments({
    ownerRepo: integration.config.channelId,
    issueNumber: issueLink.externalId,
    accessToken: integration.accessToken,
    since: flags.since ?? undefined,
  })
  const remoteIds = new Set(comments.map((comment) => String(comment.id)))

  for (const comment of comments) {
    const externalCommentId = String(comment.id)
    const marker = parseQuackbackThreadMarker(comment.body)
    if (marker) {
      if (marker.integrationId === integration.id) {
        await maybeLinkMarker(integration, issueLink, comment, marker, flags, counters)
      } else {
        counters.skipped++
      }
      continue
    }

    if (!commentBody(comment)) {
      counters.skipped++
      continue
    }

    const link = await findThreadLinkByExternalComment({
      integrationId: integration.id,
      externalCommentId,
    })
    const nextBody = buildInboundTicketThreadBody(comment)

    if (link?.status === 'active') {
      const thread = await loadThreadForSync(link.threadId)
      if (!thread || thread.deletedAt) {
        await createInboundThread(integration, issueLink, comment, flags, counters)
        continue
      }
      if (thread.bodyText !== nextBody) {
        if (flags.dryRun) {
          console.log(
            `[dry-run] update ticket thread ${thread.id} from GitHub comment ${externalCommentId}`
          )
        } else {
          await editThread({
            threadId: thread.id,
            actorPrincipalId: (thread.principalId as PrincipalId | null) ?? integration.principalId,
            bodyText: nextBody,
            syncSourceIntegrationId: integration.id,
          })
          await upsertThreadExternalLink({
            ticketId: issueLink.ticketId,
            threadId: thread.id,
            integrationId: integration.id,
            externalIssueId: issueLink.externalId,
            externalCommentId,
            externalUrl: comment.html_url ?? null,
            syncDirection: 'inbound',
          })
        }
        counters.updated++
      } else {
        counters.skipped++
      }
      continue
    }

    await createInboundThread(integration, issueLink, comment, flags, counters)
  }

  if (!flags.since) {
    await deleteMissingInboundThreads(integration, issueLink, remoteIds, flags, counters)
  }
}

async function backfillQuackbackToGitHub(
  integration: GitHubIntegrationRow,
  issueLink: TicketIssueLink,
  flags: Flags,
  counters: Counters
): Promise<void> {
  const comments = await listGitHubIssueComments({
    ownerRepo: integration.config.channelId,
    issueNumber: issueLink.externalId,
    accessToken: integration.accessToken,
  })
  const markerByThreadId = new Map<string, GitHubIssueComment>()
  for (const comment of comments) {
    const marker = parseQuackbackThreadMarker(comment.body)
    if (marker?.integrationId === integration.id && marker.ticketId === issueLink.ticketId) {
      markerByThreadId.set(marker.threadId, comment)
    }
  }

  const publicThreads = await listPublicThreadsForTicket(issueLink.ticketId)
  const sinceMs = flags.since ? Date.parse(flags.since) : null

  for (const thread of publicThreads) {
    if (
      sinceMs &&
      thread.createdAt.getTime() < sinceMs &&
      (thread.editedAt?.getTime() ?? 0) < sinceMs
    ) {
      counters.skipped++
      continue
    }

    const link = await findThreadLinkByThread({
      integrationId: integration.id,
      threadId: thread.id,
    })
    if (link?.status === 'active') {
      counters.skipped++
      continue
    }
    if (link?.status === 'deleted') {
      counters.skipped++
      continue
    }

    const markerComment = markerByThreadId.get(thread.id)
    if (markerComment) {
      if (flags.dryRun) {
        console.log(
          `[dry-run] link existing GitHub comment ${markerComment.id} to ticket thread ${thread.id}`
        )
      } else {
        await upsertThreadExternalLink({
          ticketId: issueLink.ticketId,
          threadId: thread.id,
          integrationId: integration.id,
          externalIssueId: issueLink.externalId,
          externalCommentId: String(markerComment.id),
          externalUrl: markerComment.html_url ?? null,
          syncDirection: 'outbound',
        })
      }
      counters.linked++
      continue
    }

    const authorName = await getThreadAuthorName(thread.principalId)
    const body = buildOutboundGitHubCommentBody({
      ticketId: issueLink.ticketId,
      threadId: thread.id,
      integrationId: integration.id,
      bodyText: thread.bodyText,
      authorName,
      isFromRequester: false,
    })

    if (flags.dryRun) {
      console.log(
        `[dry-run] create GitHub comment for ticket ${issueLink.ticketId} thread ${thread.id}`
      )
    } else {
      const comment = await createGitHubIssueComment({
        ownerRepo: integration.config.channelId,
        issueNumber: issueLink.externalId,
        accessToken: integration.accessToken,
        body,
      })
      await upsertThreadExternalLink({
        ticketId: issueLink.ticketId,
        threadId: thread.id,
        integrationId: integration.id,
        externalIssueId: issueLink.externalId,
        externalCommentId: comment.id,
        externalUrl: comment.htmlUrl,
        syncDirection: 'outbound',
      })
    }
    counters.created++
  }

  if (!flags.since) {
    await deleteRemoteCommentsForDeletedThreads(integration, issueLink, flags, counters)
  }
}

async function maybeLinkMarker(
  integration: GitHubIntegrationRow,
  issueLink: TicketIssueLink,
  comment: GitHubIssueComment,
  marker: { ticketId: string; threadId: string; integrationId: string },
  flags: Flags,
  counters: Counters
): Promise<void> {
  if (flags.dryRun) {
    console.log(`[dry-run] link marker GitHub comment ${comment.id} to thread ${marker.threadId}`)
  } else {
    await upsertThreadExternalLink({
      ticketId: marker.ticketId,
      threadId: marker.threadId,
      integrationId: integration.id,
      externalIssueId: issueLink.externalId,
      externalCommentId: String(comment.id),
      externalUrl: comment.html_url ?? null,
      syncDirection: 'outbound',
    })
  }
  counters.linked++
}

async function createInboundThread(
  integration: GitHubIntegrationRow,
  issueLink: TicketIssueLink,
  comment: GitHubIssueComment,
  flags: Flags,
  counters: Counters
): Promise<void> {
  const externalCommentId = String(comment.id)
  if (flags.dryRun) {
    console.log(
      `[dry-run] create public ticket thread on ${issueLink.ticketId} from GitHub comment ${externalCommentId}`
    )
  } else {
    const thread = await addThread({
      ticketId: issueLink.ticketId,
      principalId: integration.principalId,
      audience: 'public',
      bodyText: buildInboundTicketThreadBody(comment),
      syncSourceIntegrationId: integration.id,
    })
    await upsertThreadExternalLink({
      ticketId: issueLink.ticketId,
      threadId: thread.id,
      integrationId: integration.id,
      externalIssueId: issueLink.externalId,
      externalCommentId,
      externalUrl: comment.html_url ?? null,
      syncDirection: 'inbound',
    })
  }
  counters.created++
}

async function deleteMissingInboundThreads(
  integration: GitHubIntegrationRow,
  issueLink: TicketIssueLink,
  remoteIds: Set<string>,
  flags: Flags,
  counters: Counters
): Promise<void> {
  const links = await db
    .select({
      threadId: ticketThreadExternalLinks.threadId,
      externalCommentId: ticketThreadExternalLinks.externalCommentId,
      syncDirection: ticketThreadExternalLinks.syncDirection,
    })
    .from(ticketThreadExternalLinks)
    .where(
      and(
        eq(ticketThreadExternalLinks.integrationId, integration.id),
        eq(ticketThreadExternalLinks.externalIssueId, issueLink.externalId),
        eq(ticketThreadExternalLinks.status, 'active')
      )
    )

  for (const link of links) {
    if (link.syncDirection === 'outbound') continue
    if (remoteIds.has(link.externalCommentId)) continue
    if (flags.dryRun) {
      console.log(
        `[dry-run] delete local thread ${link.threadId} because GitHub comment ${link.externalCommentId} is gone`
      )
    } else {
      await softDeleteLinkedThread(integration, link.threadId, link.externalCommentId)
    }
    counters.deleted++
  }
}

async function deleteRemoteCommentsForDeletedThreads(
  integration: GitHubIntegrationRow,
  issueLink: TicketIssueLink,
  flags: Flags,
  counters: Counters
): Promise<void> {
  const links = await db
    .select({
      threadId: ticketThreadExternalLinks.threadId,
      externalCommentId: ticketThreadExternalLinks.externalCommentId,
    })
    .from(ticketThreadExternalLinks)
    .where(
      and(
        eq(ticketThreadExternalLinks.integrationId, integration.id),
        eq(ticketThreadExternalLinks.externalIssueId, issueLink.externalId),
        eq(ticketThreadExternalLinks.status, 'active')
      )
    )

  for (const link of links) {
    const thread = await loadThreadForSync(link.threadId)
    if (!thread?.deletedAt) continue
    if (flags.dryRun) {
      console.log(
        `[dry-run] delete GitHub comment ${link.externalCommentId} for deleted thread ${link.threadId}`
      )
    } else {
      await deleteGitHubIssueComment({
        ownerRepo: integration.config.channelId,
        commentId: link.externalCommentId,
        accessToken: integration.accessToken,
      })
      await markThreadLinkDeleted({
        integrationId: integration.id,
        externalCommentId: link.externalCommentId,
      })
    }
    counters.deleted++
  }
}

async function softDeleteLinkedThread(
  integration: GitHubIntegrationRow,
  threadId: TicketThreadId,
  externalCommentId: string
): Promise<void> {
  const { softDeleteThread } = await import('@/lib/server/domains/tickets/ticket.threads')
  const thread = await db.query.ticketThreads.findFirst({
    where: eq(ticketThreads.id, threadId),
    columns: { principalId: true, deletedAt: true },
  })
  if (!thread || thread.deletedAt) {
    await markThreadLinkDeleted({ integrationId: integration.id, externalCommentId })
    return
  }
  await softDeleteThread(
    threadId,
    (thread.principalId as PrincipalId | null) ?? integration.principalId,
    integration.id
  )
  await markThreadLinkDeleted({ integrationId: integration.id, externalCommentId })
}

function commentBody(comment: GitHubIssueComment): string {
  return (comment.body ?? '').trim()
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help')) {
    printUsage()
    return
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

  const flags = parseFlags(argv)
  const counters: Counters = { created: 0, updated: 0, deleted: 0, linked: 0, skipped: 0 }
  console.log('[github-comments-backfill] start', flags)

  const integrationsToProcess = await loadIntegrations(flags)
  if (integrationsToProcess.length === 0) {
    console.log('[github-comments-backfill] no matching active GitHub integrations')
    return
  }

  for (const integration of integrationsToProcess) {
    const links = await loadIssueLinks(integration, flags)
    console.log('[github-comments-backfill] integration', {
      integrationId: integration.id,
      repo: integration.config.channelId,
      linkedTickets: links.length,
    })

    for (const issueLink of links) {
      if (flags.direction === 'both' || flags.direction === 'github-to-quackback') {
        await backfillGitHubToQuackback(integration, issueLink, flags, counters)
      }
      if (flags.direction === 'both' || flags.direction === 'quackback-to-github') {
        await backfillQuackbackToGitHub(integration, issueLink, flags, counters)
      }
    }
  }

  console.log('[github-comments-backfill] summary', counters)
}

main().catch((error) => {
  console.error('[github-comments-backfill] failed', error)
  process.exit(1)
})
