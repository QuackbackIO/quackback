/**
 * GitHub issue-tracker capability: manual ref parsing for ticket linking.
 * The externalId namespace is the bare issue number — matching what
 * `githubInboundHandler.parseStatusChange` emits for reverse lookup.
 */
import type { IssueTrackerCapability, ParsedIssueRef } from '../types'
import { ValidationError } from '@/lib/shared/errors'

// A full issue URL (query/hash/trailing-slash tolerated) or the
// owner/repo#number shorthand. Owner/repo segments follow GitHub's charset.
const ISSUE_URL_RE =
  /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/
const ISSUE_SHORTHAND_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/

export const githubIssues: IssueTrackerCapability = {
  parseRef(input: string, config: Record<string, unknown>): ParsedIssueRef | null {
    const trimmed = input.trim()
    const m = ISSUE_URL_RE.exec(trimmed) ?? ISSUE_SHORTHAND_RE.exec(trimmed)
    if (!m) return null
    const number = Number.parseInt(m[3], 10)
    if (!Number.isSafeInteger(number) || number <= 0) return null

    // channelId holds the connected "owner/repo" (see GitHubTarget in hook.ts).
    // Only enforce when it has that shape: inbound webhooks reverse-look-up by
    // bare issue number, so a foreign repo's numbers would collide.
    const issueRepo = `${m[1]}/${m[2]}`
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

    return {
      externalId: String(number),
      externalDisplayId: `${issueRepo}#${number}`,
      externalUrl: `https://github.com/${issueRepo}/issues/${number}`,
    }
  },
}
