/**
 * Azure DevOps issue-tracker capability: manual ref parsing for ticket
 * linking. The externalId namespace is the numeric work item id — matching
 * what `azureDevOpsInboundHandler.parseStatusChange` emits for reverse
 * lookup. URL-only on purpose: a bare number is ambiguous across projects,
 * and unlike GitHub there is no compact owner/repo#n shorthand convention.
 */
import type { IssueTrackerCapability, ParsedIssueRef } from '../types'

// A work item URL on dev.azure.com or a visualstudio.com legacy host, e.g.
// https://dev.azure.com/org/project/_workitems/edit/123
const WORK_ITEM_URL_RE = /^https?:\/\/[^/\s]+\/[^\s]*_workitems\/edit\/(\d+)\/?(?:[?#].*)?$/i

export const azureDevOpsIssues: IssueTrackerCapability = {
  parseRef(input: string): ParsedIssueRef | null {
    const trimmed = input.trim()
    const m = WORK_ITEM_URL_RE.exec(trimmed)
    if (!m) return null
    const id = Number.parseInt(m[1], 10)
    if (!Number.isSafeInteger(id) || id <= 0) return null
    return { externalId: String(id), externalDisplayId: `#${id}`, externalUrl: trimmed }
  },
}
