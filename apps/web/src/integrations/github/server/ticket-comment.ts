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
 */
import type { IssueCommentCapability, TicketReplySource } from '@/lib/server/integrations/types'
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

function githubHeaders(accessToken: unknown): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'quackback',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** A repository name the API path may carry. */
function repository(auth: Record<string, unknown>): string {
  const ownerRepo = auth.channelId
  if (typeof ownerRepo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(ownerRepo))
    throw issueError('No repository configured', { retryable: false })
  return ownerRepo
}

/** A numeric id the API path may carry. */
function numericId(value: string, what: string): string {
  if (!/^\d+$/.test(value)) throw issueError(`Invalid ${what}`, { retryable: false })
  return value
}

/** A rejected request as an `issueError` with its status, which the ledger classifies. */
async function rejected(response: Response, ownerRepo: string): Promise<Error> {
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
}
