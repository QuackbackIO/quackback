// @vitest-environment happy-dom
/**
 * The detail panel's First response row shows on a customer ticket only:
 * back-office and tracker tickets have no customer, so they never get one.
 */
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { TicketId, TicketTypeId } from '@quackback/ids'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import { ticketKeys } from '@/lib/client/queries/inbox'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'

vi.mock('@/components/admin/inbox/ticket-chips', () => ({
  TicketTypeBadge: () => null,
  TicketStageChip: () => null,
}))
vi.mock('@/components/admin/inbox/ticket-controls', () => ({
  TicketStatusControl: () => null,
  TicketAssigneeControl: () => null,
  TicketPriorityControl: () => null,
  TicketWatchControl: () => null,
}))
vi.mock('@/components/admin/inbox/ticket-links', () => ({ TicketLinks: () => null }))
vi.mock('@/components/admin/conversation/company-card', () => ({ CompanyCard: () => null }))
vi.mock('@/components/admin/users/block-person-control', () => ({
  usePersonBlockStatus: () => ({ blocked: false, isLoading: false }),
}))
vi.mock('@/lib/server/functions/conversation', () => ({
  listConversationsForUserFn: vi.fn().mockResolvedValue({ conversations: [], hasMore: false }),
  getConversationAssistantActivityFn: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/server/functions/admin', () => ({
  getPortalUserFn: vi.fn().mockResolvedValue(null),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useRouteContext: (opts?: { select?: (context: object) => unknown }) =>
    opts?.select ? opts.select({}) : {},
}))

import { InboxDetailPanel } from '../inbox-detail-panel'

const TYPE_ID = 'ticket_type_1' as TicketTypeId

const ticket = {
  id: 'ticket_1' as TicketId,
  number: 142,
  reference: '#142',
  type: 'customer',
  ticketType: {
    id: TYPE_ID,
    name: 'Bug',
    slug: 'bug',
    category: 'customer',
    icon: null,
    color: '#888',
  },
  title: 'Cannot log in',
  status: { id: 'ticket_status_1', name: 'Open', color: '#10b981', category: 'open' },
  stage: { slot: 'received', label: 'Received' },
  priority: 'high',
  requester: null,
  assignee: { principalId: null, displayName: null, teamId: null, teamName: null },
  company: null,
  firstResponseAt: null,
  dueAt: null,
  resolvedAt: null,
  sla: null,
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
  reopenedCount: 0,
  customAttributes: {},
  lastMessagePreview: null,
  lastMessageAt: null,
} as unknown as TicketDTO

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
})

function renderPanel(type: 'customer' | 'back_office' | 'tracker') {
  setRuntimeLocale('en-US', 'UTC')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(ticketKeys.types(), [{ id: TYPE_ID, fields: [] }])
  render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={client}>
        <InboxDetailPanel
          item={{ kind: 'ticket', id: ticket.id }}
          ticket={{ ...ticket, type } as TicketDTO}
          onChanged={() => {}}
          onSelectItem={() => {}}
          onTrackAsFeedback={() => {}}
          onCreateTicket={() => {}}
          onInsertFromCopilot={() => {}}
          visible
        />
      </QueryClientProvider>
    </IntlProvider>
  )
}

describe('InboxDetailPanel first response row', () => {
  it('shows on a customer ticket', () => {
    renderPanel('customer')
    expect(screen.getByText('First response')).toBeTruthy()
    expect(screen.getByText('Opened')).toBeTruthy()
  })

  it.each(['back_office', 'tracker'] as const)('is hidden on a %s ticket', (type) => {
    renderPanel(type)
    expect(screen.queryByText('First response')).toBeNull()
    // The rows around it stay.
    expect(screen.getByText('Opened')).toBeTruthy()
  })
})
