// @vitest-environment happy-dom
/**
 * Portal support index — the converged Messages surface (one list for chat-
 * and ticket-backed threads alike; the two-space Messages/Tickets nav is
 * gone). Paired rows carry their ticket's StageChip + reference and key their
 * displayed state off the TICKET stage (the pair-state rule); unpaired rows
 * keep the plain Open/Closed status. The chat-start button gates on the
 * messenger, so an email-first (tickets-only) workspace still lists threads
 * but offers no "New conversation".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const routeCtx = vi.hoisted(() => ({
  session: { user: { principalType: 'user' } } as null | { user: { principalType: string } },
  settings: {
    featureFlags: { supportTickets: true, supportInbox: true },
    portalConfig: { support: { enabled: true } },
  },
}))
const navigateSpy = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <T extends object>(options: T) => ({ ...options }),
  useRouteContext: () => routeCtx,
  Navigate: (props: { to: string }) => {
    navigateSpy(props.to)
    return null
  },
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => null,
}))

const getMyConversationsFn = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/functions/conversation', () => ({ getMyConversationsFn }))

import { Route } from '../support.index'

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

const Page = (Route as unknown as { component: React.ComponentType }).component

const NOW = new Date().toISOString()

function conversationRow(overrides: Record<string, unknown>) {
  return {
    id: 'conversation_1',
    status: 'open',
    subject: null,
    lastMessagePreview: 'hello',
    lastMessageAt: NOW,
    unreadCount: 0,
    ...overrides,
  }
}

beforeEach(() => {
  routeCtx.session = { user: { principalType: 'user' } }
  routeCtx.settings = {
    featureFlags: { supportTickets: true, supportInbox: true },
    portalConfig: { support: { enabled: true } },
  }
  navigateSpy.mockReset()
  getMyConversationsFn.mockReset()
  getMyConversationsFn.mockResolvedValue({ conversations: [], linkedTickets: {} })
})

afterEach(cleanup)

describe('portal support index — converged Messages surface', () => {
  it('renders ONE list with no space tabs; paired rows show the ticket chip + reference', async () => {
    getMyConversationsFn.mockResolvedValue({
      conversations: [
        conversationRow({ id: 'conversation_pair', subject: 'Export bug' }),
        conversationRow({ id: 'conversation_chat', subject: 'Quick question' }),
      ],
      linkedTickets: {
        conversation_pair: {
          ticketId: 'ticket_1',
          reference: '#42',
          title: 'CSV export drops filter columns',
          stage: { slot: 'in_progress', label: 'In progress', closed: false },
        },
      },
    })
    render(<Page />, { wrapper: wrapper() })

    expect(screen.queryByRole('tab')).toBeNull()
    // Paired row: ticket title wins, chip + reference decorate.
    expect(await screen.findByText('CSV export drops filter columns')).toBeTruthy()
    expect(screen.getByText('In progress')).toBeTruthy()
    expect(screen.getByText('#42')).toBeTruthy()
    // Unpaired row keeps the plain conversation status.
    expect(screen.getByText('Quick question')).toBeTruthy()
    expect(screen.getByText('Open')).toBeTruthy()
  })

  it('pair-state rule: a closed conversation with an open ticket shows the TICKET stage, never "Closed"', async () => {
    getMyConversationsFn.mockResolvedValue({
      conversations: [
        conversationRow({ id: 'conversation_pair', status: 'closed', subject: 'Pair' }),
      ],
      linkedTickets: {
        conversation_pair: {
          ticketId: 'ticket_1',
          reference: '#7',
          title: 'Still tracked',
          stage: { slot: 'in_progress', label: 'In progress', closed: false },
        },
      },
    })
    render(<Page />, { wrapper: wrapper() })

    expect(await screen.findByText('In progress')).toBeTruthy()
    expect(screen.queryByText('Closed')).toBeNull()
  })

  it('tickets-only workspace (messenger off): the list renders, the chat-start button hides', async () => {
    routeCtx.settings = {
      featureFlags: { supportTickets: true, supportInbox: false },
      portalConfig: { support: { enabled: true } },
    }
    getMyConversationsFn.mockResolvedValue({
      conversations: [conversationRow({ id: 'conversation_pair', subject: 'Ticket thread' })],
      linkedTickets: {},
    })
    render(<Page />, { wrapper: wrapper() })

    expect(await screen.findByText('Ticket thread')).toBeTruthy()
    expect(screen.queryByText('New conversation')).toBeNull()
  })

  it('messenger-only workspace: the list renders with the chat-start button', async () => {
    routeCtx.settings = {
      featureFlags: { supportTickets: false, supportInbox: true },
      portalConfig: { support: { enabled: true } },
    }
    render(<Page />, { wrapper: wrapper() })

    expect(await screen.findByText('No conversations yet')).toBeTruthy()
    expect(screen.getAllByText('New conversation').length).toBeGreaterThan(0)
  })

  it('neither surface enabled: navigates home', () => {
    routeCtx.settings = {
      featureFlags: { supportTickets: false, supportInbox: false },
      portalConfig: { support: { enabled: false } },
    }
    render(<Page />, { wrapper: wrapper() })
    expect(navigateSpy).toHaveBeenCalledWith('/')
  })
})
