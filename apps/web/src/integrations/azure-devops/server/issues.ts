/**
 * Azure DevOps issue-tracker capability: manual ref parsing for ticket
 * linking. The externalId namespace is the numeric work item id — matching
 * what `azureDevOpsInboundHandler.parseStatusChange` emits for reverse
 * lookup. URL-only on purpose: a bare number is ambiguous across projects,
 * and unlike GitHub there is no compact owner/repo#n shorthand convention.
 */
import type { IssueTrackerCapability, ParsedIssueRef } from '@/lib/server/integrations/types'
import { createWorkItem } from '@/integrations/azure-devops/server/api'
import { escapeHtml, issueError } from '@/lib/server/integrations/message-utils'
import { ValidationError } from '@/lib/shared/errors'

/** Markdown → minimal HTML for the work-item description field: escaped text,
 *  one <p> per blank-line-separated block, <br> within blocks. Deliberately
 *  lossy, same trade-off as the Jira capability's minimal ADF. */
function markdownToHtml(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/).filter((b) => b.trim().length > 0)
  if (blocks.length === 0) return '<p></p>'
  return blocks.map((b) => `<p>${escapeHtml(b).replaceAll('\n', '<br>')}</p>`).join('')
}

// A work item URL on dev.azure.com or a visualstudio.com legacy host, e.g.
// https://dev.azure.com/org/project/_workitems/edit/123 or
// https://org.visualstudio.com/project/_workitems/edit/123
const WORK_ITEM_URL_RE =
  /^https?:\/\/(dev\.azure\.com\/([^/\s]+)|([^/.\s]+)\.visualstudio\.com)\/[^\s]*_workitems\/edit\/(\d+)\/?(?:[?#].*)?$/i

export const azureDevOpsIssues: IssueTrackerCapability = {
  parseRef(input: string, config: Record<string, unknown>): ParsedIssueRef | null {
    const trimmed = input.trim()
    const m = WORK_ITEM_URL_RE.exec(trimmed)
    if (!m) return null
    const id = Number.parseInt(m[4], 10)
    if (!Number.isSafeInteger(id) || id <= 0) return null
    // Pin the connected organization when known: inbound reverse-lookup is by
    // bare work item id, so a foreign org's #123 would collide.
    const urlOrg = (m[2] ?? m[3])?.toLowerCase()
    const configuredOrg =
      typeof config.organizationName === 'string' ? config.organizationName.toLowerCase() : null
    if (configuredOrg && urlOrg && urlOrg !== configuredOrg) {
      throw new ValidationError(
        'ORG_MISMATCH',
        `Work item must belong to the connected organization (${configuredOrg})`
      )
    }
    return { externalId: String(id), externalDisplayId: `#${id}`, externalUrl: trimmed }
  },

  async create({ auth, title, bodyMarkdown }): Promise<ParsedIssueRef> {
    const channelId = auth.channelId as string
    const pat = auth.accessToken as string
    const organizationName = auth.organizationName as string
    const [project, workItemType] = channelId.split(':')
    if (!project || !workItemType) {
      throw issueError('Invalid configuration: missing project or work item type', {
        retryable: false,
      })
    }

    try {
      const result = await createWorkItem(pat, organizationName, project, workItemType, {
        title,
        description: markdownToHtml(bodyMarkdown),
      })
      return {
        externalId: String(result.id),
        externalDisplayId: `#${result.id}`,
        externalUrl: result.url,
      }
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status === 401 || status === 403) {
        throw issueError('Authentication failed. Please reconnect Azure DevOps.', {
          status,
          retryable: false,
        })
      }
      throw error
    }
  },
}
