import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Jira issue-tracker capability: manual ref parsing for ticket linking.
 * The externalId namespace is the issue KEY (e.g. "PROJ-42") — matching what
 * `jiraInboundHandler.parseStatusChange` emits (`payload.issue.key`) for
 * reverse lookup.
 */
import type { IssueTrackerCapability, ParsedIssueRef } from '@/lib/server/integrations/types'
import { issueError } from '@/lib/server/integrations/message-utils'
import { ValidationError } from '@/lib/shared/errors'

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

export interface JiraIssueStatus {
  /** The current key, which differs from the requested one after a project move. */
  key?: string
  status?: string
  projectId?: string
  projectKey?: string
  /** Jira's own format, e.g. `2026-11-24T13:07:35.977+0000`. */
  updated?: string
}

function jiraFailure(status: number, detail: string): Error {
  if (status === 401) {
    return issueError('Authentication failed. Please reconnect Jira.', {
      status,
      retryable: false,
    })
  }
  if (status === 429) return issueError('Rate limited by Jira API.', { status, retryable: true })
  return issueError(`HTTP ${status}: ${detail}`, { status })
}

/**
 * Read an issue's current status and project from the connected site.
 * Returns null on 404, which Jira also sends when the token cannot see the issue.
 */
export async function getJiraIssueStatus(
  accessToken: string,
  cloudId: string,
  issueIdOrKey: string
): Promise<JiraIssueStatus | null> {
  const response = await integrationFetch(
    `https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}?fields=status,project,updated`,
    {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    }
  )
  if (response.status === 404) return null
  if (!response.ok) throw jiraFailure(response.status, await response.text())

  const data = (await response.json()) as {
    key?: unknown
    fields?: {
      status?: { name?: unknown }
      project?: { id?: unknown; key?: unknown }
      updated?: unknown
    }
  }
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
  return {
    key: text(data.key),
    status: text(data.fields?.status?.name),
    projectId: text(data.fields?.project?.id),
    projectKey: text(data.fields?.project?.key),
    updated: text(data.fields?.updated),
  }
}

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

    const response = await integrationFetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`,
      {
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
      }
    )

    if (!response.ok) throw jiraFailure(response.status, await response.text())

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
