import type { IntegrationId, PrincipalId, TicketId, TicketThreadId } from '@quackback/ids'
import type { TicketThread } from '@/lib/server/db'

const GITHUB_API = 'https://api.github.com'
const MARKER_RE =
  /<!--\s*quackback:ticket-thread\s+ticketId=([^\s]+)\s+threadId=([^\s]+)\s+integrationId=([^\s]+)\s*-->/i
const SYSTEM_MARKER_RE =
  /<!--\s*quackback:ticket-system\s+integrationId=([^\s]+)\s+event=([^\s]+)\s*-->/i

export interface QuackbackThreadMarker {
  ticketId: string
  threadId: string
  integrationId: string
}

export interface QuackbackSystemMarker {
  integrationId: string
  event: string
}

export interface GitHubIssueComment {
  id: number | string
  body: string | null
  html_url?: string
  user?: {
    login?: string
    type?: string
  } | null
  created_at?: string
  updated_at?: string
}

export function parseQuackbackThreadMarker(
  body: string | null | undefined
): QuackbackThreadMarker | null {
  const match = body?.match(MARKER_RE)
  if (!match) return null
  return { ticketId: match[1], threadId: match[2], integrationId: match[3] }
}

export function stripQuackbackThreadMarker(body: string | null | undefined): string {
  return (body ?? '').replace(MARKER_RE, '').trim()
}

export function buildQuackbackThreadMarker(args: {
  ticketId: string
  threadId: string
  integrationId: string
}): string {
  return `<!-- quackback:ticket-thread ticketId=${args.ticketId} threadId=${args.threadId} integrationId=${args.integrationId} -->`
}

export function parseQuackbackSystemMarker(
  body: string | null | undefined
): QuackbackSystemMarker | null {
  const match = body?.match(SYSTEM_MARKER_RE)
  if (!match) return null
  return { integrationId: match[1], event: match[2] }
}

export function buildQuackbackSystemMarker(args: { integrationId: string; event: string }): string {
  return `<!-- quackback:ticket-system integrationId=${args.integrationId} event=${args.event} -->`
}

export function buildOutboundGitHubCommentBody(args: {
  ticketId: string
  threadId: string
  integrationId: string
  bodyText: string
  authorName?: string | null
  isFromRequester?: boolean
}): string {
  const author = args.authorName?.trim()
  const source = args.isFromRequester ? 'Customer reply from Quackback' : 'Quackback reply'
  const heading = author ? `_${source} by ${author}_` : `_${source}_`
  return [heading, '', args.bodyText.trim(), '', buildQuackbackThreadMarker(args)].join('\n').trim()
}

export function buildInboundTicketThreadBody(comment: GitHubIssueComment): string {
  const login = comment.user?.login?.trim() || 'GitHub user'
  const body = stripQuackbackThreadMarker(comment.body)
  return [`GitHub reply from ${login}:`, '', body].join('\n').trim()
}

export function githubHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'quackback',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export async function createGitHubIssueComment(args: {
  ownerRepo: string
  issueNumber: string
  accessToken: string
  body: string
}): Promise<{ id: string; htmlUrl: string | null }> {
  const response = await fetch(
    `${GITHUB_API}/repos/${args.ownerRepo}/issues/${args.issueNumber}/comments`,
    {
      method: 'POST',
      headers: githubHeaders(args.accessToken),
      body: JSON.stringify({ body: args.body }),
    }
  )
  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status}: ${await response.text()}`), {
      status: response.status,
    })
  }
  const json = (await response.json()) as { id: number | string; html_url?: string }
  return { id: String(json.id), htmlUrl: json.html_url ?? null }
}

export async function updateGitHubIssueComment(args: {
  ownerRepo: string
  commentId: string
  accessToken: string
  body: string
}): Promise<{ htmlUrl: string | null }> {
  const response = await fetch(
    `${GITHUB_API}/repos/${args.ownerRepo}/issues/comments/${args.commentId}`,
    {
      method: 'PATCH',
      headers: githubHeaders(args.accessToken),
      body: JSON.stringify({ body: args.body }),
    }
  )
  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status}: ${await response.text()}`), {
      status: response.status,
    })
  }
  const json = (await response.json()) as { html_url?: string }
  return { htmlUrl: json.html_url ?? null }
}

export async function deleteGitHubIssueComment(args: {
  ownerRepo: string
  commentId: string
  accessToken: string
}): Promise<void> {
  const response = await fetch(
    `${GITHUB_API}/repos/${args.ownerRepo}/issues/comments/${args.commentId}`,
    {
      method: 'DELETE',
      headers: githubHeaders(args.accessToken),
    }
  )
  if (!response.ok && response.status !== 404) {
    throw Object.assign(new Error(`HTTP ${response.status}: ${await response.text()}`), {
      status: response.status,
    })
  }
}

export async function listGitHubIssueComments(args: {
  ownerRepo: string
  issueNumber: string
  accessToken: string
  since?: string
}): Promise<GitHubIssueComment[]> {
  const comments: GitHubIssueComment[] = []
  let url = `${GITHUB_API}/repos/${args.ownerRepo}/issues/${args.issueNumber}/comments?per_page=100`
  if (args.since) url += `&since=${encodeURIComponent(args.since)}`

  while (url) {
    const response = await fetch(url, { headers: githubHeaders(args.accessToken) })
    if (!response.ok) {
      throw Object.assign(new Error(`HTTP ${response.status}: ${await response.text()}`), {
        status: response.status,
      })
    }
    comments.push(...((await response.json()) as GitHubIssueComment[]))
    url = parseNextLink(response.headers.get('link'))
  }

  return comments
}

