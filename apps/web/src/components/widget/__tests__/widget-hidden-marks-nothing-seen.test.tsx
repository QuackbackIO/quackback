// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { HOST_SHOWN_MESSAGE } from '@/lib/client/hooks/use-host-shown'
import { getTicketStagesSeen } from '../ticket-stage-seen'
import { getChangelogSeenAt } from '../changelog-unread'

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    sessionVersion: 0,
    user: { id: 'user_a' },
    isIdentified: true,
    identityResolved: true,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
vi.mock('@/lib/server/functions/widget/tickets', () => ({
  widgetGetMyTicketsFn: () =>
    Promise.resolve({
      tickets: [
        {
          ticketId: 'tkt_1',
          reference: '#1',
          title: 'Ticket 1',
          stage: { slot: 'resolved', label: 'Resolved', closed: false },
          conversationId: 'cnv_1',
          updatedAt: '2026-11-25T10:00:00Z',
        },
      ],
    }),
}))
vi.mock('@/lib/server/functions/widget/changelog', () => ({
  widgetListPublicChangelogsFn: () =>
    Promise.resolve({
      items: [
        {
          id: 'changelog_1',
          title: 'Entry 1',
          content: 'Body',
          publishedAt: '2026-11-25T10:00:00.000Z',
          categories: [],
        },
      ],
      nextCursor: null,
    }),
  widgetListChangelogCategoriesFn: () => Promise.resolve([]),
}))

import { WidgetTickets } from '../widget-tickets'
import { WidgetChangelog } from '../widget-changelog'

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

function hostShows(shown: boolean) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: HOST_SHOWN_MESSAGE, data: shown },
        source: window.parent,
      })
    )
  })
}

describe('a closed widget marks nothing seen', () => {
  beforeEach(() => {
    localStorage.clear()
    hostShows(false)
  })
  afterEach(() => hostShows(true))

  it('a ticket stage that moved keeps its badge until the panel is shown', async () => {
    localStorage.setItem('quackback:ticket-stages-seen:user_a', JSON.stringify({ tkt_1: 'open' }))
    render(<WidgetTickets onOpenTicket={() => {}} />, { wrapper })
    await screen.findByText('Ticket 1')
    expect(getTicketStagesSeen('user_a')).toEqual({ tkt_1: 'open' })

    hostShows(true)
    expect(getTicketStagesSeen('user_a')).toEqual({ tkt_1: 'resolved' })
  })

  it('a new changelog entry keeps its badge until the panel is shown', async () => {
    localStorage.setItem('quackback:changelog-seen-at:user_a', '2026-11-01T00:00:00.000Z')
    render(<WidgetChangelog />, { wrapper })
    await screen.findByText('Entry 1')
    expect(getChangelogSeenAt('user_a')).toBe('2026-11-01T00:00:00.000Z')

    hostShows(true)
    expect(getChangelogSeenAt('user_a')).toBe('2026-11-25T10:00:00.000Z')
  })
})
