// @vitest-environment happy-dom
/**
 * The customer's Messages list, in the widget and on the portal Support page,
 * renders the server's order as-is and shows each row's `activityAt` (the
 * time the server sorted on). A paired conversation whose ticket was resolved
 * after its last message carries the resolve time there, while `lastMessageAt`
 * still holds the older message time, so a row that showed `lastMessageAt`
 * would disagree with its own position.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { getTimeAgo } from '@/components/ui/time-ago'

const HOUR = 60 * 60 * 1000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

/** Server order: the resolved pair first (resolved 1 hour ago, last message 5
 *  days ago), then an unpaired chat with a message 3 hours ago. */
const payload = {
  conversations: [
    {
      id: 'conversation_pair',
      status: 'closed',
      subject: 'Pair thread',
      lastMessagePreview: 'Pair preview',
      lastMessageAt: ago(5 * 24 * HOUR),
      activityAt: ago(HOUR),
      unreadCount: 0,
      assignedAgent: null,
    },
    {
      id: 'conversation_chat',
      status: 'open',
      subject: 'Chat thread',
      lastMessagePreview: 'Chat preview',
      lastMessageAt: ago(3 * HOUR),
      activityAt: ago(3 * HOUR),
      unreadCount: 0,
      assignedAgent: null,
    },
  ],
  linkedTickets: {
    conversation_pair: {
      ticketId: 'ticket_1',
      reference: '#42',
      title: 'Pair ticket',
      stage: { slot: 'resolved', label: 'Resolved', closed: true },
    },
  },
}

// Portal route dependencies.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <T extends object>(options: T) => ({ ...options }),
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const ctx = {
      session: { user: { principalType: 'user' } },
      settings: {
        featureFlags: { supportTickets: true, supportInbox: true },
        portalConfig: { support: { enabled: true } },
      },
    }
    return opts?.select ? opts.select(ctx as never) : ctx
  },
  Navigate: () => null,
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}))
vi.mock('@/components/auth/auth-popover-context', () => ({ useAuthPopoverSafe: () => null }))
vi.mock('@/lib/server/functions/conversation', () => ({
  getMyConversationsFn: () => Promise.resolve(payload),
}))

// Widget dependencies.
vi.mock('../widget-auth-provider', () => ({ useWidgetAuth: () => ({ sessionVersion: 0 }) }))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
vi.mock('@/lib/server/functions/widget/conversation', () => ({
  widgetGetMyConversationsFn: () => Promise.resolve(payload),
}))

import { Route } from '@/routes/_portal/support.index'
import { WidgetMessages } from '../widget-messages'

const PortalPage = (Route as unknown as { component: React.ComponentType }).component

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={{}}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
}

/** Each list row's text, top to bottom. */
function rowTexts(): string[] {
  return screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
}

afterEach(cleanup)

describe('Messages list order and time (widget and portal)', () => {
  const pairTime = getTimeAgo(payload.conversations[0].activityAt, 'en')
  const pairMessageTime = getTimeAgo(payload.conversations[0].lastMessageAt, 'en')
  const chatTime = getTimeAgo(payload.conversations[1].activityAt, 'en')

  it('portal: rows in server order, each showing its activityAt', async () => {
    render(<PortalPage />, { wrapper })
    await screen.findByText('Pair ticket')
    const rows = rowTexts()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('Pair ticket')
    expect(rows[0]).toContain(pairTime)
    expect(rows[0]).not.toContain(pairMessageTime)
    expect(rows[1]).toContain('Chat thread')
    expect(rows[1]).toContain(chatTime)
  })

  it('widget: the same order and times', async () => {
    render(<WidgetMessages teamName="Support" assistant={null} onOpenMessenger={() => {}} />, {
      wrapper,
    })
    await screen.findByText('Pair preview')
    const rows = rowTexts()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('Pair preview')
    expect(rows[0]).toContain(pairTime)
    expect(rows[0]).not.toContain(pairMessageTime)
    expect(rows[1]).toContain('Chat preview')
    expect(rows[1]).toContain(chatTime)
  })
})
