// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PortalTicketDetailHeader } from '../portal-ticket-detail-header'
import { PortalTicketRowItem } from '../portal-ticket-row'
import { PortalTicketStatusFilter } from '../portal-ticket-status-filter'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode
    to: string
    params?: Record<string, string>
    className?: string
  }) => <a href={`${to}:${JSON.stringify(params ?? {})}`}>{children}</a>,
  useNavigate: () => mocks.navigate,
}))

vi.mock('date-fns', () => ({
  format: () => 'Jun 20, 2026',
  formatDistanceToNow: () => '5 minutes ago',
}))

vi.mock('react-intl', () => ({
  FormattedMessage: ({ defaultMessage }: { id: string; defaultMessage: string }) => (
    <>{defaultMessage}</>
  ),
  useIntl: () => ({
    formatMessage: (descriptor: { defaultMessage: string }, values?: Record<string, string>) =>
      descriptor.defaultMessage
        .replace('{date}', values?.date ?? '')
        .replace('{when}', values?.when ?? ''),
  }),
}))

describe('portal ticket components', () => {
  it('renders detail header and list row metadata', () => {
    render(
      <>
        <PortalTicketDetailHeader
          subject="Cannot access account"
          statusName="Open"
          statusCategory="open"
          createdAt={new Date('2026-06-20T10:00:00.000Z')}
          lastActivityAt={new Date('2026-06-20T10:05:00.000Z')}
        />
        <PortalTicketRowItem
          ticket={
            {
              id: 'ticket_1',
              subject: 'Billing question',
              statusName: 'Pending',
              statusCategory: 'pending',
              lastActivityAt: new Date('2026-06-20T10:05:00.000Z'),
            } as never
          }
        />
      </>
    )

    expect(screen.getByRole('heading', { name: 'Cannot access account' })).toBeInTheDocument()
    expect(screen.getByText(/Opened Jun 20, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Last update 5 minutes ago/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Billing question/ })).toHaveAttribute(
      'href',
      expect.stringContaining('ticket_1')
    )
    expect(screen.getByText('Updated 5 minutes ago')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('navigates ticket status filters', () => {
    render(<PortalTicketStatusFilter value="pending" />)

    expect(screen.getByRole('group', { name: 'Filter tickets by status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pending' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Closed' }))
    expect(mocks.navigate).toHaveBeenCalledWith({ search: { status: 'closed' } })

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(mocks.navigate).toHaveBeenCalledWith({ search: { status: 'all' } })
  })
})
