/**
 * A linked ticket's public reply as a comment on its GitHub issue, and the
 * calls that write it. The comment is the connection's own: posted from the
 * reply and only ever edited or deleted to follow it.
 *
 * The body is a one-line header saying where it came from (a teammate's reply
 * names the teammate; a requester's reply names nobody, since the issue may be
 * public), the reply as Markdown, the reply's own files (images shown inline,
 * anything else linked), and a hidden marker naming the reply and the
 * connection, so the comment is recognisable when GitHub sends it back.
 *
 * Comments written on GitHub are only ever read: from a delivery
 * (`inbound.ts`) or, when a ticket is resynced, from the issue (`list`), both
 * as `githubRemoteComment` describes them.
 */
import type { IssueCommentCapability, TicketReplySource } from '@/lib/server/integrations/types'
import type { RemoteIssueComment } from '@/lib/server/integrations/inbound-types'
import { githubLoginsMatch, githubThreadKey } from '@/lib/server/domains/channels/github-thread'
import { hasQuackbackMarker } from '@/lib/server/domains/conversation/conversation.github-inbound-store'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
import { absolutizeMarkdownUrls } from '@/lib/server/integrations/post-content'
import { issueError } from '@/lib/server/integrations/message-utils'
import { getBaseUrl } from '@/lib/server/config'
import { attachmentsSection, cutMarkdown } from '@/integrations/github/server/ticket-issue'

const GITHUB_API = 'https://api.github.com'

/** GitHub refuses a comment body over 65,536 characters; stay clear of it. */
export const GITHUB_COMMENT_BODY_LIMIT = 65_000

/** The attachments section gets at most this share of the body; the reply keeps the rest. */
const ATTACHMENTS_LIMIT = 16_000

export function ticketCommentMarker(messageId: string, integrationId: string): string {
  return `<!-- quackback:ticket-comment messageId=${messageId} integrationId=${integrationId} -->`
}

const TICKET_COMMENT_MARKER =
  /<!--\s*quackback:ticket-comment\s+messageId=(\S+)\s+integrationId=(\S+)\s*-->/

/** The reply and connection a comment's marker names, if it carries one. */
export function parseTicketCommentMarker(
  body: string | null | undefined
): { messageId: string; integrationId: string } | null {
  const match = TICKET_COMMENT_MARKER.exec(body ?? '')
  return match ? { messageId: match[1], integrationId: match[2] } : null
}

/** An issue comment as GitHub's API and webhooks send it. */
export interface GitHubIssueCommentPayload {
  id?: number | string
  body?: string | null
  html_url?: string
  user?: { id?: number | string | null; login?: string } | null
  created_at?: string
  updated_at?: string
}

/**
 * A GitHub comment as the sync reads it, or null when it lacks what that
 * needs. `config.username` is the connection's own account, whose comments
 * are its own.
 */
export function githubRemoteComment(
  comment: GitHubIssueCommentPayload | null | undefined,
  config: Record<string, unknown>
): RemoteIssueComment | null {
  const login = comment?.user?.login
  if (!comment?.id || !login || !comment.created_at) return null
  const body = comment.body ?? ''
  const userId = comment.user?.id
  return {
    externalId: String(comment.id),
    externalUrl: comment.html_url ?? null,
    body,
    author: {
      externalUserId:
        typeof userId === 'number' || typeof userId === 'string' ? String(userId) : null,
      login,
    },
    createdAt: comment.created_at,
    updatedAt: comment.updated_at ?? comment.created_at,
    byConnection: githubLoginsMatch(
      typeof config.username === 'string' ? config.username : undefined,
      login
    ),
    marked: hasQuackbackMarker(body),
    mirrorOf: parseTicketCommentMarker(body),
  }
}

