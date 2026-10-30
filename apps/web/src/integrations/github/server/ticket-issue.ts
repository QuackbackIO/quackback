/**
 * A ticket as a new GitHub issue, for a teammate's "Create issue" and for a
 * repository that opens an issue for each ticket it matches alike.
 *
 * The body is the ticket's first customer-visible message, the files on its
 * customer-visible messages (images shown inline, anything else linked), and
 * a footer with its status, priority and a "View in Quackback" link. Internal
 * notes and their files never reach it, and neither does the requester's
 * name or email: the issue may be public. A hidden marker names the ticket
 * and the connection, so an issue of ours is recognisable when it comes back
 * through a webhook (the inbox never opens a conversation for it).
 */
import type { TicketIssueContent, TicketIssueSource } from '@/lib/server/integrations/types'
import { absolutizeMarkdownUrls } from '@/lib/server/integrations/post-content'
import { getBaseUrl } from '@/lib/server/config'

/** GitHub refuses an issue body over 65,536 characters; stay clear of it. */
export const GITHUB_ISSUE_BODY_LIMIT = 65_000

/** The attachments section gets at most this share of the body; the narrative keeps the rest. */
const ATTACHMENTS_LIMIT = 16_000

export function ticketIssueMarker(ticketId: string, integrationId: string): string {
  return `<!-- quackback:ticket-issue ticketId=${ticketId} integrationId=${integrationId} -->`
}

function absoluteUrl(url: string, rootUrl: string): string {
  try {
    return new URL(url, `${rootUrl.replace(/\/$/, '')}/`).toString()
  } catch {
    return url
  }
}

/** A file name that cannot break out of Markdown link text. */
function linkText(name: string): string {
  return name.replace(/[[\]\r\n]/g, ' ').trim() || 'file'
}

/**
 * An `### Attachments` section for these files, images shown inline and
 * anything else linked, within `limit` characters (the rest counted as "more
 * in Quackback"). Empty when there are none.
 */
export function attachmentsSection(
  attachments: TicketIssueSource['attachments'],
  rootUrl: string,
  limit: number = ATTACHMENTS_LIMIT
): string {
  if (attachments.length === 0) return ''
  const lines: string[] = []
  let length = 0
  for (const [index, file] of attachments.entries()) {
    const url = absoluteUrl(file.url, rootUrl)
    const name = linkText(file.name)
    const line = file.contentType.startsWith('image/') ? `![${name}](${url})` : `[${name}](${url})`
    if (length + line.length + 1 > limit) {
      lines.push(`_${attachments.length - index} more in Quackback_`)
      break
    }
    lines.push(line)
    length += line.length + 1
  }
  return ['### Attachments', '', ...lines].join('\n')
}

function priorityName(priority: TicketIssueSource['priority']): string {
  return priority === 'none' ? 'None' : priority.charAt(0).toUpperCase() + priority.slice(1)
}

/** Cut Markdown to `max` characters without leaving half an image or link behind. */
export function cutMarkdown(markdown: string, max: number): string {
  if (markdown.length <= max) return markdown
  let end = Math.max(0, max - 3)
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\([^)]*\)/g)) {
    if (match.index < end && match.index + match[0].length > end) {
      end = match.index
      break
    }
  }
  return `${markdown.slice(0, end).trimEnd()}...`
}

/** The GitHub issue a ticket becomes: its title, the body above, and its labels. */
export function buildGitHubTicketIssue(
  ticket: TicketIssueSource,
  context: { integrationId: string },
  rootUrl: string = getBaseUrl()
): TicketIssueContent {
  const attachments = attachmentsSection(ticket.attachments, rootUrl)
  const footer = [
    '---',
    '',
    `**Ticket:** #${ticket.number}`,
    `**Status:** ${ticket.status ?? 'Unknown'}`,
    `**Priority:** ${priorityName(ticket.priority)}`,
    '',
    `[View in Quackback](${ticket.url})`,
    '',
    ticketIssueMarker(ticket.ticketId, context.integrationId),
  ].join('\n')
  const fixed = [attachments, footer].filter(Boolean).join('\n\n')
  // What the narrative may take: the limit less the fixed parts and the blank lines between.
  const room = GITHUB_ISSUE_BODY_LIMIT - fixed.length - 2
  const narrative = cutMarkdown(
    absolutizeMarkdownUrls(ticket.narrative.trim(), rootUrl, false),
    room
  )
  const labels = [
    ...(ticket.priority === 'none' ? [] : [`priority:${ticket.priority}`]),
    ...(ticket.channel ? [`channel:${ticket.channel}`] : []),
  ]
  return {
    title: ticket.title,
    bodyMarkdown: [narrative, fixed].filter(Boolean).join('\n\n'),
    labels,
  }
}