export async function getThreadAuthorName(
  principalId: string | null | undefined
): Promise<string | null> {
  if (!principalId) return null
  const { db, principal, eq } = await import('@/lib/server/db')
  const row = await db.query.principal.findFirst({
    where: eq(principal.id, principalId as PrincipalId),
    columns: { displayName: true },
    with: { user: { columns: { name: true, email: true } } },
  })
  return row?.displayName || row?.user?.name || row?.user?.email || null
}

export async function findThreadLinkByThread(args: {
  integrationId: string
  threadId: string
}): Promise<{
  ticketId: TicketId
  threadId: TicketThreadId
  externalIssueId: string
  externalCommentId: string
  status: string
} | null> {
  const { db, ticketThreadExternalLinks, eq, and } = await import('@/lib/server/db')
  const row = await db.query.ticketThreadExternalLinks.findFirst({
    where: and(
      eq(ticketThreadExternalLinks.integrationId, args.integrationId as IntegrationId),
      eq(ticketThreadExternalLinks.threadId, args.threadId as TicketThreadId)
    ),
  })
  return row
    ? {
        ticketId: row.ticketId as TicketId,
        threadId: row.threadId as TicketThreadId,
        externalIssueId: row.externalIssueId,
        externalCommentId: row.externalCommentId,
        status: row.status,
      }
    : null
}

export async function findThreadLinkByExternalComment(args: {
  integrationId: string
  externalCommentId: string
}): Promise<{
  ticketId: TicketId
  threadId: TicketThreadId
  externalIssueId: string
  externalCommentId: string
  status: string
} | null> {
  const { db, ticketThreadExternalLinks, eq, and } = await import('@/lib/server/db')
  const row = await db.query.ticketThreadExternalLinks.findFirst({
    where: and(
      eq(ticketThreadExternalLinks.integrationId, args.integrationId as IntegrationId),
      eq(ticketThreadExternalLinks.externalCommentId, args.externalCommentId)
    ),
  })
  return row
    ? {
        ticketId: row.ticketId as TicketId,
        threadId: row.threadId as TicketThreadId,
        externalIssueId: row.externalIssueId,
        externalCommentId: row.externalCommentId,
        status: row.status,
      }
    : null
}

export async function upsertThreadExternalLink(args: {
  ticketId: string
  threadId: string
  integrationId: string
  externalIssueId: string
  externalCommentId: string
  externalUrl?: string | null
  syncDirection: 'outbound' | 'inbound' | 'bidirectional'
  status?: 'active' | 'deleted'
}): Promise<void> {
  const { db, ticketThreadExternalLinks, eq, and, sql } = await import('@/lib/server/db')
  const now = new Date()
  const values = {
    ticketId: args.ticketId as TicketId,
    threadId: args.threadId as TicketThreadId,
    integrationId: args.integrationId as IntegrationId,
    integrationType: 'github',
    externalIssueId: args.externalIssueId,
    externalCommentId: args.externalCommentId,
    externalUrl: args.externalUrl ?? null,
    syncDirection: args.syncDirection,
    status: args.status ?? 'active',
    lastSyncedAt: now,
    updatedAt: now,
  }
  const updateValues = {
    ticketId: values.ticketId,
    threadId: values.threadId,
    externalIssueId: values.externalIssueId,
    externalCommentId: values.externalCommentId,
    externalUrl: values.externalUrl,
    syncDirection: values.syncDirection,
    status: values.status,
    lastSyncedAt: values.lastSyncedAt,
    updatedAt: values.updatedAt,
  }

  try {
    await db
      .insert(ticketThreadExternalLinks)
      .values(values)
      .onConflictDoUpdate({
        target: [
          ticketThreadExternalLinks.integrationId,
          ticketThreadExternalLinks.externalCommentId,
        ],
        set: {
          threadId: sql`excluded.thread_id`,
          ticketId: sql`excluded.ticket_id`,
          externalIssueId: sql`excluded.external_issue_id`,
          externalUrl: sql`excluded.external_url`,
          syncDirection: sql`excluded.sync_direction`,
          status: sql`excluded.status`,
          lastSyncedAt: now,
          updatedAt: now,
        },
      })
  } catch (error) {
    if (!isUniqueViolation(error)) throw error

    await db
      .update(ticketThreadExternalLinks)
      .set(updateValues)
      .where(
        and(
          eq(ticketThreadExternalLinks.integrationId, args.integrationId as IntegrationId),
          eq(ticketThreadExternalLinks.threadId, args.threadId as TicketThreadId)
        )
      )
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ('code' in error || 'cause' in error) &&
    ((error as { code?: unknown }).code === '23505' ||
      isUniqueViolation((error as { cause?: unknown }).cause))
  )
}

export async function markThreadLinkDeleted(args: {
  integrationId: string
  externalCommentId: string
}): Promise<void> {
  const { db, ticketThreadExternalLinks, eq, and } = await import('@/lib/server/db')
  await db
    .update(ticketThreadExternalLinks)
    .set({ status: 'deleted', lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(ticketThreadExternalLinks.integrationId, args.integrationId as IntegrationId),
        eq(ticketThreadExternalLinks.externalCommentId, args.externalCommentId)
      )
    )
}

export async function loadThreadForSync(threadId: string): Promise<TicketThread | null> {
  const { db, ticketThreads, eq } = await import('@/lib/server/db')
  return (
    (await db.query.ticketThreads.findFirst({
      where: eq(ticketThreads.id, threadId as TicketThreadId),
    })) ?? null
  )
}

function parseNextLink(linkHeader: string | null): string {
  if (!linkHeader) return ''
  const part = linkHeader.split(',').find((item) => item.includes('rel="next"'))
  if (!part) return ''
  const match = part.match(/<([^>]+)>/)
  return match?.[1] ?? ''
}
