/**
 * Jira issue-tracker capability: manual ref parsing for ticket linking.
 * The externalId namespace is the issue KEY (e.g. "PROJ-42") — matching what
 * `jiraInboundHandler.parseStatusChange` emits (`payload.issue.key`) for
 * reverse lookup.
 */
import type { IssueTrackerCapability, ParsedIssueRef } from '../types'

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
}
