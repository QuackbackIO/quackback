import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * GitHub issue-tracker capability: manual ref parsing for ticket linking.
 * The externalId namespace is the bare issue number — matching what
 * `githubInboundHandler.parseStatusChange` emits for reverse lookup.
 */
import type { IssueTrackerCapability, ParsedIssueRef } from '@/lib/server/integrations/types'
import { issueError } from '@/lib/server/integrations/message-utils'
import { ValidationError } from '@/lib/shared/errors'
import { buildGitHubTicketIssue } from '@/integrations/github/server/ticket-issue'
import { githubIssueComments } from '@/integrations/github/server/ticket-comment'

const GITHUB_API = 'https://api.github.com'

// A full issue URL (query/hash/trailing-slash tolerated) or the
// owner/repo#number shorthand. Owner/repo segments follow GitHub's charset.
const ISSUE_URL_RE =
  /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/
const ISSUE_SHORTHAND_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/

export const githubIssues: IssueTrackerCapability = {
  async inspect({ auth, reference }) {
    const parsed = /^\d+$/.test(reference)
      ? { externalId: reference }
      : githubIssues.parseRef!(reference, auth)
    if (!parsed || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(auth.channelId)))
      throw new Error('Use a GitHub issue URL or number from this repository')
    const response = await integrationFetch(
      `${GITHUB_API}/repos/${auth.channelId}/issues/${parsed.externalId}`,
      {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'quackback',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    )
    if (!response.ok)
      throw issueError('Issue is unavailable in this destination', { status: response.status })
    const issue = (await response.json()) as {
      number: number
      title: string
      body: string | null
      html_url: string
      updated_at: string
      pull_request?: unknown
    }
    if (issue.pull_request || String(issue.number) !== parsed.externalId)
      throw new Error('Expected an issue')
    return {
      externalId: String(issue.number),
      externalDisplayId: `${auth.channelId}#${issue.number}`,
      externalUrl: issue.html_url,
      title: issue.title,
      content: issue.body ?? '',
      version: issue.updated_at,
    }
  },
  parseRef(input, config, destinations): ParsedIssueRef | null {
    const trimmed = input.trim()
    const m = ISSUE_URL_RE.exec(trimmed) ?? ISSUE_SHORTHAND_RE.exec(trimmed)
    if (!m) return null
    const number = Number.parseInt(m[3], 10)
    if (!Number.isSafeInteger(number) || number <= 0) return null

    // Inbound webhooks reverse-look-up by bare issue number within a
    // repository, so a reference must belong to a repository this connection
    // syncs: one of its configured repositories when it has several, else the
    // "owner/repo" in channelId (see GitHubTarget in hook.ts), enforced only
    // when it has that shape.
    const issueRepo = `${m[1]}/${m[2]}`
    let destinationId: string | undefined
    if (destinations?.length) {
      const match = destinations.find((d) => d.externalId.toLowerCase() === issueRepo.toLowerCase())
      if (!match) {
        throw new ValidationError(
          'REPO_MISMATCH',
          `Issue must belong to a connected repository (${destinations.map((d) => d.externalId).join(', ')})`
        )
      }
      destinationId = match.id
    } else {
      const configuredRepo =
        typeof config.channelId === 'string' && config.channelId.includes('/')
          ? config.channelId
          : null
      if (configuredRepo && configuredRepo.toLowerCase() !== issueRepo.toLowerCase()) {
        throw new ValidationError(
          'REPO_MISMATCH',
          `Issue must belong to the connected repository (${configuredRepo})`
        )
      }
    }

    return {
      externalId: String(number),
      externalDisplayId: `${issueRepo}#${number}`,
      externalUrl: `https://github.com/${issueRepo}/issues/${number}`,
      ...(destinationId ? { destinationId } : {}),
    }
  },

  formatTicketIssue: buildGitHubTicketIssue,

  comments: githubIssueComments,

  async create({ auth, title, bodyMarkdown, labels }): Promise<ParsedIssueRef> {
    const ownerRepo = auth.channelId as string
    const accessToken = auth.accessToken as string

    const response = await integrationFetch(`${GITHUB_API}/repos/${ownerRepo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'quackback',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      // GitHub adds a label the repository does not have yet, and drops the
      // labels a token without push access may not set instead of refusing.
      body: JSON.stringify({ title, body: bodyMarkdown, ...(labels?.length ? { labels } : {}) }),
    })

    if (!response.ok) {
      const status = response.status
      const errorBody = await response.text()
      if (status === 401) {
        throw issueError('Authentication failed. Please reconnect GitHub.', {
          retryable: false,
          status,
        })
      }
      if (status === 404) {
        throw issueError(`Repository "${ownerRepo}" not found or not accessible.`, {
          retryable: false,
          status,
        })
      }
      if (status === 422) {
        throw issueError(`Validation error: ${errorBody}`, { retryable: false, status })
      }
      if (status === 429) {
        throw issueError('Rate limited by GitHub API.', { retryable: true, status })
      }
      throw issueError(`HTTP ${status}: ${errorBody}`, { status })
    }

    const issue = (await response.json()) as { number: number; html_url: string }
    return {
      externalId: String(issue.number),
      externalDisplayId: `${ownerRepo}#${issue.number}`,
      externalUrl: issue.html_url,
    }
  },
}
