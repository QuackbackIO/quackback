// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const authState = vi.hoisted(() => ({ isIdentified: true, sessionVersion: 0 }))
vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => authState,
}))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))

const fns = vi.hoisted(() => ({
  listMyWidgetTicketsFn: vi.fn(),
  getMyWidgetTicketFn: vi.fn(),
  getMyWidgetTicketThreadFn: vi.fn(),
  getWidgetTicketFormFn: vi.fn(),
  replyToMyWidgetTicketFn: vi.fn(),
  markMyWidgetTicketReadFn: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/server/functions/widget-tickets', () => fns)

// tiptap is heavy in happy-dom; the list view under test does not use it, and the
// detail view only needs a stub composer.
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => null,
  RichTextContent: ({ content }: { content: unknown }) => <div>{JSON.stringify(content)}</div>,
}))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useWidgetImageUpload: () => ({ upload: vi.fn() }),
}))

import { WidgetTickets } from '../widget-tickets'
import { WidgetTicketDetail } from '../widget-ticket-detail'

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
  authState.isIdentified = true
  authState.sessionVersion = 0
  fns.listMyWidgetTicketsFn.mockReset()
  fns.getMyWidgetTicketFn.mockReset()
  fns.getMyWidgetTicketThreadFn.mockReset()
  fns.markMyWidgetTicketReadFn.mockClear()
  fns.markMyWidgetTicketReadFn.mockResolvedValue({ ok: true })
})

describe('WidgetTickets — list tiers', () => {
  it('an identified visitor sees rows and the pill opens the new-ticket view', async () => {
    fns.listMyWidgetTicketsFn.mockResolvedValue([
      {
        id: 'ticket_1',
        title: 'Broken thing',
        reference: '#12',
        updatedAt: new Date().toISOString(),
        stage: { slot: 'received', label: 'Received' },
      },
    ])
    const onOpenTicket = vi.fn()
    render(<WidgetTickets onOpenTicket={onOpenTicket} />, { wrapper: wrapper() })

    expect(await screen.findByText('Broken thing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /new ticket/i }))
    expect(onOpenTicket).toHaveBeenCalledWith('new')
  })

  it('an anonymous visitor with no captured email gets the choice state (no rows)', async () => {
    authState.isIdentified = false
    fns.listMyWidgetTicketsFn.mockRejectedValue(new Error('EMAIL_REQUIRED'))
    const onOpenTicket = vi.fn()
    render(<WidgetTickets onOpenTicket={onOpenTicket} />, { wrapper: wrapper() })

    const cta = await screen.findByRole('button', { name: /continue with email/i })
    fireEvent.click(cta)
    expect(onOpenTicket).toHaveBeenCalledWith('new')
  })

  it('renders the unread badge from the shared pair watermark; plain rows show none', async () => {
    fns.listMyWidgetTicketsFn.mockResolvedValue([
      {
        id: 'ticket_1',
        title: 'Broken thing',
        reference: '#12',
        updatedAt: new Date().toISOString(),
        stage: { slot: 'received', label: 'Received' },
        unreadCount: 3,
      },
      {
        id: 'ticket_2',
        title: 'Quiet thing',
        reference: '#13',
        updatedAt: new Date().toISOString(),
        stage: { slot: 'resolved', label: 'Resolved' },
        unreadCount: 0,
      },
    ])
    render(<WidgetTickets onOpenTicket={vi.fn()} />, { wrapper: wrapper() })

    const row = (await screen.findByText('Broken thing')).closest('button')
    expect(row?.textContent).toContain('3')
    const quietRow = (await screen.findByText('Quiet thing')).closest('button')
    expect(quietRow?.textContent).not.toContain('0')
  })
})

describe('WidgetTicketDetail — thread', () => {
  it('renders the visitor message on the right (self) and the team message on the left (peer)', async () => {
    fns.getMyWidgetTicketFn.mockResolvedValue({
      id: 'ticket_1',
      title: 'Broken thing',
      reference: '#12',
      stage: { slot: 'in_progress', label: 'In progress' },
    })
    fns.getMyWidgetTicketThreadFn.mockResolvedValue({
      messages: [
        {
          id: 'm1',
          content: 'It broke',
          contentJson: null,
          senderType: 'visitor',
          author: null,
          isAssistant: false,
          attachments: [],
          citations: [],
          createdAt: new Date().toISOString(),
        },
        {
          id: 'm2',
          content: 'On it',
          contentJson: null,
          senderType: 'agent',
          author: { displayName: 'Sam' },
          isAssistant: false,
          attachments: [],
          citations: [],
          createdAt: new Date().toISOString(),
        },
      ],
    })
    render(<WidgetTicketDetail ticketId={'ticket_1' as never} />, { wrapper: wrapper() })

    const visitorMsg = await screen.findByText('It broke')
    const teamMsg = await screen.findByText('On it')
    // Self bubbles align to the end; peer bubbles to the start.
    expect(visitorMsg.closest('.items-end')).toBeTruthy()
    expect(teamMsg.closest('.items-start')).toBeTruthy()
  })

  it('marks the pair read once the thread loads (read-through to the shared watermark)', async () => {
    fns.getMyWidgetTicketFn.mockResolvedValue({
      id: 'ticket_1',
      title: 'Broken thing',
      reference: '#12',
      stage: { slot: 'in_progress', label: 'In progress' },
    })
    fns.getMyWidgetTicketThreadFn.mockResolvedValue({
      messages: [
        {
          id: 'm1',
          content: 'On it',
          contentJson: null,
          senderType: 'agent',
          author: { displayName: 'Sam' },
          isAssistant: false,
          attachments: [],
          citations: [],
          createdAt: new Date().toISOString(),
        },
      ],
    })
    render(<WidgetTicketDetail ticketId={'ticket_1' as never} />, { wrapper: wrapper() })

    await screen.findByText('On it')
    await waitFor(() =>
      expect(fns.markMyWidgetTicketReadFn).toHaveBeenCalledWith(
        expect.objectContaining({ data: { ticketId: 'ticket_1' } })
      )
    )
  })

  it('a union thread with conversation messages is NOT the "No replies yet" empty state', async () => {
    fns.getMyWidgetTicketFn.mockResolvedValue({
      id: 'ticket_1',
      title: 'Backed ticket',
      reference: '#14',
      stage: { slot: 'received', label: 'Received' },
    })
    // A backed ticket's thread rows arrive conversation-parented (Phase 0
    // union); the empty state must not show.
    fns.getMyWidgetTicketThreadFn.mockResolvedValue({
      messages: [
        {
          id: 'm1',
          content: 'Thanks! Tracking this as a ticket now',
          contentJson: null,
          senderType: 'agent',
          author: { displayName: 'Sam' },
          isAssistant: false,
          attachments: [],
          citations: [],
          conversationId: 'conversation_1',
          ticketId: null,
          createdAt: new Date().toISOString(),
        },
      ],
    })
    render(<WidgetTicketDetail ticketId={'ticket_1' as never} />, { wrapper: wrapper() })

    expect(await screen.findByText('Thanks! Tracking this as a ticket now')).toBeTruthy()
    expect(screen.queryByText(/no replies yet/i)).toBeNull()
  })
})
