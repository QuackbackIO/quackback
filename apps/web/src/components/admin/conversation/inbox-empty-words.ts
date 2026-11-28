/**
 * The inbox list's empty message for the open scope and triage facet, in the
 * teammate's language. Each sentence is whole per facet (a select), so a
 * language can agree the adjective with its noun.
 */
import type { IntlShape } from 'react-intl'
import type { InboxNavItem } from '@/components/admin/conversation/inbox-nav-sidebar'
import type { InboxTriageFacet } from '@/lib/shared/inbox/items'

const P = 'admin.inbox.emptyList'

const M = {
  tag: { id: `${P}.tag`, defaultMessage: 'No conversations labelled {name}' },
  segment: {
    id: `${P}.segment`,
    defaultMessage:
      '{facet, select, open {No open conversations from {name}} waiting {No waiting conversations from {name}} closed {No closed conversations from {name}} other {No conversations from {name}}}',
  },
  team: {
    id: `${P}.team`,
    defaultMessage:
      '{facet, select, open {No open conversations for {name}} waiting {No waiting conversations for {name}} closed {No closed conversations for {name}} other {No conversations for {name}}}',
  },
  custom: { id: `${P}.custom`, defaultMessage: 'No conversations match {name}' },
  mentions: { id: `${P}.mentions`, defaultMessage: 'No conversations mention you yet' },
  mine: {
    id: `${P}.mine`,
    defaultMessage:
      '{facet, select, open {No open conversations assigned to you} waiting {No waiting conversations assigned to you} closed {No closed conversations assigned to you} other {No conversations assigned to you}}',
  },
  unassigned: {
    id: `${P}.unassigned`,
    defaultMessage:
      '{facet, select, open {No open unassigned conversations} waiting {No waiting unassigned conversations} closed {No closed unassigned conversations} other {No unassigned conversations}}',
  },
  tickets: {
    id: `${P}.tickets`,
    defaultMessage:
      '{facet, select, open {No open tickets} waiting {No waiting tickets} closed {No closed tickets} other {No tickets}}',
  },
  customerTickets: {
    id: `${P}.customerTickets`,
    defaultMessage:
      '{facet, select, open {No open customer tickets} waiting {No waiting customer tickets} closed {No closed customer tickets} other {No customer tickets}}',
  },
  backOfficeTickets: {
    id: `${P}.backOfficeTickets`,
    defaultMessage:
      '{facet, select, open {No open back office tickets} waiting {No waiting back office tickets} closed {No closed back office tickets} other {No back office tickets}}',
  },
  trackers: {
    id: `${P}.trackers`,
    defaultMessage:
      '{facet, select, open {No open trackers} waiting {No waiting trackers} closed {No closed trackers} other {No trackers}}',
  },
  conversations: {
    id: `${P}.conversations`,
    defaultMessage:
      '{facet, select, open {No open conversations} waiting {No waiting conversations} closed {No closed conversations} other {No conversations}}',
  },
  firstRun: { id: 'inbox.empty.firstRun.title', defaultMessage: 'No conversations yet' },
} as const

/** The empty-list message for the active scope and facet. */
export function emptyStateMessage(
  intl: IntlShape,
  nav: InboxNavItem,
  facet: InboxTriageFacet,
  scopeLabel: string
): string {
  const values = { facet, name: scopeLabel }
  if (nav.kind === 'tag') return intl.formatMessage(M.tag, values)
  if (nav.kind === 'segment') return intl.formatMessage(M.segment, values)
  if (nav.kind === 'team') return intl.formatMessage(M.team, values)
  if (nav.kind === 'custom') return intl.formatMessage(M.custom, values)
  if (nav.kind === 'view') {
    switch (nav.view) {
      case 'mentions':
        return intl.formatMessage(M.mentions)
      case 'mine':
        return intl.formatMessage(M.mine, values)
      case 'unassigned':
        return intl.formatMessage(M.unassigned, values)
      case 'tickets_all':
        return intl.formatMessage(M.tickets, values)
      case 'tickets_customer':
        return intl.formatMessage(M.customerTickets, values)
      case 'tickets_back_office':
        return intl.formatMessage(M.backOfficeTickets, values)
      case 'tickets_tracker':
        return intl.formatMessage(M.trackers, values)
    }
    return intl.formatMessage(M.conversations, values)
  }
  // Unscoped empty inbox: first-run friendly, not filter-blame.
  if (facet === 'all') return intl.formatMessage(M.firstRun)
  return intl.formatMessage(M.conversations, values)
}