/** A display name as plain text inside the italic header. */
function headerName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`)
    .trim()
}

function header(reply: TicketReplySource): string {
  if (reply.senderType === 'visitor') return '_Customer reply from Quackback_'
  const name = reply.authorName ? headerName(reply.authorName) : ''
  return name ? `_Quackback reply by ${name}_` : '_Quackback reply_'
}

/** The comment a reply becomes. */
export function buildGitHubTicketComment(
  reply: TicketReplySource,
  context: { integrationId: string },
  rootUrl: string = getBaseUrl()
): string {
  const attachments = attachmentsSection(reply.attachments, rootUrl, ATTACHMENTS_LIMIT)
  const marker = ticketCommentMarker(reply.messageId, context.integrationId)
  const head = header(reply)
  const fixed = [attachments, marker].filter(Boolean).join('\n\n')
  // What the reply may take: the limit less the header, the fixed parts and the blank lines between.
  const room = GITHUB_COMMENT_BODY_LIMIT - head.length - fixed.length - 4
  const body = cutMarkdown(absolutizeMarkdownUrls(reply.markdown.trim(), rootUrl, false), room)
  return [head, body, fixed].filter(Boolean).join('\n\n')
}

export function githubHeaders(accessToken: unknown): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'quackback',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** A repository name the API path may carry. */
export function repository(auth: Record<string, unknown>): string {
  const ownerRepo = auth.channelId
  if (typeof ownerRepo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(ownerRepo))
    throw issueError('No repository configured', { retryable: false })
  return ownerRepo
}

/** A numeric id the API path may carry. */
export function numericId(value: string, what: string): string {
  if (!/^\d+$/.test(value)) throw issueError(`Invalid ${what}`, { retryable: false })
  return value
}

/** A rejected request as an `issueError` with its status, which the ledger classifies. */
export async function rejected(response: Response, ownerRepo: string): Promise<Error> {
  const status = response.status
  if (status === 401)
    return issueError('Authentication failed. Please reconnect GitHub.', {
      retryable: false,
      status,
    })
  if (status === 404)
    return issueError(`The issue or comment is not accessible in "${ownerRepo}".`, {
      retryable: false,
      status,
    })
  if (status === 422)
    return issueError(`Validation error: ${await response.text()}`, { retryable: false, status })
  if (status === 429) return issueError('Rate limited by GitHub API.', { retryable: true, status })
  return issueError(`HTTP ${status}: ${await response.text()}`, { status })
}

async function commentRef(response: Response): Promise<{
  externalId: string
  externalUrl: string | null
  version: string | null
}> {
  const comment = (await response.json()) as {
    id: number | string
    html_url?: string
    updated_at?: string
  }
  return {
    externalId: String(comment.id),
    externalUrl: comment.html_url ?? null,
    version: comment.updated_at ?? null,
  }
}

export const githubIssueComments: IssueCommentCapability = {
  format: (reply, context) => buildGitHubTicketComment(reply, context),

  threadKey: ({ channelId }, issueId) => githubThreadKey(channelId, issueId),

  async create({ auth, issueId, body }) {
    const ownerRepo = repository(auth)
    const response = await integrationFetch(
      `${GITHUB_API}/repos/${ownerRepo}/issues/${numericId(issueId, 'issue number')}/comments`,
      { method: 'POST', headers: githubHeaders(auth.accessToken), body: JSON.stringify({ body }) }
    )
    if (!response.ok) throw await rejected(response, ownerRepo)
    return commentRef(response)
  },

  async update({ auth, commentId, body }) {
    const ownerRepo = repository(auth)
    const response = await integrationFetch(
      `${GITHUB_API}/repos/${ownerRepo}/issues/comments/${numericId(commentId, 'comment id')}`,
      { method: 'PATCH', headers: githubHeaders(auth.accessToken), body: JSON.stringify({ body }) },
      { settled: [404] }
    )
    // Deleted on GitHub: there is nothing left to rewrite.
    if (response.status === 404) return null
    if (!response.ok) throw await rejected(response, ownerRepo)
    return commentRef(response)
  },

  async delete({ auth, commentId }) {
    const ownerRepo = repository(auth)
    const response = await integrationFetch(
      `${GITHUB_API}/repos/${ownerRepo}/issues/comments/${numericId(commentId, 'comment id')}`,
      { method: 'DELETE', headers: githubHeaders(auth.accessToken) },
      { settled: [404] }
    )
    // Already gone on GitHub: what the delete asked for.
    if (response.ok || response.status === 404) return
    throw await rejected(response, ownerRepo)
  },

  async list({ auth, issueId, since, limit }) {
    const ownerRepo = repository(auth)
    const comments: RemoteIssueComment[] = []
    const perPage = 100
    for (let page = 1; comments.length < limit; page++) {
      const query = new URLSearchParams({ since, per_page: String(perPage), page: String(page) })
      const response = await integrationFetch(
        `${GITHUB_API}/repos/${ownerRepo}/issues/${numericId(issueId, 'issue number')}/comments?${query}`,
        { headers: githubHeaders(auth.accessToken) }
      )
      if (!response.ok) throw await rejected(response, ownerRepo)
      const batch = (await response.json()) as GitHubIssueCommentPayload[]
      for (const raw of batch) {
        const comment = githubRemoteComment(raw, auth)
        if (comment && comments.length < limit) comments.push(comment)
      }
      if (batch.length < perPage) break
    }
    return comments
  },
}
