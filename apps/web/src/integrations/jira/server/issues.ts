/**
 * Jira issue-tracker capability: manual ref parsing for ticket linking.
 * The externalId namespace is the issue KEY (e.g. "PROJ-42") — matching what
 * `jiraInboundHandler.parseStatusChange` emits (`payload.issue.key`) for
 * reverse lookup.
 */
import type { IssueTrackerCapability, ParsedIssueRef } from '@/lib/server/integrations/types'
import { issueError } from '@/lib/server/integrations/message-utils'
import { ValidationError } from '@/lib/shared/errors'
import { getJiraAccessToken } from '@/integrations/jira/server/token'

/** Markdown → minimal ADF: one paragraph per blank-line-separated block.
 *  Deliberately lossy (markdown syntax renders literally) — converting GFM to
 *  full ADF is a project of its own; the jira HOOK keeps its richer
 *  event-specific ADF construction and does not route through here. */
function markdownToAdf(markdown: string): Record<string, unknown> {
  const blocks = markdown.split(/\n{2,}/).filter((b) => b.trim().length > 0)
  const content = (blocks.length > 0 ? blocks : ['']).map((block) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: block }],
  }))
  return { version: 1, type: 'doc', content }
}

// A browse URL on any Jira site (cloud or server) or the bare KEY-123
// shorthand. Keys are uppercased for storage — Jira keys are canonically
// uppercase and the inbound payload always reports them that way.
const BROWSE_URL_RE = /^https?:\/\/([^/\s]+)\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)\/?(?:[?#].*)?$/
const KEY_RE = /^([A-Za-z][A-Za-z0-9_]*-\d+)$/

export const jiraIssues: IssueTrackerCapability = {
  parseRef(input: string, config: Record<string, unknown>): ParsedIssueRef | null {
    const trimmed = input.trim()
    const urlMatch = BROWSE_URL_RE.exec(trimmed)
    if (urlMatch) {
      // Pin the connected site when known: inbound reverse-lookup is by bare
      // issue key, so a foreign site's PROJ-42 would collide with the real one.
      const configuredHost =
        typeof config.siteUrl === 'string' ? new URL(config.siteUrl).host.toLowerCase() : null
      if (configuredHost && urlMatch[1].toLowerCase() !== configuredHost) {
        throw new ValidationError(
          'SITE_MISMATCH',
          `Issue must belong to the connected Jira site (${configuredHost})`
        )
      }
      const key = urlMatch[2].toUpperCase()
      return { externalId: key, externalDisplayId: key, externalUrl: trimmed }
    }
    const keyMatch = KEY_RE.exec(trimmed)
    if (!keyMatch) return null
    const key = keyMatch[1].toUpperCase()
    // Best-effort URL from the connected site when configured; the link is
    // still fully functional (inbound sync keys on externalId) without one.
    const siteUrl = typeof config.siteUrl === 'string' ? config.siteUrl.replace(/\/$/, '') : null
    return {
      externalId: key,
      externalDisplayId: key,
      externalUrl: siteUrl ? `${siteUrl}/browse/${key}` : null,
    }
  },

  // The stored token expires ~hourly; refresh (and persist) before use.
  async prepareAuth(integration) {
    const accessToken = await getJiraAccessToken(integration)
    return { ...((integration.config ?? {}) as Record<string, unknown>), accessToken }
  },

  async create({ auth, title, bodyMarkdown }): Promise<ParsedIssueRef> {
    // The config UI stores the connected project as the composite
    // channelId "projectId:issueTypeId" (see jira-config.tsx); a legacy
    // single-value channelId has no issue type and lets Jira pick a default.
    if (typeof auth.channelId !== 'string' || auth.channelId.length === 0) {
      throw issueError('No Jira project configured', { retryable: false })
    }
    const [projectId, channelIssueTypeId] = auth.channelId.split(':')
    const cloudId = auth.cloudId as string
    const accessToken = auth.accessToken as string
    const siteUrl = typeof auth.siteUrl === 'string' ? auth.siteUrl.replace(/\/$/, '') : null
    const issueTypeId =
      channelIssueTypeId ?? (typeof auth.issueTypeId === 'string' ? auth.issueTypeId : undefined)

    const response = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        fields: {
          project: { id: projectId },
          summary: title,
          description: markdownToAdf(bodyMarkdown),
          ...(issueTypeId ? { issuetype: { id: issueTypeId } } : {}),
        },
      }),
    })

    if (!response.ok) {
      const status = response.status
      if (status === 401) {
        throw issueError('Authentication failed. Please reconnect Jira.', {
          status,
          retryable: false,
        })
      }
      if (status === 429) {
        throw issueError('Rate limited by Jira API.', { status, retryable: true })
      }
      throw issueError(`HTTP ${status}: ${await response.text()}`, { status })
    }

    const result = (await response.json()) as { key?: string }
    if (!result.key) {
      throw issueError('No issue key returned', { retryable: false })
    }
    return {
      externalId: result.key,
      externalDisplayId: result.key,
      externalUrl: siteUrl ? `${siteUrl}/browse/${result.key}` : null,
    }
  },
}
