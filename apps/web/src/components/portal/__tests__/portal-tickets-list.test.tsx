// @vitest-environment happy-dom
/**
 * Portal Tickets list — convergence Phase 2: each row carries the requester's
 * unread badge computed server-side from the pair's SHARED watermark (the
 * linked conversation's visitor_last_read_at via `listMyTickets`); rows with
 * nothing unread show no badge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => null,
}))
// The create dialog is out of scope here (its form/fns are their own surface).
vi.mock('@/components/portal/new-portal-ticket-dialog', () => ({
  NewPortalTicketDialog: () => null,
}))

const fns = vi.hoisted(() => ({
  listMyTicketsFn: vi.fn(),
  searchMyTicketsFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/tickets', () => fns)

import { PortalTicketsList } from '../portal-tickets-list'

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={{}}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  fns.listMyTicketsFn.mockReset()
  fns.searchMyTicketsFn.mockReset()
})

afterEach(cleanup)

describe('PortalTicketsList — unread badges (shared pair watermark)', () => {
  it('renders the badge only on rows with unread activity', async () => {
    fns.listMyTicketsFn.mockResolvedValue([
      {
        id: 'ticket_1',
        title: 'CSV export drops filter columns',
        reference: '#1042',
        updatedAt: new Date().toISOString(),
        stage: { slot: 'in_progress', label: 'In progress' },
        unreadCount: 2,
      },
      {
        id: 'ticket_2',
        title: 'Refund for May invoice',
        reference: '#1038',
        updatedAt: new Date().toISOString(),
        stage: { slot: 'received', label: 'Received' },
        unreadCount: 0,
      },
    ])
    render(<PortalTicketsList isLoggedIn />, { wrapper: wrapper() })

    const unreadRow = (await screen.findByText('CSV export drops filter columns')).closest('a')
    expect(unreadRow?.textContent).toContain('2')
    const readRow = (await screen.findByText('Refund for May invoice')).closest('a')
    // No stray badge (the only digits on the row are inside the reference).
    expect(readRow?.querySelector('.bg-primary.rounded-full')).toBeNull()
  })
})
