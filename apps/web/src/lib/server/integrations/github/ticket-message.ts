/**
 * GitHub issue formatting utilities for ticket events.
 */

import type { EventData, EventTicketRef } from '../../events/types'
import { truncate } from '../../events/hook-utils'

/**
 * Build a GitHub issue title and body from a ticket event.
 */
export function buildTicketIssueBody(event: EventData): {
  title: string
  body: string
  labels: string[]
} {
  if (event.type !== 'ticket.created') {
    return { title: 'Ticket', body: '', labels: [] }
  }

  const { ticket } = event.data
  const title = ticket.subject || 'Untitled ticket'
  const body = formatTicketBody(ticket)
  const labels = buildTicketLabels(ticket)

  return { title, body, labels }
}

function formatTicketBody(ticket: EventTicketRef): string {
  const sections: string[] = []

  const description = ticket.descriptionText?.trim()
  if (description) {
    sections.push(description)
  }

  const meta: string[] = []
  if (ticket.statusName) {
    meta.push(`**Status:** ${ticket.statusName}`)
  }
  if (ticket.requesterName || ticket.requesterEmail) {
    const requester = ticket.requesterName || ticket.requesterEmail
    meta.push(`**Requester:** ${requester}`)
  }
  if (ticket.organizationName) {
    meta.push(`**Organization:** ${ticket.organizationName}`)
  }
  if (ticket.inboxName) {
    meta.push(`**Inbox:** ${ticket.inboxName}`)
  }

  if (meta.length > 0 || ticket.ticketUrl) {
    if (sections.length > 0) {
      sections.push('')
      sections.push('---')
      sections.push('')
    }

    sections.push(...meta)

    if (ticket.ticketUrl) {
      if (meta.length > 0) {
        sections.push('')
      }
      sections.push(`[View in Quackback](${ticket.ticketUrl})`)
    }
  }

  return truncate(sections.join('\n'), 65000)
}

function buildTicketLabels(ticket: EventTicketRef): string[] {
  const labels: string[] = []
  if (ticket.priority) {
    labels.push(`priority:${ticket.priority}`)
  }
  if (ticket.channel) {
    labels.push(`channel:${ticket.channel}`)
  }
  return labels
}

/**
 * Build an updated issue body for ticket.updated events.
 * Only called when subject or description changed.
 */
export function buildTicketUpdateBody(ticket: EventTicketRef): {
  title?: string
  body?: string
} {
  return {
    title: ticket.subject || undefined,
    body: formatTicketBody(ticket),
  }
}
