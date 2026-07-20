// @vitest-environment happy-dom
/**
 * Portal support index — the convergence Phase 2 TWO-SPACE nav (Messages +
 * Tickets, scratchpad/convergence-design.md "Portal keeps two spaces";
 * convergence-ui-spec §8). With both support surfaces enabled the page tabs
 * between the Messages space (the conversation list — a pair lists here
 * natively, badge off the shared watermark) and the Tickets space (the
 * default); a tickets-only workspace keeps the standalone Tickets surface
 * with no tab bar; an inbox-only workspace keeps the conversations list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const routeCtx = vi.hoisted(() => ({
  session: { user: { principalType: 'user' } } as null | { user: { principalType: string } },
  settings: {
    featureFlags: { supportTickets: true, supportInbox: true },
    portalConfig: { support: { enabled: true } },
  },
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <T extends object>(options: T) => ({ ...options }),
  useRouteContext: () => routeCtx,
  Navigate: () => null,
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => null,
}))

// The Tickets surface is stubbed — the tab routing is under test here, not
// the list itself (portal-tickets-list has its own coverage).
vi.mock('@/components/portal/portal-tickets-list', () => ({
  PortalTicketsList: () => <div data-testid="tickets-surface" />,
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

beforeEach(() => {
  routeCtx.session = { user: { principalType: 'user' } }
  routeCtx.settings = {
    featureFlags: { supportTickets: true, supportInbox: true },
    portalConfig: { support: { enabled: true } },
  }
  getMyConversationsFn.mockReset()
  getMyConversationsFn.mockResolvedValue({ conversations: [] })
})

afterEach(cleanup)

describe('portal support index — two-space nav', () => {
  it('both surfaces on: tab bar shows, Tickets is the default space, Messages tabs in', async () => {
    render(<Page />, { wrapper: wrapper() })

    // Default space is Tickets (today's default surface is preserved).
    expect(screen.getByTestId('tickets-surface')).toBeTruthy()
    const messagesTab = screen.getByRole('tab', { name: 'Messages' })
    const ticketsTab = screen.getByRole('tab', { name: 'Tickets' })
    expect(ticketsTab.getAttribute('aria-selected')).toBe('true')
    expect(messagesTab.getAttribute('aria-selected')).toBe('false')
    // The Messages space's query stays idle until the tab is opened.
    expect(getMyConversationsFn).not.toHaveBeenCalled()

    fireEvent.click(messagesTab)
    expect(screen.queryByTestId('tickets-surface')).toBeNull()
    expect(messagesTab.getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText('No conversations yet')).toBeTruthy()
    expect(getMyConversationsFn).toHaveBeenCalled()
  })

  it('tickets-only workspace: the standalone Tickets surface, no tab bar', () => {
    routeCtx.settings = {
      featureFlags: { supportTickets: true, supportInbox: false },
      portalConfig: { support: { enabled: true } },
    }
    render(<Page />, { wrapper: wrapper() })

    expect(screen.getByTestId('tickets-surface')).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('inbox-only workspace: the conversations list, no tab bar', async () => {
    routeCtx.settings = {
      featureFlags: { supportTickets: false, supportInbox: true },
      portalConfig: { support: { enabled: true } },
    }
    render(<Page />, { wrapper: wrapper() })

    expect(screen.queryByTestId('tickets-surface')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(await screen.findByText('No conversations yet')).toBeTruthy()
  })
})
